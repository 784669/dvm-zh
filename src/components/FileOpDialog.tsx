import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useShallow } from 'zustand/react/shallow';
import { pickState, useLibrary } from '../store';
import type { FileOpProgress, OpResult, PlanItem, PlanStatus } from '../types';

const STATUS_LABEL: Record<PlanStatus, string> = {
  ok: '执行',
  conflict: '目标位置存在同名文件',
  sourceMissing: '找不到原文件',
  offline: '驱动器未连接',
  unchanged: '无变化',
};

export type FileOpKind = 'relink' | 'move' | 'rename' | 'trash';

const TITLE: Record<FileOpKind, string> = {
  relink: '重新链接路径',
  move: '移动文件',
  rename: '重命名文件',
  trash: '将文件送入回收站',
};

const DESCRIPTION: Record<FileOpKind, string> = {
  relink: '仅改写数据库中的路径。不会移动文件。',
  move: '将移动实际文件。此操作无法撤销（可通过反向移动恢复）。',
  rename: '将重命名实际文件。此操作无法撤销。',
  trash:
    '将文件送入回收站，随后删除媒体库注册。' +
    '从回收站恢复后重新扫描即可重新显示，但标签、评分、观看次数不会恢复。',
};

/**
 * 文件操作の確認ダイアログ(v1.9)。
 * **必ず dry-run の結果を表で見せてから実行する**。
 * 実行できない行(衝突·元が無い·未接続)は自動的に対象外にする
 */
export function FileOpDialog({
  kind,
  plan,
  onClose,
}: {
  kind: FileOpKind;
  plan: PlanItem[];
  onClose: () => void;
}) {
  const { bumpVersion, pushToast, clearSelection } = useLibrary(
    useShallow(pickState('bumpVersion', 'pushToast', 'clearSelection')),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<FileOpProgress | null>(null);
  const [results, setResults] = useState<OpResult[] | null>(null);

  useEffect(() => {
    const un = listen<FileOpProgress>('fileop:progress', (e) => setProgress(e.payload));
    return () => {
      un.then((u) => u());
    };
  }, []);

  const actionable = plan.filter((p) => p.status === 'ok');
  const skipped = plan.length - actionable.length;

  const run = async () => {
    setBusy(true);
    try {
      const r =
        kind === 'relink'
          ? await api.applyRelink(actionable)
          : kind === 'trash'
            ? await api.applyTrash(actionable)
            : await api.applyMove(actionable, kind === 'move' ? 'move_file' : 'rename_file');
      setResults(r);
      const failed = r.filter((x) => !x.ok || x.error);
      if (failed.length > 0) {
        pushToast(`${failed.length} 项失败`);
      } else {
        pushToast(`${r.length} 项已处理`, 'info');
      }
      clearSelection();
      bumpVersion();
    } catch {
      // 失敗は api 側でトースト済み。ダイアログは開いたままにして状況を見せる
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal fileop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{TITLE[kind]}</div>
        <div className="settings-note">{DESCRIPTION[kind]}</div>

        {results ? (
          <>
            <div className="settings-heading">执行結果</div>
            <div className="fileop-table">
              {results.map((r) => (
                <div key={r.videoId} className="fileop-row">
                  <span className={`fileop-status ${r.ok && !r.error ? 'ok' : 'ng'}`}>
                    {r.ok && !r.error ? '完了' : '失敗'}
                  </span>
                  <span className="fileop-path" title={r.to}>{r.to}</span>
                  {r.error && <span className="fileop-note">{r.error}</span>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="settings-heading">
              对象 {actionable.length} 件
              {skipped > 0 && <span className="fileop-skipped">(排除 {skipped} 件)</span>}
            </div>
            <div className="fileop-table">
              {plan.length === 0 && <div className="stats-empty">没有对象</div>}
              {plan.map((p) => (
                <div
                  key={p.videoId}
                  className={`fileop-row ${p.status === 'ok' ? '' : 'excluded'}`}
                >
                  <span className={`fileop-status ${p.status === 'ok' ? 'ok' : 'ng'}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                  <span className="fileop-paths">
                    <span className="fileop-path from" title={p.from}>{p.from}</span>
                    <span className="fileop-path to" title={p.to}>→ {p.to}</span>
                  </span>
                  {p.note && <span className="fileop-note">{p.note}</span>}
                </div>
              ))}
            </div>
            {progress && progress.total > 0 && (
              <div className="prepare-bar">
                <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            {results ? '关闭' : '取消'}
          </button>
          {!results && (
            <button className="primary" onClick={run} disabled={busy || actionable.length === 0}>
              {busy ? '执行中...' : `${actionable.length} 项，执行`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
