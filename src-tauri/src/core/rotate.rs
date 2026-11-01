use crate::core::ffmpeg::{self, FfmpegPaths};
use crate::core::{library, metadata, playback};
use crate::db;
use crate::AppState;
use anyhow::{bail, Context, Result};
use rusqlite::params;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// 表示方向(Display Matrix)を書けるのは ISO BMFF(MP4 / MOV)系のコンテナだけ。
/// MKV / AVI / WMV などは「回転を書く場所」が実質無いので対象外にする。
const SUPPORTED_EXT: [&str; 3] = ["mp4", "m4v", "mov"];

/// 画面内容としての回転方向
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RotateDir {
    Cw,
    Ccw,
}

impl RotateDir {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "cw" => Some(Self::Cw),
            "ccw" => Some(Self::Ccw),
            _ => None,
        }
    }
    /// 時計回り基準の増分(逆回り = +270)
    fn delta(self) -> i64 {
        match self {
            Self::Cw => 90,
            Self::Ccw => 270,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Cw => "顺时针",
            Self::Ccw => "逆时针",
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::Cw => "cw",
            Self::Ccw => "ccw",
        }
    }
}

const ST_RUNNING: u8 = 0;
const ST_DONE: u8 = 1;
const ST_ERROR: u8 = 2;

struct RotateTask {
    dir: RotateDir,
    /// 0〜100(ffmpeg の書き出し量を実ファイルサイズから見る)
    progress: AtomicU64,
    state: AtomicU8,
    message: Mutex<Option<String>>,
    /// 完了時の絶対角(時計回り 0/90/180/270)
    rotation: AtomicU64,
    started_at: u64,
}

/// フロントへ見せるタスクのスナップショット
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateTaskState {
    pub id: i64,
    pub dir: &'static str,
    pub progress: u64,
    pub state: &'static str,
    pub message: Option<String>,
    pub rotation: Option<i64>,
}

fn tasks() -> &'static Mutex<HashMap<i64, RotateTask>> {
    static TASKS: OnceLock<Mutex<HashMap<i64, RotateTask>>> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn set_progress(video_id: i64, pct: u64) {
    if let Some(t) = tasks().lock().unwrap().get(&video_id) {
        t.progress.fetch_max(pct.min(99), Ordering::Relaxed);
    }
}

/// 回転タスクを起こす。すぐに返り、進捗は `rotate_status` のポーリングで拾う。
/// カードが仮想化で作り直されてもバックエンド側のタスクは生きているので、
/// スクロールで見えなくなった→戻ってきた、でも進捗表示が続く
pub fn start(app: &AppHandle, video_id: i64, dir: RotateDir) {
    {
        let mut map = tasks().lock().unwrap();
        // 完了タスクは 10 分で落とす(マップの無限肥大を防ぐ)
        let now = now_secs();
        map.retain(|_, t| {
            t.state.load(Ordering::Relaxed) == ST_RUNNING
                || now.saturating_sub(t.started_at) < 600
        });
        // 同じ動画がまだ処理中なら重ねて起こさない
        if let Some(t) = map.get(&video_id) {
            if t.state.load(Ordering::Relaxed) == ST_RUNNING {
                return;
            }
        }
        map.insert(
            video_id,
            RotateTask {
                dir,
                progress: AtomicU64::new(0),
                state: AtomicU8::new(ST_RUNNING),
                message: Mutex::new(None),
                rotation: AtomicU64::new(0),
                started_at: now,
            },
        );
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = run_rotate(&app2, video_id, dir);
        let map = tasks().lock().unwrap();
        if let Some(t) = map.get(&video_id) {
            match result {
                Ok(cw) => {
                    t.rotation.store(cw as u64, Ordering::Relaxed);
                    t.state.store(ST_DONE, Ordering::Relaxed);
                    t.progress.store(100, Ordering::Relaxed);
                }
                Err(e) => {
                    t.state.store(ST_ERROR, Ordering::Relaxed);
                    *t.message.lock().unwrap() = Some(e.to_string());
                }
            }
        }
    });
}

/// 現在走っている/直近の回転タスク一覧
pub fn snapshot() -> Vec<RotateTaskState> {
    let map = tasks().lock().unwrap();
    map.iter()
        .map(|(&id, t)| {
            let st = t.state.load(Ordering::Relaxed);
            RotateTaskState {
                id,
                dir: t.dir.key(),
                progress: t.progress.load(Ordering::Relaxed),
                state: match st {
                    ST_DONE => "done",
                    ST_ERROR => "error",
                    _ => "running",
                },
                message: t.message.lock().unwrap().clone(),
                rotation: (st == ST_DONE)
                    .then(|| t.rotation.load(Ordering::Relaxed) as i64),
            }
        })
        .collect()
}

