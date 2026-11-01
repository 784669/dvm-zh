use crate::core::ffmpeg::{self, FfmpegPaths};
use crate::core::settings;
use crate::AppState;
use anyhow::{bail, Context, Result};
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// WebView2 で再生できない動画を FFmpeg で mp4 に変換(remux / transcode)する。
/// 変換結果は {app_data_dir}/transcode/{video_id}.mp4 にキャッシュし、
/// 元ファイルより新しい限り再利用する。同時に走る変換は常に 1 本。

/// 進行中の変換ジョブ。child は kill のために別スレッドと共有する
pub struct TranscodeJob {
    pub video_id: i64,
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TranscodeProgress {
    video_id: i64,
    /// 0.0〜100.0。尺が不明なときは None(フロントはスピナー表示)
    percent: Option<f64>,
    message: String,
}

enum RunOutcome {
    Done,
    Cancelled,
    Failed(String),
}

pub fn cache_path(transcode_dir: &Path, video_id: i64) -> PathBuf {
    transcode_dir.join(format!("{video_id}.mp4"))
}

fn tmp_path(transcode_dir: &Path, video_id: i64) -> PathBuf {
    transcode_dir.join(format!("{video_id}.tmp.mp4"))
}

/// キャッシュが存在し、元ファイル以降に作られていれば再利用できる
fn is_cache_fresh(cache: &Path, src: &Path) -> bool {
    let (Ok(cm), Ok(sm)) = (
        cache.metadata().and_then(|m| m.modified()),
        src.metadata().and_then(|m| m.modified()),
    ) else {
        return false;
    };
    cm >= sm
}

/// 変換を実行してキャッシュ mp4 のパスを返す(完了までブロック)。
/// mode: "remux"(コンテナ詰め替え)| "transcode"(再エンコード)
pub fn prepare(app: &AppHandle, video_id: i64, mode: &str) -> Result<PathBuf> {
    let state = app.state::<AppState>();
    // 同時に呼ばれても 1 本ずつ実行する(2 本目はキャッシュ再利用で即返る)。
    // キャッシュ確認より前にロックを取ることが重要
    let _serial = state.prepare_lock.lock().unwrap();
    let (src, video_codec, audio_codec, duration_ms) = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT path, video_codec, audio_codec, duration_ms FROM videos WHERE id = ?1",
            params![video_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .context("视频不在媒体库中")?
    };
    let src = PathBuf::from(src);
    if !src.exists() {
        bail!("找不到原始文件：{}", src.display());
    }

    let cache = cache_path(&state.transcode_dir, video_id);
    if is_cache_fresh(&cache, &src) {
        return Ok(cache);
    }

    // 同時実行は 1 本だけ: 進行中の変換があれば止めてから始める
    kill_current(&state);

    let encoder = if mode == "transcode" { detect_encoder(app) } else { String::new() };
    let tmp = tmp_path(&state.transcode_dir, video_id);

    let mut outcome = run_ffmpeg(
        app, video_id, mode, &encoder, &src, &tmp,
        video_codec.as_deref(), audio_codec.as_deref(), duration_ms,
    )?;

    // HW エンコーダの実変換が失敗したら記録を消してソフトウェアで 1 回だけ再試行
    if let RunOutcome::Failed(_) = &outcome {
        if mode == "transcode" && !encoder.is_empty() && encoder != "libx264" {
            {
                // HW エンコーダはマシンの能力なのでアプリ全体側(app.db)に記録する
                let conn = state.app_db.lock().unwrap();
                let _ = settings::set(&conn, "hw_encoder", "libx264");
            }
            outcome = run_ffmpeg(
                app, video_id, mode, "libx264", &src, &tmp,
                video_codec.as_deref(), audio_codec.as_deref(), duration_ms,
            )?;
        }
    }

    match outcome {
        RunOutcome::Done => {
            std::fs::rename(&tmp, &cache).context("无法放置缓存文件")?;
            purge_cache(app, Some(&cache));
            Ok(cache)
        }
        RunOutcome::Cancelled => {
            let _ = std::fs::remove_file(&tmp);
            bail!("已取消转换");
        }
        RunOutcome::Failed(err) => {
            let _ = std::fs::remove_file(&tmp);
            bail!("转换失败：{err}");
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_ffmpeg(
    app: &AppHandle,
    video_id: i64,
    mode: &str,
    encoder: &str,
    src: &Path,
    tmp: &Path,
    video_codec: Option<&str>,
    audio_codec: Option<&str>,
    duration_ms: Option<i64>,
) -> Result<RunOutcome> {
    let state = app.state::<AppState>();
    let args = build_args(mode, encoder, video_codec, audio_codec, src, tmp);

    let mut child = ffmpeg::command(&state.ffmpeg.ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("无法启动 ffmpeg")?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let cancelled = Arc::new(AtomicBool::new(false));
    let child = Arc::new(Mutex::new(child));
    *state.transcode_job.lock().unwrap() = Some(TranscodeJob {
        video_id,
        child: child.clone(),
        cancelled: cancelled.clone(),
    });

    // stderr はパイプ詰まりを避けるため別スレッドで読み切る(-v error なので少量)
    let err_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut buf);
        buf
    });

    // stdout の -progress 出力(out_time_us=)から進捗を 500ms 間隔で通知
    let message = if mode == "remux" { "正在转换容器…" } else { "正在转换视频…" };
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    for line in BufReader::new(stdout).lines().map_while(|l| l.ok()) {
        if let Some(us) = line.strip_prefix("out_time_us=") {
            if last_emit.elapsed() >= Duration::from_millis(500) {
                last_emit = Instant::now();
                let percent = match (us.trim().parse::<i64>(), duration_ms) {
                    (Ok(us), Some(dur)) if dur > 0 => {
                        Some(((us as f64 / 1000.0) / dur as f64 * 100.0).clamp(0.0, 100.0))
                    }
                    _ => None,
                };
                let _ = app.emit(
                    "transcode:progress",
                    TranscodeProgress { video_id, percent, message: message.into() },
                );
            }
        }
    }

    // stdout が閉じた = 終了間際。取りこぼさないよう poll で待つ
    let status = loop {
        if let Some(st) = child.lock().unwrap().try_wait()? {
            break st;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let err_text = err_reader.join().unwrap_or_default();

    // 自分のジョブ登録を解除(kill_current が別ジョブを積んでいたら触らない)
    {
        let mut job = state.transcode_job.lock().unwrap();
        if job.as_ref().is_some_and(|j| Arc::ptr_eq(&j.child, &child)) {
            *job = None;
        }
    }

    if cancelled.load(Ordering::SeqCst) {
        return Ok(RunOutcome::Cancelled);
    }
    if status.success() {
        Ok(RunOutcome::Done)
    } else {
        // stderr の末尾だけあれば原因は分かる
        let tail: String = err_text.chars().rev().take(500).collect::<Vec<_>>().into_iter().rev().collect();
        Ok(RunOutcome::Failed(tail.trim().to_string()))
    }
}

fn build_args(
    mode: &str,
    encoder: &str,
    video_codec: Option<&str>,
    audio_codec: Option<&str>,
    src: &Path,
    tmp: &Path,
) -> Vec<OsString> {
    let mut a: Vec<OsString> = Vec::new();
    let push = |a: &mut Vec<OsString>, s: &str| a.push(OsString::from(s));

    for s in ["-y", "-v", "error", "-nostats", "-progress", "pipe:1", "-i"] {
        push(&mut a, s);
    }
    a.push(src.into());
    // 映像 1 本・音声 1 本に限定(mkv の字幕・複数音声による mp4 化エラーを避ける)
    for s in ["-map", "0:v:0", "-map", "0:a:0?"] {
        push(&mut a, s);
    }

    if mode == "remux" {
        for s in ["-c:v", "copy"] {
            push(&mut a, s);
        }
        if video_codec == Some("hevc") {
            // mp4 内の HEVC は hvc1 タグでないと再生できないプレイヤーが多い
            for s in ["-tag:v", "hvc1"] {
                push(&mut a, s);
            }
        }
    } else {
        push(&mut a, "-c:v");
        push(&mut a, encoder);
        match encoder {
            "h264_nvenc" => for s in ["-preset", "p4", "-cq", "23", "-b:v", "0"] { push(&mut a, s); },
            "h264_qsv" => for s in ["-global_quality", "23"] { push(&mut a, s); },
            "h264_amf" => for s in ["-quality", "balanced"] { push(&mut a, s); },
            _ => for s in ["-preset", "veryfast", "-crf", "23"] { push(&mut a, s); },
        }
        // 10bit ソース(HEVC 10bit 等)を 8bit に落とす。H.264 再生互換の必須条件
        for s in ["-pix_fmt", "yuv420p"] {
            push(&mut a, s);
        }
    }

    // 音声: mp4 で安全なコーデックはそのまま、それ以外(ac3/dts/flac/opus 等)は AAC 化
    let audio_copy = mode == "remux" && matches!(audio_codec, Some("aac") | Some("mp3"));
    if audio_copy {
        for s in ["-c:a", "copy"] {
            push(&mut a, s);
        }
    } else {
        for s in ["-c:a", "aac", "-b:a", "192k"] {
            push(&mut a, s);
        }
    }

    for s in ["-movflags", "+faststart", "-f", "mp4"] {
        push(&mut a, s);
    }
    a.push(tmp.into());
    a
}

/// 使える H.264 エンコーダを決める。初回は 1 フレームのテストエンコードで実証し、
/// 結果を settings("hw_encoder")に保存して次回以降は即答する
pub fn detect_encoder(app: &AppHandle) -> String {
    let state = app.state::<AppState>();
    {
        let conn = state.app_db.lock().unwrap();
        if let Ok(Some(enc)) = settings::get(&conn, "hw_encoder") {
            if !enc.is_empty() {
                return enc;
            }
        }
    }
    let found = ["h264_nvenc", "h264_qsv", "h264_amf"]
        .into_iter()
        .find(|enc| test_encoder(&state.ffmpeg, enc))
        .unwrap_or("libx264")
        .to_string();
    {
        let conn = state.app_db.lock().unwrap();
        let _ = settings::set(&conn, "hw_encoder", &found);
    }
    found
}

/// ドライバ無しでも -encoders には載るため、実際に 1 フレーム encode して確かめる
fn test_encoder(ff: &FfmpegPaths, encoder: &str) -> bool {
    ffmpeg::command(&ff.ffmpeg)
        .args([
            "-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1",
            "-frames:v", "1", "-c:v", encoder, "-f", "null", "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 進行中の変換を止める(なければ何もしない)。プロセスの終了まで少しだけ待つ
pub fn kill_current(state: &AppState) {
    let child = {
        let mut job = state.transcode_job.lock().unwrap();
        match job.take() {
            Some(j) => {
                j.cancelled.store(true, Ordering::SeqCst);
                let _ = j.child.lock().unwrap().kill();
                Some(j.child)
            }
            None => None,
        }
    };
    // 出力ファイルのハンドルが解放されるのを待つ(同じ動画をすぐ変換し直す場合に必要)
    if let Some(child) = child {
        for _ in 0..30 {
            if child.lock().unwrap().try_wait().ok().flatten().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

/// キャッシュ掃除。設定と現在のライブラリ一覧を読んで `purge_cache_in` に渡すだけの薄いラッパ
pub fn purge_cache(app: &AppHandle, keep: Option<&Path>) {
    let state = app.state::<AppState>();
    let (limit_gb, mut known) = {
        let conn = state.app_db.lock().unwrap();
        let limit: u64 = settings::get(&conn, "transcode_cache_limit_gb")
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(20);
        let ids = crate::core::libraries::list(&conn)
            .map(|v| v.into_iter().map(|e| e.id).collect::<Vec<String>>())
            .unwrap_or_default();
        (limit, ids)
    };
    known.push(crate::core::libraries::PLACEHOLDER_CACHE_KEY.to_string());
    purge_cache_in(
        &state.data_dir.join("transcode"),
        limit_gb.saturating_mul(1024 * 1024 * 1024),
        &known,
        keep,
    );
}

/// 書きかけの .tmp.mp4 を消し、上限超過分を古い順に削除する。
/// keep(直近生成分)は削除対象から除外する。
///
/// **上限はライブラリ横断で見る**(v1.27)。`root` の直下はライブラリ id ごとの
/// サブフォルダで、ライブラリ単位に上限をかけると「ライブラリ数 × 20GB」に化ける。
/// `known_ids` に無いサブフォルダは、一覧から外したライブラリの残骸なので丸ごと消す
pub fn purge_cache_in(root: &Path, limit_bytes: u64, known_ids: &[String], keep: Option<&Path>) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if path.is_dir() {
            if !known_ids.iter().any(|id| *id == name) {
                let _ = std::fs::remove_dir_all(&path);
                continue;
            }
            collect_cache_files(&path, &mut files);
        } else if name.ends_with(".mp4") {
            // v1.26 以前のフラット配置の残骸(移行で消しているが取りこぼしの保険)
            let _ = std::fs::remove_file(&path);
        }
    }

    let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
    if total <= limit_bytes {
        return;
    }
    files.sort_by_key(|(_, _, mtime)| *mtime);
    for (path, size, _) in files {
        if total <= limit_bytes {
            break;
        }
        if keep.is_some_and(|k| k == path) {
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= size;
        }
    }
}

/// 変換キャッシュの現在量を数える(件数, バイト数)。
///
/// **`collect_cache_files` を流用しない** —— あちらは走査ついでに `.tmp.mp4` を消すので、
/// 設定画面に数字を出すだけの読み取りから呼ぶと副作用が出る。ここは何も消さない
pub fn cache_size(root: &Path) -> (usize, u64) {
    let Ok(libs) = std::fs::read_dir(root) else { return (0, 0) };
    let mut count = 0usize;
    let mut total = 0u64;
    for lib in libs.flatten() {
        let Ok(entries) = std::fs::read_dir(lib.path()) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // 書きかけの .tmp.mp4 は「貯まっているもの」ではないので数えない
            if !name.ends_with(".mp4") || name.ends_with(".tmp.mp4") {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                count += 1;
                total += meta.len();
            }
        }
    }
    (count, total)
}

/// 1 ライブラリぶんのキャッシュを走査する。.tmp.mp4 はその場で消す
fn collect_cache_files(dir: &Path, out: &mut Vec<(PathBuf, u64, std::time::SystemTime)>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if name.ends_with(".tmp.mp4") {
            // 変換は同時 1 本なので、ここに残る .tmp は書きかけの残骸
            let _ = std::fs::remove_file(&path);
            continue;
        }
        if !name.ends_with(".mp4") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            out.push((path, meta.len(), meta.modified().unwrap_or(std::time::UNIX_EPOCH)));
        }
    }
}

/// 動画をライブラリから削除したときに対応するキャッシュも消す
pub fn remove_cache_for(transcode_dir: &Path, video_id: i64) {
    let _ = std::fs::remove_file(cache_path(transcode_dir, video_id));
    let _ = std::fs::remove_file(tmp_path(transcode_dir, video_id));
}

// ───────────────────────────────────────────────────────────────────────────
// 低ビットレート・プレビュー(カードの再生ボタン用)
//
// 方針:
// - 予め生成しない。実際にプレビュー再生が要求された動画だけを対象にする
// - 一度作ったら `{preview_dir}/{画質}_{id}.mp4` に残し、次回以降はそのまま読む
//   (再エンコードしない。ただし `preview_quality` 設定はファイル名に入るので、
//   画質を変えると別名のファイルになり、古い画質が出ることはない)
// - 自動消退(LRU)はしない。設定の「プレビューキャッシュを削除」を押したときだけ消える
// ───────────────────────────────────────────────────────────────────────────

/// プレビューのキャッシュファイル名(画質設定を含む)
pub fn preview_cache_path(preview_dir: &Path, quality: &str, video_id: i64) -> PathBuf {
    preview_dir.join(format!("{quality}_{video_id}.mp4"))
}

/// `preview_quality` 設定 → (高さ, crf)。未設定・未知は既定の 360p・CRF32
fn preview_quality_params(conn: &rusqlite::Connection) -> (u32, u32) {
    match settings::get(conn, "preview_quality").ok().flatten().as_deref() {
        Some("480p") => (480, 30),
        Some("720p") => (720, 28),
        _ => (360, 32),
    }
}

/// いま育てているプレビュー転码(key = "{video_id}:{quality}")。
///
/// - `child` は別の動画の再生が始まったときに kill するための受け皿
///   (プレビューは**同時に 1 本だけ**)
/// - `progress` は ffmpeg の `-progress pipe:1` から読んだ 0..1000 の千分率。
///   フロントはこれで「キャッシュ進捗バー」を描く
struct PreviewTask {
    child: Mutex<Option<Child>>,
    progress: AtomicU32,
}
type PreviewSlot = Arc<PreviewTask>;

fn preview_tasks() -> &'static Mutex<HashMap<String, PreviewSlot>> {
    static TASKS: OnceLock<Mutex<HashMap<String, PreviewSlot>>> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// フロントへ返すプレビュー状態。
///
/// `ready` が false の間はキャッシュがまだ育っている途中(そもそも無いこともある)。
/// その状態のファイルを <video> に渡すと、書けた分だけしか無いので読み込みに
/// 失敗しやすい —— そこでフロントは**先に元ファイルで再生を始め**、progress を
/// 進捗バーに出し、ready になった時点で `path` に切り替える
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStatus {
    pub path: String,
    pub ready: bool,
    /// 0.0〜1.0(ready のときは 1.0)
    pub progress: f64,
}

fn status_of(cache: &Path, ready: bool, progress: f64) -> PreviewStatus {
    PreviewStatus {
        path: cache.to_string_lossy().to_string(),
        ready,
        progress: if ready { 1.0 } else { progress },
    }
}

/// その key の転码進捗(0.0〜1.0)。走っていなければ 0
fn task_progress(key: &str) -> f64 {
    preview_tasks()
        .lock()
        .unwrap()
        .get(key)
        .map(|t| t.progress.load(Ordering::Relaxed) as f64 / 1000.0)
        .unwrap_or(0.0)
}

/// 転码完成の目印(空ファイル)。分片 mp4 は育ちながら再生されるため、
/// 「ファイルがある=完成」ではない。ffmpeg が最後まで成功したときだけ置く
fn ok_marker(cache: &Path) -> PathBuf {
    let mut name = cache
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    name.push_str(".ok");
    cache.with_file_name(name)
}

/// プレビュー再生用の低ビットレート mp4 を用意してパスを返す(**完了を待たない**)。
///
/// 転码はバックグラウンドで走り、分片 mp4(`+empty_moov+frag_keyframe`)として
/// キャッシュへ直接書く。フロントは返ってきたパスをすぐ <video> に渡して
/// 「書けた分から」再生できる。まだ無い部分は再生が追いつくまで待つだけで、
/// 転码は再生の 10〜30 倍の速さで進むので実質詰まらない。
///
/// **同時に育てるのは 1 本だけ**。別の動画の再生要求が来たら、走っている
/// 転码を kill して(部分的なキャッシュも捨てる)新しく始める
pub fn prepare_preview(app: &AppHandle, video_id: i64) -> Result<PreviewStatus> {
    let state = app.state::<AppState>();

    let src: String = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT path FROM videos WHERE id = ?1",
            params![video_id],
            |r| r.get::<_, String>(0),
        )
        .context("视频不在媒体库中")?
    };
    let src = PathBuf::from(&src);
    if !src.exists() {
        bail!("找不到原始文件：{}", src.display());
    }

    let (height, crf) = {
        let conn = state.app_db.lock().unwrap();
        preview_quality_params(&conn)
    };
    let quality_key = format!("{height}p");
    let cache = preview_cache_path(&state.preview_dir, &quality_key, video_id);
    let ok = ok_marker(&cache);
    let key = format!("{video_id}:{quality_key}");

    // 完成品があればそれで終わり
    if ok.exists() && is_cache_fresh(&cache, &src) {
        return Ok(status_of(&cache, true, 1.0));
    }

    let slot = {
        let mut tasks = preview_tasks().lock().unwrap();
        if tasks.contains_key(&key) {
            // 培養中:進捗だけ伝えて、あとはフロントが ready を待つ。
            // (tasks のロックを持っているので task_progress() は呼ばない=二重ロック)
            let p = tasks
                .get(&key)
                .map(|t| t.progress.load(Ordering::Relaxed) as f64 / 1000.0)
                .unwrap_or(0.0);
            return Ok(status_of(&cache, false, p));
        }
        // 同時 1 本:他の動画の転码はすべて止める。止まった側の中途半端な
        // キャッシュは価値がない(続きから再開できない)のですぐ消す
        let others: Vec<(String, PreviewSlot)> = tasks
            .iter()
            .filter(|(k, _)| !k.starts_with(&format!("{video_id}:")))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (k, s) in &others {
            if let Some(c) = s.child.lock().unwrap().as_mut() {
                let _ = c.kill();
            }
            tasks.remove(k);
            if let Some((vid, q)) = k.split_once(':') {
                if let Ok(vid) = vid.parse::<i64>() {
                    let stale = preview_cache_path(&state.preview_dir, q, vid);
                    let _ = std::fs::remove_file(&stale);
                    let _ = std::fs::remove_file(ok_marker(&stale));
                }
            }
        }
        // 自分の前回の中途半端な残骸も捨ててやり直す
        let _ = std::fs::remove_file(&cache);
        let _ = std::fs::remove_file(&ok);
        let slot: PreviewSlot = Arc::new(PreviewTask {
            child: Mutex::new(None),
            progress: AtomicU32::new(0),
        });
        tasks.insert(key.clone(), slot.clone());
        slot
    };

    // 総尺は進捗計算に使う(不明なら進捗は 0 のまま = 不定スピナー)
    let total_secs: f64 = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT duration_ms FROM videos WHERE id = ?1",
            params![video_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .ok()
        .flatten()
        .unwrap_or(0) as f64
        / 1000.0
    };

    let app2 = app.clone();
    let cache2 = cache.clone();
    let ok2 = ok.clone();
    let key2 = key.clone();
    let slot2 = slot.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let st = app2.state::<AppState>();
        // 再生用変換と同じキュー(回転は rotate_lock の別キューなので並行可)。
        // 先に走っている転码が終わるまで 2 本目はここで待つ
        let _serial = st.prepare_lock.lock().unwrap();
        if preview_tasks().lock().unwrap().contains_key(&key2) {
            match spawn_preview_ffmpeg(&st.ffmpeg, &src, &cache2, height, crf) {
                Ok(mut child) => {
                    // `-progress pipe:1` を読み続けるスレッド。読まないと ffmpeg が
                    // stdout のバッファ詰まりで止まってしまう
                    if let Some(out) = child.stdout.take() {
                        let s = slot2.clone();
                        std::thread::spawn(move || {
                            let reader = BufReader::new(out);
                            for line in reader.lines().map_while(|l| l.ok()) {
                                // 新しい ffmpeg は out_time_us、古いものは out_time_ms
                                // (名前と裏腹に中身はマイクロ秒)を出す
                                let v = line
                                    .strip_prefix("out_time_us=")
                                    .or_else(|| line.strip_prefix("out_time_ms="));
                                let Some(v) = v else { continue };
                                let Ok(us) = v.trim().parse::<f64>() else {
                                    continue;
                                };
                                if total_secs <= 0.0 {
                                    continue;
                                }
                                let pct = (us / 1_000_000.0 / total_secs * 1000.0)
                                    .clamp(0.0, 1000.0)
                                    as u32;
                                s.progress.fetch_max(pct, Ordering::Relaxed);
                            }
                        });
                    }
                    *slot2.child.lock().unwrap() = Some(child);
                    // 完了待ちは 100ms ポーリング。kill されたら try_wait が即返る。
                    // ロックを持ちっぱなしにしない(kill 側と同じ Mutex を奪い合うため)
                    let status = loop {
                        {
                            let mut g = slot2.child.lock().unwrap();
                            if let Some(c) = g.as_mut() {
                                if let Ok(Some(s)) = c.try_wait() {
                                    break s;
                                }
                            }
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    };
                    if status.success() && cache2.exists() {
                        slot2.progress.store(1000, Ordering::Relaxed);
                        let _ = std::fs::write(&ok2, b"");
                    } else {
                        // 失敗/kill で終わった → 中途半端な残骸は捨てる
                        let _ = std::fs::remove_file(&cache2);
                        let _ = std::fs::remove_file(&ok2);
                    }
                }
                Err(_) => {
                    let _ = std::fs::remove_file(&cache2);
                    let _ = std::fs::remove_file(&ok2);
                }
            }
        }
        preview_tasks().lock().unwrap().remove(&key2);
    });

    Ok(status_of(&cache, false, 0.0))
}

/// プレビューの状態だけを問い合わせる(**転码は起こさない**)
pub fn preview_status(app: &AppHandle, video_id: i64) -> Result<PreviewStatus> {
    let state = app.state::<AppState>();
    let src: String = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT path FROM videos WHERE id = ?1",
            params![video_id],
            |r| r.get::<_, String>(0),
        )
        .context("视频不在媒体库中")?
    };
    let (height, _) = {
        let conn = state.app_db.lock().unwrap();
        preview_quality_params(&conn)
    };
    let quality_key = format!("{height}p");
    let cache = preview_cache_path(&state.preview_dir, &quality_key, video_id);
    let ok = ok_marker(&cache);
    let ready = ok.exists() && is_cache_fresh(&cache, &PathBuf::from(&src));
    let key = format!("{video_id}:{quality_key}");
    Ok(status_of(&cache, ready, task_progress(&key)))
}

