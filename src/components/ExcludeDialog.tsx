import { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { api } from '../api';

/**
 * 文件夹ツリーから「注册到监控排除文件夹」を選んだときの確認(v1.33)。
 *
 * 配下の登録を外すかどうかをここで決めさせる。外さないと、除外したのに
 * 一覧には残ったまま(次のスキャンで増えないだけ)になって分かりにくいので、
 * 既定は「外す」。**どちらを選んでも文件は消えない**
 */
export function ExcludeDialog({
  path, videoCount, onDone, onClose,
}: {
  path: string;
  /** この文件夹配下に今ある登録数 */
  videoCount: number;
  onDone: (removed: number) => void;
  onClose: () => void;
}) {
  const [removeVideos, setRemoveVideos] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      onDone(await api.addExcludedPaths([path], removeVideos));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <EyeOff size={18} /> 注册到监控排除文件夹
        </div>
        <div className="settings-note">
          <code>{path}</code> 的下级将不再从后续扫描中导入。
          即使在监视文件夹内也会被忽略。<strong>不会删除文件。</strong>
        </div>

        {videoCount > 0 && (
          <label className="settings-row">
            <input
              type="checkbox"
              checked={removeVideos}
              onChange={(e) => setRemoveVideos(e.target.checked)}
            />
            <span>
              现有注册的 {videoCount.toLocaleString()} 个也一并从媒体库移除
              <span className="settings-note">
                若不按此操作，被排除文件夹中的视频会一直留在列表里
              </span>
            </span>
          </label>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy} onClick={run}>
            {busy ? '登记中…' : '注册到监控排除文件夹'}
          </button>
        </div>
      </div>
    </div>
  );
}
