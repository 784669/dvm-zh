import type { QueueState, VideoRow } from '../types';

/**
 * 队列の自動保存(v1.41、C-2)の直列化。**判断はここに置き、
 * useQueueLifecycle は読んで書くだけ**にする(lib/queue.ts と同じ作法)。
 *
 * 保存先は library.db の `session_state`(key = 'queue')。队列は video_id を
 * 含むので媒体库に紐づき、切り替えれば別の队列が復元される。
 */

/**
 * 保存する形。**`currentId` / `orphanIndex` は入れない** ——
 * 「何をどの順で並べたか」は持ち越すが、「どこまで再生したか」は持ち越さない。
 * 再起動をまたいで再生位置が残っていると、次の再生開始が
 * 「並べた列の途中から」になって驚かせるため
 */
export interface QueueSnapshot {
  videoIds: number[];
  sourceId: number | null;
  sourceName: string;
  dirty: boolean;
}

export function serializeQueue(q: QueueState): string {
  const snap: QueueSnapshot = {
    videoIds: q.items.map((v) => v.id),
    sourceId: q.sourceId,
    sourceName: q.sourceName,
    dirty: q.dirty,
  };
  return JSON.stringify(snap);
}

/** 保存値を読む。壊れた JSON·形の違う値は null(= 復元しない)に落とす */
export function parseSnapshot(raw: string | null): QueueSnapshot | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || !Array.isArray((v as QueueSnapshot).videoIds)) {
      return null;
    }
    const o = v as Record<string, unknown>;
    return {
      videoIds: (o.videoIds as unknown[]).filter((n): n is number => typeof n === 'number'),
      sourceId: typeof o.sourceId === 'number' ? o.sourceId : null,
      sourceName: typeof o.sourceName === 'string' ? o.sourceName : '',
      dirty: o.dirty === true,
    };
  } catch {
    return null;
  }
}

/**
 * 復元直後の队列。`rows` は保存した id 順に引き直した行(消えた動画は落ちている)。
 * `dirty` は保存時の値を引き継ぐ —— 出所のリストから変えたまま終了していたなら、
 * 復元後も「有变更」の ● と「覆盖保存」が生きているべき
 */
export function restoredQueue(snap: QueueSnapshot, rows: VideoRow[]): QueueState {
  return {
    items: rows,
    currentId: null,
    orphanIndex: null,
    sourceId: snap.sourceId,
    sourceName: snap.sourceName,
    dirty: snap.dirty,
  };
}