/// プレビュー用の低ビットレート変換を起こす(音声なし・解像度縮小)。
/// 分片 mp4 で書くので、再生側は最初のフラグメントが着いた時点で再生を始められる。
/// 2 秒ごとにキーフレームを打つ(フラグメント境界=シーク粒度になるため)
fn spawn_preview_ffmpeg(
    ff: &FfmpegPaths,
    src: &Path,
    out: &Path,
    height: u32,
    crf: u32,
) -> Result<Child> {
    ffmpeg::command(&ff.ffmpeg)
        .args(["-v", "error", "-nostdin", "-nostats"])
        // 進捗は stdout に key=value で出る。stderr は潰したまま進捗だけ拾う
        .args(["-progress", "pipe:1"])
        .arg("-i")
        .arg(src)
        .args(["-map", "0:v:0?"])
        .args(["-c:v", "libx264"])
        .args(["-preset", "veryfast"])
        .args(["-crf", &crf.to_string()])
        .args(["-pix_fmt", "yuv420p"])
        .args(["-vf", &format!("scale={height}:-2")])
        .args(["-an"])
        .args(["-movflags", "+empty_moov+frag_keyframe+default_base_moof"])
        .args(["-force_key_frames", "expr:gte(t,n_forced*2)"])
        .args(["-f", "mp4"])
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("无法启动 ffmpeg")
}

