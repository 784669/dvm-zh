import { ask, message, open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import { api } from '../../api';
import { useFlagSetting, useTextSetting } from '../../hooks/useSetting';
import { fmtSize } from '../../lib/format';
import type { AppInfo } from '../../types';

/**
 * 缩略图与帧(v1.38 で「缩略图」と「帧的保存」を 1 カテゴリにまとめた)。
 *
 * どちらも「動画から静止画を作る」機能。封面图の設定と「全部重新生成」は
 * **切り離さない** —— 封面图の設定は次に作るぶんからしか効かないので、
 * 既存分に反映する手段が隣に無いと意味が通らない(DESIGN.md 参照)。
 */
export function ThumbnailSection({
  info,
  reloadInfo,
  onClose,
}: {
  info: AppInfo | null;
  reloadInfo: () => void;
  /** 再生成は進捗をステータスバーに出すので、始めたらモーダルを关闭 */
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  /** 次に缩略图を作るときから効く(既存の缩略图は「全部重新生成」で作り直す) */
  const [useEmbeddedCover, setUseEmbeddedCover] = useFlagSetting('use_embedded_cover', true);
  /** コマの画像の保存先(v1.26)。空欄なら AppInfo.framesDir(ピクチャ\DVM) */
  const frameSaveDir = useTextSetting('frame_save_dir');

  const regenerate = async (onlyFailed: boolean) => {
    const yes = await ask(
      onlyFailed
        ? '只重新生成失败的缩略图吗？'
        : '要重新生成全部缩略图吗？数量较多时会耗时。',
      { title: '重新生成缩略图' },
    );
    if (!yes) return;
    const count = await api.regenerateThumbnails(onlyFailed);
    if (count === 0) {
      await message('没有符合条件的缩略图', { title: '重新生成缩略图' });
    }
    // 進捗は画面下部のステータスバーに表示される
    onClose();
  };

  /** 媒体库から外した動画の缩略图が残っていたら消す */
  const purgeOrphans = async () => {
    setBusy(true);
    try {
      const r = await api.purgeOrphanThumbnails();
      await message(
        r.removed === 0
          ? '没有多余的缩略图'
          : `${r.removed} 件(${fmtSize(r.freedBytes)}）已删除`,
        { title: '清理孤立缩略图' },
      );
      reloadInfo();
    } finally {
      setBusy(false);
    }
  };

  const browseFrameDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '画面截图的保存文件夹',
    });
    // ダイアログで選んだ値は確定済みなので、blur を待たずに書く
    if (typeof selected === 'string') frameSaveDir.save(selected);
  };

  return (
    <>
      <div className="settings-section">
        <div className="settings-heading">缩略图</div>
        <div className="modal-row">
          <button onClick={() => regenerate(true)}>重新生成失败的部分</button>
          <button onClick={() => regenerate(false)}>全部重新生成</button>
          <button onClick={purgeOrphans} disabled={busy}>
            清理孤立缩略图
          </button>
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={useEmbeddedCover}
            onChange={(e) => setUseEmbeddedCover(e.target.checked)}
          />
          若视频内嵌封面图则用作缩略图（生成更快，画面也更准确）
        </label>
        <div className="settings-note">
          此设置从下次生成的缩略图起生效。若要让现有缩略图也生效，
          请按「全部重新生成」。
          播放中按缩略图按钮（T 键），可将该位置单独设为缩略图。
          手动指定的画面优先于封面图
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-heading">帧的保存</div>
        <label className="modal-label">
          保存文件夹（留空则为 {info?.framesDir ?? '图片\\DVM'}）
        </label>
        <div className="modal-row">
          <input
            value={frameSaveDir.value}
            placeholder={info?.framesDir ?? ''}
            onChange={(e) => frameSaveDir.edit(e.target.value)}
            onBlur={frameSaveDir.commit}
          />
          <button onClick={browseFrameDir}>浏览...</button>
        </div>
        <div className="modal-row">
          <button onClick={() => api.openFrameDir()}>打开保存位置</button>
          <button onClick={() => frameSaveDir.save('')} disabled={frameSaveDir.value === ''}>
            恢复默认
          </button>
        </div>
        <div className="settings-note">
          播放中按相机按钮（S 键）会将当前画面保存为 PNG。
          直接从原始视频按原尺寸提取，因此不会拍入字幕或控制栏。
          若存在同名文件，不会覆盖而是自动加序号
        </div>
      </div>
    </>
  );
}
