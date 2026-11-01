import { ask, message } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useTextSetting } from '../../hooks/useSetting';
import { fmtSize } from '../../lib/format';
import { CACHE_GB_DEFAULT, CACHE_GB_MAX, CACHE_GB_MIN, parseCacheGb } from '../../lib/settings';
import type { AppInfo, BackupInfo } from '../../types';

/**
 * 数据存储位置と备份(v1.38 で 1 カテゴリにまとめた)。
 *
 * どちらも「媒体库の中身がディスクのどこにどれだけあるか」の話で、
 * 見せる情報(AppInfo)も共通している。
 */
export function DataSection({
  info,
  reloadInfo,
}: {
  info: AppInfo | null;
  reloadInfo: () => void;
}) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<[number, number]>([0, 0]);
  /**
   * 変換キャッシュの上限 GB(v1.38。それまでは読み手だけで UI が無かった)。
   * 確定時に parseCacheGb を通すので、**0 や壊れた値が DB に入らない** ——
   * 0 のまま Rust に渡ると、変換のたびにキャッシュが全消しになる
   */
  const cacheGb = useTextSetting('transcode_cache_limit_gb', {
    // 未設定でも欄は既定の 20 を出す(placeholder では「今いくつなのか」が伝わらない)
    defaultValue: String(CACHE_GB_DEFAULT),
    normalize: (s) => String(parseCacheGb(s)),
  });

  useEffect(() => {
    api.listDbBackups().then(setBackups).catch(() => {});
  }, []);

  useEffect(() => {
    api.previewCacheSize().then(setPreview).catch(() => {});
  }, []);

  /** 上限を超えているぶんを古い順に削る。減った量は AppInfo を取り直して見せる */
  const purgeCache = async () => {
    setBusy(true);
    try {
      await api.purgeTranscodeCache();
      reloadInfo();
    } finally {
      setBusy(false);
    }
  };

  /** プレビューキャッシュを全削除する(設定の「削除」ボタン用) */
  const purgePreview = async () => {
    setBusy(true);
    try {
      await api.purgePreviewCache();
      setPreview(await api.previewCacheSize());
    } finally {
      setBusy(false);
    }
  };

  /** 復元を予約する。実際の差し替えは次回起動時 */
  const restore = async (b: BackupInfo) => {
    const yes = await ask(
      `要从「${b.fileName}」（${b.createdAt}）还原吗？\n\n` +
        '当前媒体库（含标签·评分·观看历史）将替换为该备份的内容。\n' +
        '视频文件本身不受影响。\n\n' +
        '还原将在应用重启后生效。',
      { title: '从备份还原' },
    );
    if (!yes) return;
    setBusy(true);
    try {
      const safety = await api.restoreBackup(b.path);
      await message(
        `已预约还原。重启应用后生效。\n\n` +
          `当前数据已保存为 ${safety}。`,
        { title: '从备份还原' },
      );
      setBackups(await api.listDbBackups());
    } finally {
      setBusy(false);
    }
  };

  const backupNow = async () => {
    setBusy(true);
    try {
      await api.backupDb();
      setBackups(await api.listDbBackups());
      reloadInfo();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="settings-section">
        <div className="settings-heading">数据存储位置</div>
        {info && (
          <div className="settings-info">
            <div className="settings-info-row">
              <span>媒体库「{info.libraryName}」</span>
              <span className="settings-path" title={info.libraryRoot}>{info.libraryRoot}</span>
            </div>
            <div className="settings-info-row">
              <span>数据文件夹(整个应用)</span>
              <span className="settings-path" title={info.dataDir}>{info.dataDir}</span>
            </div>
            <div className="settings-info-row">
              <span>数据库</span>
              <span>{fmtSize(info.dbSize)}</span>
            </div>
            <div className="settings-info-row">
              <span>缩略图缓存</span>
              <span>
                {info.thumbCount} 件 / {fmtSize(info.thumbCacheSize)}
              </span>
            </div>
          </div>
        )}
        <div className="settings-note">
          视频·标签·缩略图·备份都在媒体库文件夹内。
          只有设置和播放用的转换缓存位于应用全局数据文件夹
        </div>
        <div className="modal-row">
          <button onClick={() => api.openLibraryDir()}>打开媒体库文件夹</button>
          <button onClick={() => api.openDataDir()}>打开数据文件夹</button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-heading">播放用转码缓存</div>
        {info && (
          <div className="settings-info">
            <div className="settings-info-row">
              <span>当前用量(所有媒体库合计)</span>
              <span>
                {info.transcodeCount} 件 / {fmtSize(info.transcodeSize)}
              </span>
            </div>
          </div>
        )}
        <label className="modal-label">上限</label>
        <div className="modal-row settings-cache-limit">
          <input
            type="number"
            min={CACHE_GB_MIN}
            max={CACHE_GB_MAX}
            step={1}
            value={cacheGb.value}
            onChange={(e) => cacheGb.edit(e.target.value)}
            onBlur={cacheGb.commit}
          />
          <span className="settings-unit">GB</span>
          <button onClick={purgeCache} disabled={busy}>立即清理</button>
        </div>
        <div className="settings-note">
          mpv 无法直接播放的格式会先转换为 mp4 再播放。此处是这些转换结果的
          缓存上限。超出部分按最旧优先删除，删除后重新播放即可重建，
          因此调小也不会丢失任何东西（在下次转换或应用启动时生效）
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-heading">预览缓存</div>
        <div className="settings-info">
          <div className="settings-info-row">
            <span>当前用量</span>
            <span>
              {preview[0]} 件 / {fmtSize(preview[1])}
            </span>
          </div>
        </div>
        <div className="modal-row">
          <button onClick={purgePreview} disabled={busy}>清理预览缓存</button>
        </div>
        <div className="settings-note">
          在卡片上点击「播放降码预览」后生成的低码率预览文件。不会自动删除，
          仅在点击「清理预览缓存」时清除。切换预览画质后产生的旧画质文件也会一并清除
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-heading">备份</div>
        <div className="modal-row">
          <button onClick={backupNow} disabled={busy}>
            {busy ? '正在备份...' : '立即备份'}
          </button>
          <button onClick={() => api.openBackupsDir()}>打开备份文件夹</button>
        </div>
        {backups.length > 0 && (
          <div className="settings-backup-list">
            {backups.map((b) => (
              <div key={b.fileName} className="settings-info-row">
                <span className="settings-path" title={b.path}>{b.fileName}</span>
                <span>
                  {fmtSize(b.size)} · {b.createdAt}
                </span>
                <button className="backup-restore" onClick={() => restore(b)}>
                  还原
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="settings-note">
          还原将在应用重启时生效（运行中替换 library.db 会损坏数据）。
          还原前会自动将当前数据备份为 pre-restore-...
        </div>
      </div>
    </>
  );
}
