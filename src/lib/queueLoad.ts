import { ask } from '@tauri-apps/plugin-dialog';
import { composedQueue, loadedQueue, needsSavePrompt, QUEUE_LIMIT } from './queue';
import { useLibrary } from '../store';
import type { VideoRow } from '../types';

/**
 * 行の列で队列を丸ごと置き換えて再生を始める(v1.41)。
 * 播放列表の「载入队列并播放」と、智能文件夹 / 筛选結果の
 * 読み込み(C-4)が共用する。**判断の順序が要点**:
 *
 * 1. 空なら何もしない(既存の队列にも触らない)
 * 2. 手で編集した队列を黙って捨てない(A-29 と同じ確認)
 * 3. 上限超過は**先頭 500 个切り詰めて断る**。「全部断る」(addToQueue)と違うのは、
 *    こちらが「条个合うものを流す」入口で、800 件ヒットしたから 1 件も流れない、では
 *    目的を果たさないため
 * 4. 切り詰めたときは出所(source)を持たせない —— 500 个減った中身で
 *    「覆盖保存」されると、元のリストが黙って縮む
 */
export async function replaceQueueWith(
  all: VideoRow[],
  source: { id: number; name: string } | null,
  opts: { label: string; emptyMessage: string },
): Promise<void> {
  const s = useLibrary.getState();
  if (all.length === 0) {
    s.pushToast(opts.emptyMessage, 'info');
    return;
  }
  if (needsSavePrompt(s.queue)) {
    const yes = await ask(
      `要丢弃未保存的队列（${s.queue.items.length} 个）并\n读取${opts.label}吗？`,
      { title: '替换队列', kind: 'warning' },
    );
    if (!yes) return;
  }
  const rows = all.slice(0, QUEUE_LIMIT);
  const truncated = all.length > rows.length;
  // ask の間に队列が変わっていることがあるので、入れ直す直前に取り直す
  const st = useLibrary.getState();
  st.setQueue(source !== null && !truncated
    ? loadedQueue(rows, source.id, source.name)
    : composedQueue(rows));
  st.setQueueTabOpen(true);
  if (truncated) {
    st.pushToast(
      `队列上限为 ${QUEUE_LIMIT} 个，因此取前 ${QUEUE_LIMIT} 个已读取`,
      'info',
    );
  }
  // 先頭から再生。找不到動画なら開かず、送りに任せて飛ばさせる
  const first = rows.find((v) => !v.isMissing && !v.isOffline);
  if (first) st.playFromQueue(first);
  else st.pushToast(`${opts.label}的视频一个都没找到`);
}
