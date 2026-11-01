use crate::core::playback;
use crate::AppState;
use tauri::{AppHandle, State};

/// 動画を再生用 mp4 に変換する(完了までブロック)。キャッシュ mp4 の絶対パスを返す。
/// 進捗は transcode:progress イベントで通知される
#[tauri::command]
pub async fn prepare_video(app: AppHandle, id: i64, mode: String) -> Result<String, String> {
    if mode != "remux" && mode != "transcode" {
        return Err(format!("无效的 mode: {mode}"));
    }
    tauri::async_runtime::spawn_blocking(move || playback::prepare(&app, id, &mode))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// 進行中の変換を中止する(準備中にプレイヤーを閉じたとき)
#[tauri::command]
pub fn cancel_prepare(state: State<AppState>) -> Result<(), String> {
    playback::kill_current(&state);
    Ok(())
}

/// プレビュー再生用の低ビットレート mp4 を用意する(転码はバックグラウンド)。
/// すぐに状態を返す: `ready=false` の間はフロントが元ファイルで再生を始め、
/// `progress` を進捗バーに出し、`ready=true` になったら `path` に切り替える
#[tauri::command]
pub fn prepare_preview(
    app: AppHandle,
    id: i64,
) -> Result<playback::PreviewStatus, String> {
    playback::prepare_preview(&app, id).map_err(|e| e.to_string())
}

/// プレビューの状態だけを聞く(転码は起こさない)。フロントのポーリング用
#[tauri::command]
pub fn preview_status(
    app: AppHandle,
    id: i64,
) -> Result<playback::PreviewStatus, String> {
    playback::preview_status(&app, id).map_err(|e| e.to_string())
}

/// プレビーキャッシュを全削除する(設定の「削除」ボタン用)
#[tauri::command]
pub fn purge_preview_cache(state: State<AppState>) -> Result<(usize, u64), String> {
    Ok(playback::purge_preview_cache(&state.preview_dir))
}

/// 元動画の表示方向を 90 度回す(MP4/MOV のみ。再エンコードなし)。
/// 実処理はバックグラウンドタスクへ投げて即座に返す。進捗は `rotate_status` で拾う
#[tauri::command]
pub fn rotate_video(app: AppHandle, id: i64, dir: String) -> Result<(), String> {
    let d = crate::core::rotate::RotateDir::parse(&dir)
        .ok_or_else(|| format!("未知の回転方向: {dir}"))?;
    crate::core::rotate::start(&app, id, d);
    Ok(())
}

/// 回転タスクの進捗一覧(実行中 + 直近完了)
#[tauri::command]
pub fn rotate_status() -> Vec<crate::core::rotate::RotateTaskState> {
    crate::core::rotate::snapshot()
}

/// プレビーキャッシュの現在量(件数, バイト)
#[tauri::command]
pub fn preview_cache_size(state: State<AppState>) -> Result<(usize, u64), String> {
    Ok(playback::preview_cache_size(&state.preview_dir))
}
