//! 应用标识（identifier）变更带来的一次性数据迁移。
//!
//! 本分支为了让「中文增强版」能与官方 DVM 并装共存，把 identifier 从
//! `jp.demo2.dvm` 换成了 `jp.demo2.dvm.zh`。Tauri 的 `app_data_dir()` 由
//! identifier 决定，换过之后第一次启动看到的会是一个空库。
//!
//! 这里在启动的最早期把旧目录搬过来：
//!
//! 1. `app.db`（含 `-wal` / `-shm`）与 `libraries/` 原样复制
//! 2. 把 `libraries.root` 里指向旧目录的绝对路径改写为新目录 —— 只复制文件
//!    的话路径还指着旧目录，等于没搬
//! 3. 成功后在目录里留一个标记；失败则把半成品清掉，下次启动重试
//!
//! `preview/` 与 `transcode/` 是派生缓存，不复制（用到时会自己重建）。

use anyhow::{bail, Context, Result};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// 官方 DVM 使用的标识（旧目录名）
pub const LEGACY_IDENTIFIER: &str = "jp.demo2.dvm";
/// 中文增强版使用的标识
pub const IDENTIFIER: &str = "jp.demo2.dvm.zh";

/// 迁移完成标记，内容为来源目录
const MARKER: &str = ".migrated-from-legacy";

/// 同级的旧数据目录（`%APPDATA%\jp.demo2.dvm`）
pub fn legacy_dir(new_dir: &Path) -> Option<PathBuf> {
    Some(new_dir.parent()?.join(LEGACY_IDENTIFIER))
}

/// 需要迁移时执行一次，返回 `true` 表示这次真的搬了数据。
///
/// 只在「新目录还没有 app.db」且「旧目录有 app.db」时动手，因此重复调用
/// 是安全的。迁移失败不会阻塞启动：调用方应当只记日志，让用户仍能开一个新库。
pub fn migrate_from_legacy(new_dir: &Path) -> Result<bool> {
    if new_dir.join("app.db").exists() {
        return Ok(false);
    }
    let Some(legacy) = legacy_dir(new_dir) else {
        return Ok(false);
    };
    if !legacy.join("app.db").exists() {
        return Ok(false);
    }

    fs::create_dir_all(new_dir)
        .with_context(|| format!("创建数据目录失败: {}", new_dir.display()))?;

    // 先复制数据库三件套。放在最前面，复制失败时还没动 libraries，
    // 清起来最省事
    for name in ["app.db", "app.db-wal", "app.db-shm"] {
        let from = legacy.join(name);
        if from.exists() {
            fs::copy(&from, new_dir.join(name))
                .with_context(|| format!("复制 {name} 失败"))?;
        }
    }

    let result = (|| -> Result<()> {
        let from_libs = legacy.join("libraries");
        if from_libs.is_dir() {
            copy_dir(&from_libs, &new_dir.join("libraries"))
                .context("复制 libraries 目录失败")?;
        }
        let rewritten = rewrite_roots(&new_dir.join("app.db"), &legacy, new_dir)?;
        let marker = format!("{}\nrewritten: {rewritten}\n", legacy.display());
        let _ = fs::write(new_dir.join(MARKER), marker);
        Ok(())
    })();

    if let Err(e) = result {
        // 回滚：删掉半成品，下次启动会重新尝试（libraries 是纯复制，留着无妨）
        for name in ["app.db", "app.db-wal", "app.db-shm"] {
            let _ = fs::remove_file(new_dir.join(name));
        }
        return Err(e);
    }
    Ok(true)
}

