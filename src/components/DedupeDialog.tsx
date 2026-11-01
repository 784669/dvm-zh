import { ask } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { CopyMinus, ListX, Loader2, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { DedupePlan, DedupeResult } from '../types';

/**
 * 重複解消の確認ダイアログ(v1.33)。
 *
 * **下見を見せてからでないと実行させない。** 開いた時点で `plan_dedupe` を呼び、
 * 何本外れて何が残るのかを出してからボタンを押させる。
 * 実行しても文个は触らない(媒体库の登録を外すだけ)ので、
 * ごみ箱送りのような二段構えの警告までは出していない。
 */
export function DedupeDialog({
  scope, onDone, onClose,
}: {
  /** 対象文件夹。未指定なら媒体库全体 */
  scope?: string;
  onDone: (result: DedupeResult, trashed: boolean) => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<DedupePlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.planDedupe(scope).then((p) => {
      if (alive) setPlan(p);
    }).catch(() => onClose());
    return () => { alive = false; };
  }, [scope, onClose]);

  /**
   * ごみ箱送りは**もう一段確認する**。下見は見せてあるが、登録を外すのと違って
   * 文件が動くので、押し間違いで通り抜けないようにする
   */
  const run = async (trashFiles: boolean) => {
    if (trashFiles) {
      const yes = await ask(
        `将 ${plan?.removeCount.toLocaleString()} 个重复文件送入 Windows 回收站。\n\n` +
          '每个分组中要保留的那 1 个不会被改动。\n' +
          '从回收站恢复后重新扫描即可还原。\n\n' +
          '确定执行吗？',
        { title: '将文件送入回收站', kind: 'warning' },
      );
      if (!yes) return;
    }
    setBusy(true);
    try {
      onDone(await api.applyDedupe(scope, trashFiles), trashFiles);
    } finally {
      setBusy(false);
    }
  };

  const nothing = plan !== null && plan.removeCount === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dedupe-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <CopyMinus size={18} /> 消除重复
        </div>
        <div className="settings-note">
          {scope ? <>对象: <code>{scope}</code>  的下级</> : '对象为整个媒体库'}
        </div>

        {plan === null && (
          <div className="dedupe-loading"><Loader2 className="spin" />  正在统计重复…</div>
        )}

        {plan !== null && (
          <>
            <div className="dedupe-summary">
              <div className="dedupe-stat">
                <span className="dedupe-num">{plan.removeCount.toLocaleString()}</span>
                <span className="dedupe-label">移出媒体库</span>
              </div>
              <div className="dedupe-stat">
                <span className="dedupe-num">{plan.groups.toLocaleString()}</span>
                <span className="dedupe-label">保留数量(每组 1 个)</span>
              </div>
            </div>

            <div className="settings-note">
              内容相同（大小与首部哈希一致）的视频只保留 1 个。
              带标签、评分、观看历史的视频优先保留。
              按下方哪一个按钮，决定保留还是丢弃文件。
            </div>

            {(plan.skippedOutside > 0 || plan.skippedZeroSize > 0) && (
              <div className="settings-note dedupe-skipped">
                {plan.skippedOutside > 0 && (
                  <div>
                    {plan.skippedOutside.toLocaleString()} 个分组，相同内容在此文件夹
                    之外也存在，故不处理
                  </div>
                )}
                {plan.skippedZeroSize > 0 && (
                  <div>
                    {plan.skippedZeroSize.toLocaleString()} 个分组是 0 字节文件，
                    不在处理范围（内容未必相同）
                  </div>
                )}
              </div>
            )}

            {plan.byFolder.length > 0 && (
              <div className="dedupe-breakdown">
                <div className="dedupe-breakdown-title">包含待移出视频的文件夹</div>
                <ul>
                  {plan.byFolder.map((f) => (
                    <li key={f.path}>
                      <span className="dedupe-path" title={f.path}>{f.path}</span>
                      <span className="dedupe-count">{f.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.samples.length > 0 && (
              <details className="dedupe-samples">
                <summary>保留与移除的示例（共 {plan.samples.length} 组）</summary>
                {plan.samples.map((s) => (
                  <div className="dedupe-sample" key={s.keep}>
                    <div className="dedupe-keep" title={s.keep}>保留: {s.keep}</div>
                    {s.remove.map((r) => (
                      <div className="dedupe-remove" key={r} title={r}>移除: {r}</div>
                    ))}
                  </div>
                ))}
              </details>
            )}
          </>
        )}

        {/*
          削除先の選び方は Delete キーのダイアログ(DeleteDialog)と同じ作法にそろえる。
          「何が起きるか」を選択肢の中に書いて、押す前に結果が分かるようにする
        */}
        {plan !== null && !nothing && (
          <div className="delete-choices">
            <button className="delete-choice" disabled={busy} onClick={() => void run(false)}>
              <ListX />
              <span>
                <span className="delete-choice-title">
                  将 {plan.removeCount.toLocaleString()} 个从媒体库移除
                </span>
                <span className="delete-choice-note">
                  只删除注册信息。文件仍留在原位置
                </span>
              </span>
            </button>

            <button className="delete-choice danger" disabled={busy} onClick={() => void run(true)}>
              <Trash2 />
              <span>
                <span className="delete-choice-title">
                  将 {plan.removeCount.toLocaleString()} 个文件送入回收站
                </span>
                <span className="delete-choice-note">
                  将重复文件送入回收站，并删除注册（不触碰保留的那 1 个）
                </span>
              </span>
            </button>
          </div>
        )}

        <div className="modal-actions">
          {busy && <span className="settings-note">执行中…</span>}
          <button onClick={onClose}>{nothing ? '关闭' : '取消'}</button>
        </div>
      </div>
    </div>
  );
}