/// 動画を削除したとき、その動画のプレビューキャッシュ(全画質)も消す
pub fn remove_preview_for(preview_dir: &Path, video_id: i64) {
    if let Ok(entries) = std::fs::read_dir(preview_dir) {
        let suffix = format!("_{video_id}.mp4");
        let tmp_suffix = format!("_{video_id}.tmp.mp4");
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            // 「.mp4」と「.mp4.ok(完成マーカー)」を両方消す
            if name.ends_with(&suffix)
                || name.ends_with(&format!("{suffix}.ok"))
                || name.ends_with(&tmp_suffix)
            {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// プレビーキャッシュを全削除する(設定の「削除」ボタン用)
pub fn purge_preview_cache(preview_dir: &Path) -> (usize, u64) {
    let mut removed = 0usize;
    let mut freed = 0u64;
    if let Ok(entries) = std::fs::read_dir(preview_dir) {
        for e in entries.flatten() {
            let p = e.path();
            let is_mp4 = p.extension().and_then(|x| x.to_str()) == Some("mp4");
            let is_marker = e.file_name().to_string_lossy().ends_with(".mp4.ok");
            if !is_mp4 && !is_marker {
                continue;
            }
            if is_mp4 {
                if let Ok(meta) = e.metadata() {
                    freed += meta.len();
                }
            }
            if std::fs::remove_file(&p).is_ok() {
                removed += 1;
            }
        }
    }
    (removed, freed)
}

/// プレビーキャッシュの現在量(件数, バイト)
pub fn preview_cache_size(preview_dir: &Path) -> (usize, u64) {
    let mut count = 0usize;
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(preview_dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("mp4") {
                if let Ok(meta) = e.metadata() {
                    count += 1;
                    total += meta.len();
                }
            }
        }
    }
    (count, total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dvm-test-cache-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// mtime を指定して 1MB のダミーキャッシュを置く(古い順の削除を確かめるため)
    fn put(dir: &Path, name: &str, age_secs: u64) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, vec![0u8; 1024 * 1024]).unwrap();
        let when = std::time::SystemTime::now() - Duration::from_secs(age_secs);
        let f = std::fs::File::options().write(true).open(&path).unwrap();
        f.set_modified(when).unwrap();
        path
    }

    /// **上限はライブラリ横断で見る**。ライブラリごとに掛けると
    /// 実効の上限が「ライブラリ数 × 20GB」に化ける
    #[test]
    fn purge_enforces_the_limit_across_libraries() {
        let root = workspace("across");
        let a = root.join("aaa");
        let b = root.join("bbb");
        let known = vec!["aaa".to_string(), "bbb".to_string()];

        let oldest = put(&a, "1.mp4", 300);
        let middle = put(&b, "2.mp4", 200);
        let newest = put(&a, "3.mp4", 100);
        let tmp = put(&b, "9.tmp.mp4", 50);

        // 3MB あるところに上限 2MB。古いものから 1 つだけ落ちる
        purge_cache_in(&root, 2 * 1024 * 1024, &known, None);

        assert!(!oldest.exists(), "いちばん古いものから消すこと");
        assert!(middle.exists());
        assert!(newest.exists());
        assert!(!tmp.exists(), "書きかけの .tmp はどのサブフォルダでも消すこと");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 直近に作ったものは、いちばん古くても消さない(再生しようとしている本人なので)
    #[test]
    fn purge_never_removes_the_file_we_just_made() {
        let root = workspace("keep");
        let a = root.join("aaa");
        let known = vec!["aaa".to_string()];
        let oldest = put(&a, "1.mp4", 300);
        let newer = put(&a, "2.mp4", 100);

        purge_cache_in(&root, 1024, &known, Some(&oldest));

        assert!(oldest.exists(), "keep は上限を割っても残すこと");
        assert!(!newer.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 一覧から外したライブラリのキャッシュを永久に残さない
    #[test]
    fn purge_removes_unknown_library_folders() {
        let root = workspace("unknown");
        let known_dir = root.join("aaa");
        let gone_dir = root.join("deleted-library");
        let kept = put(&known_dir, "1.mp4", 10);
        put(&gone_dir, "1.mp4", 10);
        // v1.26 以前のフラット配置の残骸
        let legacy = put(&root, "7.mp4", 10);

        purge_cache_in(&root, 100 * 1024 * 1024, &["aaa".to_string()], None);

        assert!(kept.exists());
        assert!(!gone_dir.exists(), "登録に無いサブフォルダは丸ごと消すこと");
        assert!(!legacy.exists(), "ルート直下の旧キャッシュも掃除すること");

        let _ = std::fs::remove_dir_all(&root);
    }
}