/// 元動画の表示方向を 90 度回す(時計回り or 逆時計回り)。
///
/// **再エンコードしない**(`-c copy`)。MP4 の Display Matrix を書き換えるだけなので
/// 数 GB のファイルでも数秒〜十数秒、画質も一切変わらない。
fn run_rotate(app: &AppHandle, video_id: i64, dir: RotateDir) -> Result<i64> {
    let state = app.state::<AppState>();
    // 回転専用キュー(prepare_lock とは別)。回転は remux なのでディスク負荷が軽く、
    // プレビュー転码や再生変換と並行で走らせてよい
    let _serial = state.rotate_lock.lock().unwrap();
    set_progress(video_id, 2);

    let path: String = {
        let conn = state.db_read.lock().unwrap();
        conn.query_row("SELECT path FROM videos WHERE id=?1", params![video_id], |r| r.get(0))
            .context("视频不在媒体库中")?
    };
    let src = PathBuf::from(&path);
    if !src.exists() {
        bail!("找不到原始文件，无法写入旋转信息");
    }

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !SUPPORTED_EXT.contains(&ext.as_str()) {
        let label = if ext.is_empty() { "该".to_string() } else { ext.to_uppercase() };
        bail!("{label} 格式无法同步修改（仅支持 MP4 / MOV），未做任何改动");
    }
    set_progress(video_id, 5);

    let cur_cw = read_cw(&state.ffmpeg, &src)?;
    let next_cw = (cur_cw + dir.delta()) % 360;

    // 同一フォルダー内に一時ファイルを作る(別ボリュームだと rename が原子的に効かない)。
    // スキャン側は is_video_file でこの命名を弾くので、走っている間に媒体庫へ混ざらない
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .context("文件名含有无法处理的字符")?
        .to_string();
    let tmp = src.with_file_name(format!("{file_name}.dvmrot.mp4"));
    let bak = src.with_file_name(format!("{file_name}.dvm-bak"));
    let _ = std::fs::remove_file(&tmp);
    // 旧バージョン走行中に一時ファイルを誤登録したレコードがあれば落としておく
    {
        let conn = state.db.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM videos WHERE path = ?1",
            params![tmp.to_string_lossy().to_string()],
        );
    }

    // -display_rotation は**反時計回り**の角度。時計回り next_cw 度 = -(next_cw)
    let written = run_rotate_ffmpeg(&state.ffmpeg, &src, &tmp, -(next_cw as i32), video_id)
        .and_then(|_| {
            // 出来上がりを読み直して確認する。壊れた mp4 を元ファイルに被せないための関門
            set_progress(video_id, 97);
            let got = read_cw(&state.ffmpeg, &tmp)?;
            if got != next_cw {
                bail!("写入后校验失败（期望 {next_cw}°，实际 {got}°）");
            }
            Ok(())
        });
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    // 置き換え: 元 → .bak、tmp → 元。2 段目が失敗したら .bak を戻して元の状態に復帰する
    std::fs::rename(&src, &bak).context("无法备份原文件（可能正被其他程序占用）")?;
    if let Err(e) = std::fs::rename(&tmp, &src) {
        let _ = std::fs::rename(&bak, &src);
        let _ = std::fs::remove_file(&tmp);
        return Err(e).context("无法替换原文件");
    }
    set_progress(video_id, 98);

    // 中身が変わったので、サイズ・ハッシュ・更新時刻を DB に反映する
    let meta = std::fs::metadata(&src)?;
    let size = meta.len();
    let hash = library::partial_hash(&src, size);
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    {
        let conn = state.db.lock().unwrap();
        conn.execute(
            "UPDATE videos SET size=?1, partial_hash=?2, thumb_state=0,
             file_modified_at=datetime(?3,'unixepoch','localtime') WHERE id=?4",
            params![size as i64, hash, mtime, video_id],
        )?;
        db::log_op(
            &conn,
            "user",
            "rotate_source",
            &format!("{path} → {} {next_cw}°", dir.label()),
        );
    }

    // 縮小プレビューは古い向きで焼かれているので捨てる(次回の再生で作り直す)
    playback::remove_preview_for(&state.preview_dir, video_id);

    // サムネイルと解像度などのメタ情報を撮り直す(別スレッド。UI は待たせない)
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || library::process_pending(&app2, vec![video_id]));

    // 元ファイルの控えはゴミ箱へ(同一ボリューム内の移動なので容量は増えない)
    if trash::delete(&bak).is_err() {
        let _ = std::fs::remove_file(&bak);
    }

    Ok(next_cw)
}

