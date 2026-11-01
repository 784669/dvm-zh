//! 旋转备份（`*.dvm-bak`）的定期清理
//!
//! 旋转是改写容器的 display matrix、不重新编码，所以原文件唯一的退路就是同目录下的
//! `xxx.mp4.dvm-bak`。这份备份和原片一样大（GoPro 素材动辄几百 MB），堆久了很可观。
//!
//! 启动时在后台清一遍，但**只清 [RETENTION_DAYS] 天以前的** —— 给「转完发现角度选错」
//! 留一个撤销窗口，不至于刚转完关掉程序就永久失去回退能力。
//!
//! 扫描范围是媒体库根目录 + 所有监视文件夹（遵守各文件夹的 recursive 设定）。
//! 刻意不按数据库记录去推导 `path + ".dvm-bak"`，而是直接遍历目录：这样
//! 「视频已从库中删掉、备份还躺在盘上」的孤儿文件也能一起清掉。

use std::path::Path;
use std::time::{Duration, SystemTime};

use anyhow::Result;
use walkdir::WalkDir;

use super::{excludes, offline};
use crate::AppState;

/// 备份保留天数。改这里就能调撤销窗口
pub const RETENTION_DAYS: u64 = 7;

#[derive(Debug, Default, Clone, Copy)]
pub struct CleanupReport {
    /// 删掉的备份文件数
    pub removed: usize,
    /// 释放的字节数
    pub bytes: u64,
    /// 删除失败的文件数（占用中、只读、权限等）
    pub failed: usize,
}

impl CleanupReport {
    pub fn megabytes(&self) -> f64 {
        self.bytes as f64 / 1_048_576.0
    }
}

fn is_backup_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_ascii_lowercase().ends_with(".dvm-bak"))
        .unwrap_or(false)
}

/// 库自己的内部目录，不可能藏着旋转备份，白扫一遍浪费时间（thumbnails 可能上千个）
fn is_library_internal(name: &str) -> bool {
    matches!(name, "thumbs" | "backups")
}

fn older_than_days(modified: SystemTime, days: u64) -> bool {
    match SystemTime::now().duration_since(modified) {
        Ok(age) => age > Duration::from_secs(days * 86_400),
        // mtime 落在未来（系统时间被改过、网络盘时钟不同步）时一律不删，
        // 宁可留着也不能误删刚产生的备份
        Err(_) => false,
    }
}

/// 扫描媒体库根目录与所有监视文件夹，删除超过保留期的旋转备份
pub fn purge_old_backups(state: &AppState) -> Result<CleanupReport> {
    let (roots, excluded) = {
        let conn = state.db.lock().unwrap();
        let mut roots: Vec<(String, bool)> =
            vec![(state.library_root.to_string_lossy().into_owned(), true)];
        let mut stmt = conn.prepare("SELECT path, recursive FROM watched_folders")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0))
        })?;
        for row in rows.flatten() {
            roots.push(row);
        }
        (roots, excludes::list_normalized(&conn))
    };

    let mut report = CleanupReport::default();
    // 同一个根目录可能既是库根、又被加进监视文件夹，去重避免扫两遍
    let mut seen: Vec<String> = Vec::new();
    let mut drives = offline::RootCache::default();

    for (root, recursive) in roots {
        let key = excludes::normalize(&root);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        // 离线的盘 / NAS 一个 stat 都不做：机械盘唤醒和 SMB 超时能把启动拖成几十秒
        if !drives.is_online(&root) {
            continue;
        }
        let walker = if recursive {
            WalkDir::new(&root)
        } else {
            WalkDir::new(&root).max_depth(1)
        };
        let ex = excluded.clone();
        let entries = walker
            .into_iter()
            .filter_entry(move |e| {
                if e.file_type().is_dir() {
                    let name = e.file_name().to_string_lossy();
                    if is_library_internal(&name) {
                        return false;
                    }
                }
                !excludes::is_excluded(&ex, &e.path().to_string_lossy())
            })
            .filter_map(|e| e.ok());

        for entry in entries {
            if !entry.file_type().is_file() || !is_backup_file(entry.path()) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let Ok(modified) = meta.modified() else { continue };
            if !older_than_days(modified, RETENTION_DAYS) {
                continue;
            }
            match std::fs::remove_file(entry.path()) {
                Ok(()) => {
                    report.removed += 1;
                    report.bytes += meta.len();
                }
                Err(e) => {
                    report.failed += 1;
                    eprintln!("删除旋转备份失败 {}: {e}", entry.path().display());
                }
            }
        }
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_backup_names() {
        assert!(is_backup_file(Path::new(r"C:\v\a.mp4.dvm-bak")));
        // 大小写混写也要认（Windows 上文件名不区分大小写，但字符串比较区分）
        assert!(is_backup_file(Path::new(r"C:\v\a.mp4.DVM-BAK")));
        assert!(!is_backup_file(Path::new(r"C:\v\a.mp4")));
        assert!(!is_backup_file(Path::new(r"C:\v\a.mp4.dvmrot.mp4")));
        assert!(!is_backup_file(Path::new(r"C:\v\dvm-bak")));
    }

    #[test]
    fn retention_window() {
        let now = SystemTime::now();
        assert!(older_than_days(now - Duration::from_secs(8 * 86_400), 7));
        assert!(!older_than_days(now - Duration::from_secs(6 * 86_400), 7));
        // 刚产生的备份一定不能删
        assert!(!older_than_days(now, 7));
        // mtime 在未来：视为不可信，保留
        assert!(!older_than_days(now + Duration::from_secs(86_400), 7));
    }

    #[test]
    fn skips_library_internal_dirs() {
        assert!(is_library_internal("thumbs"));
        assert!(is_library_internal("backups"));
        assert!(!is_library_internal("我的媒体库"));
    }
}