/// 把 `libraries.root` 中指向旧目录的前缀换成新目录，并做一次完整性检查。
///
/// 返回改写的行数。路径比较按 Windows 习惯忽略 ASCII 大小写。
fn rewrite_roots(db: &Path, legacy: &Path, new_dir: &Path) -> Result<usize> {
    let mut conn = Connection::open(db)
        .with_context(|| format!("打开迁移后的 app.db 失败: {}", db.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS libraries (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           root TEXT NOT NULL,
           volume_serial TEXT,
           sort_order INTEGER NOT NULL DEFAULT 0,
           last_opened_at TEXT
         );",
    )?;

    let rows: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, root FROM libraries")?;
        let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        mapped.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let old_prefix = legacy.to_string_lossy().into_owned();
    let new_prefix = new_dir.to_string_lossy().into_owned();
    let mut rewritten = 0usize;
    {
        let tx = conn.transaction()?;
        for (id, root) in rows {
            let Some(rest) = strip_prefix_ignore_case(&root, &old_prefix) else {
                continue;
            };
            let moved = format!("{new_prefix}{rest}");
            tx.execute(
                "UPDATE libraries SET root = ?1 WHERE id = ?2",
                rusqlite::params![moved, id],
            )?;
            rewritten += 1;
        }
        tx.commit()?;
    }

    let status: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .context("迁移后的 app.db 完整性检查失败")?;
    if status != "ok" {
        bail!("迁移后的 app.db 未通过完整性检查: {status}");
    }
    Ok(rewritten)
}

/// `s` 以 `prefix` 开头时返回去掉前缀的剩余部分。大小写不敏感，且不会在
/// 多字节字符中间切断（用户名可能是中文）。
fn strip_prefix_ignore_case(s: &str, prefix: &str) -> Option<String> {
    if s.len() < prefix.len() {
        return None;
    }
    match s.get(..prefix.len()) {
        Some(head) if head.eq_ignore_ascii_case(prefix) => Some(s[prefix.len()..].to_string()),
        _ => None,
    }
}

fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), &to)?;
        }
        // 符号链接/其它类型跳过：库目录里不该出现，硬搬反而危险
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_prefix_handles_case_and_multibyte() {
        assert_eq!(
            strip_prefix_ignore_case(
                r"C:\Users\x\AppData\Roaming\jp.demo2.dvm\libraries\a",
                r"c:\users\x\appdata\roaming\jp.demo2.dvm"
            ),
            Some(r"\libraries\a".to_string())
        );
        // 中文用户名不能把切片切在多字节字符中间
        let s = r"C:\Users\老邢\AppData\Roaming\jp.demo2.dvm\libraries\我的库";
        let p = r"C:\Users\老邢\AppData\Roaming\jp.demo2.dvm";
        assert_eq!(strip_prefix_ignore_case(s, p), Some(r"\libraries\我的库".to_string()));
        assert_eq!(strip_prefix_ignore_case(s, "D:\\other"), None);
    }

    #[test]
    fn legacy_dir_is_sibling() {
        let new_dir = Path::new(r"C:\Users\x\AppData\Roaming\jp.demo2.dvm.zh");
        assert_eq!(
            legacy_dir(new_dir).unwrap(),
            PathBuf::from(r"C:\Users\x\AppData\Roaming\jp.demo2.dvm")
        );
    }

    /// 迁移是真的搬数据：库文件到位、路径改写、原目录不动、重复调用不再搬
    #[test]
    fn migrates_files_and_rewrites_roots() {
        let base = std::env::temp_dir().join(format!("dvm-migrate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let legacy = base.join(LEGACY_IDENTIFIER);
        let new_dir = base.join(IDENTIFIER);
        let old_lib = legacy.join("libraries").join("我的库");
        fs::create_dir_all(&old_lib).unwrap();
        fs::write(old_lib.join("library.db"), b"x").unwrap();

        {
            let conn = Connection::open(legacy.join("app.db")).unwrap();
            conn.execute_batch(
                "CREATE TABLE libraries (id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO libraries (id, name, root) VALUES ('abc', '我的库', ?1)",
                [old_lib.to_string_lossy().to_string()],
            )
            .unwrap();
        }

        assert!(migrate_from_legacy(&new_dir).unwrap());

        // 库文件复制过来了
        assert!(new_dir.join("libraries").join("我的库").join("library.db").is_file());
        // 路径改到了新目录，而不是继续指着旧的
        let conn = Connection::open(new_dir.join("app.db")).unwrap();
        let root: String = conn
            .query_row("SELECT root FROM libraries WHERE id = 'abc'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(root, new_dir.join("libraries").join("我的库").to_string_lossy());
        drop(conn);
        // 原目录保持原样，官方版还能继续用
        assert!(legacy.join("app.db").is_file());
        // 第二次调用什么都不做
        assert!(!migrate_from_legacy(&new_dir).unwrap());

        let _ = fs::remove_dir_all(&base);
    }
}