/// いまの回転角を**時計回り**の 0/90/180/270 で返す
fn read_cw(ff: &FfmpegPaths, path: &Path) -> Result<i64> {
    let p = path.to_str().context("路径含有无法处理的字符")?;
    let info = metadata::media_info(ff, p)?;
    // 回転は本編の映像ストリームに付く(カバー画像は対象外)
    let raw = info
        .streams
        .iter()
        .find(|s| s.kind == "video" && !s.is_attached_pic)
        .and_then(|s| s.rotation)
        .unwrap_or(0.0);
    // ffprobe の rotation は**反時計回りが正**(-90 = 時計回り 90 度)
    Ok(normalize_cw(-(raw.round() as i64)))
}

/// 端数(45 度など)は最寄りの 90 度へ丸め、0〜359 の時計回りへ正規化する
fn normalize_cw(deg: i64) -> i64 {
    ((deg + 45).div_euclid(90) * 90).rem_euclid(360)
}

/// Display Matrix を書き換えるだけの remux(デコードもエンコードもしない)
fn run_rotate_ffmpeg(
    ff: &FfmpegPaths,
    src: &Path,
    out: &Path,
    ccw_deg: i32,
    video_id: i64,
) -> Result<()> {
    // まずは全ストリームを丸ごと写す。timecode などの data ストリームを持つ mp4 では
    // muxer が拒否することがあるので、そのときだけ映像/音声/字幕に絞ってやり直す
    match try_rotate(ff, src, out, ccw_deg, &["-map", "0"], video_id) {
        Ok(()) => Ok(()),
        Err(first) => {
            let _ = std::fs::remove_file(out);
            try_rotate(
                ff,
                src,
                out,
                ccw_deg,
                &["-map", "0:v", "-map", "0:a?", "-map", "0:s?"],
                video_id,
            )
            .map_err(|_| first)
        }
    }
}

fn try_rotate(
    ff: &FfmpegPaths,
    src: &Path,
    out: &Path,
    ccw_deg: i32,
    map_args: &[&str],
    video_id: i64,
) -> Result<()> {
    let src_size = std::fs::metadata(src).map(|m| m.len()).unwrap_or(0);
    // ffmpeg は進捗を黙って書くので、出力ファイルの肥え方を横から量って進捗にする。
    // remux は入力をほぼそのまま書くため 出力/入力 の比がそのまま進捗になる
    let stop = Arc::new(AtomicBool::new(false));
    let poller = (src_size > 0).then(|| {
        let out = out.to_path_buf();
        let stop = stop.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                if let Ok(m) = std::fs::metadata(&out) {
                    let pct = 5 + m.len().min(src_size) * 90 / src_size;
                    set_progress(video_id, pct);
                }
                std::thread::sleep(Duration::from_millis(120));
            }
        })
    });

    let output = ffmpeg::command(&ff.ffmpeg)
        .args(["-v", "error", "-nostdin", "-y"])
        .args(["-display_rotation", &ccw_deg.to_string()])
        .arg("-i")
        .arg(src)
        // 映像・音声・字幕・チャプターを丸ごと写す(再エンコードなし)
        .args(map_args)
        .args(["-c", "copy", "-map_metadata", "0"])
        .arg(out)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .context("无法启动 ffmpeg")?;

    stop.store(true, Ordering::Relaxed);
    if let Some(p) = poller {
        let _ = p.join();
    }

    if output.status.success() && out.exists() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&output.stderr);
    let tail: String = err.lines().rev().take(3).collect::<Vec<_>>().join(" / ");
    bail!("写入旋转信息失败：{tail}");
}

#[cfg(test)]
mod tests {
    use super::normalize_cw;

    #[test]
    fn normalizes_to_clockwise_quarters() {
        assert_eq!(normalize_cw(0), 0);
        assert_eq!(normalize_cw(90), 90);
        assert_eq!(normalize_cw(180), 180);
        assert_eq!(normalize_cw(-90), 270);
        assert_eq!(normalize_cw(-180), 180);
        assert_eq!(normalize_cw(-270), 90);
        assert_eq!(normalize_cw(450), 90);
        // 端数は最寄りへ
        assert_eq!(normalize_cw(-45), 0);
        assert_eq!(normalize_cw(44), 0);
        assert_eq!(normalize_cw(46), 90);
    }
}
