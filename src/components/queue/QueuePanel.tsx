import { convertFileSrc } from '@tauri-apps/api/core';
import { GripVertical, ListVideo, Save, SaveAll, TriangleAlert, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../api';
import { fmtTime } from '../../lib/format';
import { thumbSrc } from '../../lib/thumbs';
import {
  clearQueue, moveInQueue, QUEUE_LIMIT, queueIndex, removeFromQueue, savedQueue,
} from '../../lib/queue';
import { useLibrary } from '../../store';
import type { VideoRow } from '../../types';

/**
 * ドラッグとみなすまでの移動量(px)。これ未満は点击(= その位置から再生)。
 * **HTML5 の D&D は使えない**ので TagTree と同じくポインタイベントで自前実装する
 * (理由は DESIGN.md「标签の群组移動は D&D」節)
 */
const DRAG_THRESHOLD = 4;

/**
 * 再生队列のパネル(v1.40)。
 *
 * **同じコンポーネントを 2 か所にマウントする** —— 右ペインの队列タブと、
 * プレイヤーのコントロールバーから打开ポップオーバー。再生中は
 * `html.mpv-active .app { display: none }` で `.app` ごと消えるので、
 * 再生中も編集するには `.mpv-overlay` の内側にもいる必要がある
 * (字幕スタイルパネルと同じ制約)。
 *
 * **仮想化しない。** 上限 500 件(lib/queue.ts)がその根拠 —— 自前 D&D と仮想化を
 * 組み合わせると「掴んだ行がスクロールで DOM から消える」問題を自分で作り込むことになる。
 */
export function QueuePanel({ compact = false }: { compact?: boolean }) {
  const queue = useLibrary((s) => s.queue);
  const setQueue = useLibrary((s) => s.setQueue);
  const playFromQueue = useLibrary((s) => s.playFromQueue);
  const pushToast = useLibrary((s) => s.pushToast);
  const bumpVersion = useLibrary((s) => s.bumpVersion);
  // 作り直した缩略图を読み直させるカウンタ(v1.22)。グリッドと同じものを見る
  const thumbVersion = useLibrary((s) => s.thumbVersion);

  /** 掴んだ瞬間の位置。ここから DRAG_THRESHOLD 動いて初めてドラッグになる */
  const dragStart = useRef<{ index: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ index: number; insertAt: number } | null>(null);
  // ドラッグで終わった pointerup の直後に click が来るので、再生を 1 回だけ抑える
  const suppressClick = useRef(false);

  const current = queueIndex(queue);

  const onPointerDown = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    dragStart.current = { index, x: e.clientX, y: e.clientY };
    // capture しておくと、行の外にカーソルが出ても move/up を取りこぼさない
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
    // capture 中は pointerenter が飛ばないので、座標からドロップ先を引く
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-queue-index]');
    let insertAt = dragging?.insertAt ?? start.index;
    if (el instanceof HTMLElement) {
      const idx = Number(el.dataset.queueIndex);
      const r = el.getBoundingClientRect();
      // 行の上半分なら手前、下半分なら次の位置に入る
      insertAt = e.clientY < r.top + r.height / 2 ? idx : idx + 1;
    }
    setDragging({ index: start.index, insertAt });
  };

  const onPointerUp = () => {
    const start = dragStart.current;
    const drop = dragging;
    dragStart.current = null;
    setDragging(null);
    if (!start || !drop) return; // 動かしていない = ただの点击
    suppressClick.current = true;
    // click が来なかったときに标志が残って次の点击を食べないよう、必ず戻す
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    // 自分を配列から抜くぶん、後ろへ動かすときは挿入位置が 1 つ手前にずれる
    const to = drop.insertAt > start.index ? drop.insertAt - 1 : drop.insertAt;
    setQueue(moveInQueue(queue, start.index, to));
  };

  /**
   * ドラッグ中の右点击·フォーカス喪失で掴んだ状態が宙に浮かないようにする。
   *
   * **`pointerleave` では呼ばないこと** —— `setPointerCapture` しているので
   * リストの外へ出ても `pointerup` は必ず届く。leave で落とすと、
   * 少しはみ出しただけ排序方式が無かったことになる
   */
  const cancelDrag = () => {
    dragStart.current = null;
    setDragging(null);
  };

  const play = (v: VideoRow) => {
    if (suppressClick.current) return;
    if (v.isMissing || v.isOffline) {
      pushToast(`${v.filename} 未找到`, 'info');
      return;
    }
    playFromQueue(v);
  };

  /**
   * 命名并保存。同名があれば**上書きするかを尋ねる**(弾かない) ——
   * 同じ名前を打つ人の意図はほぼ「そのリストを更新したい」なので、
   * 名前を考え直させるより上書きを確認するほうが早い
   */
  const saveAs = async () => {
    const name = window.prompt('播放列表名称', queue.sourceName || '')?.trim();
    if (!name) return;
    const ids = queue.items.map((v) => v.id);
    try {
      const existing = await api.findPlaylistByName(name);
      if (existing !== null) {
        const ok = window.confirm(`「${name}」已存在。要覆盖吗？`);
        if (!ok) return;
        await api.replacePlaylist(existing, ids);
        setQueue(savedQueue(queue, existing, name));
      } else {
        const id = await api.createPlaylist(name, ids);
        setQueue(savedQueue(queue, id, name));
      }
      pushToast(`「${name}」已保存`, 'info');
      bumpVersion();
    } catch {
      // トーストは call() の担当
    }
  };

  /** 出所のリストへ書き戻す。「有变更」のときだけ押せる */
  const overwrite = async () => {
    if (queue.sourceId === null) return;
    try {
      await api.replacePlaylist(queue.sourceId, queue.items.map((v) => v.id));
      setQueue(savedQueue(queue, queue.sourceId, queue.sourceName));
      pushToast(`「${queue.sourceName}」已覆盖`, 'info');
      bumpVersion();
    } catch {
      // トーストは call() の担当
    }
  };

  const empty = queue.items.length === 0;

  return (
    // data-queue-dropzone: グリッドのカードをここへドラッグすると末尾に追加される
    // (v1.41、C-5。掴む側·落とす判定は VideoGrid が持つ)
    <div className={`queue-panel ${compact ? 'compact' : ''}`} data-queue-dropzone>
      <div className="queue-head">
        <span className="queue-title">
          <ListVideo />
          {queue.sourceId !== null ? queue.sourceName : '队列'}
          {/* 「有变更」はバナーやトーストではなく点 1 つで出す */}
          {queue.dirty && queue.sourceId !== null && <span className="queue-dot" title="有变更">●</span>}
        </span>
        <span className="queue-count">{queue.items.length} / {QUEUE_LIMIT}</span>
      </div>

      <div className="queue-actions">
        <button onClick={saveAs} disabled={empty} title={empty ? '队列为空' : undefined}>
          <Save /> 命名并保存
        </button>
        <button
          onClick={overwrite}
          disabled={queue.sourceId === null || !queue.dirty}
          title={
            queue.sourceId === null
              ? '不是从保存列表读取的队列'
              : !queue.dirty
                ? '与保存的内容相比没有变化'
                : undefined
          }
        >
          <SaveAll /> 覆盖保存
        </button>
        <button
          onClick={() => setQueue(clearQueue(queue))}
          disabled={empty}
          title={empty ? '队列为空' : '正在播放的视频会继续播放'}
        >
          <Trash2 /> 全部移除
        </button>
      </div>

      {empty ? (
        <div className="queue-empty">
          在列表中选中视频后右键 →「队列」添加，或<kbd>Q</kbd> 键。
        </div>
      ) : (
        <div className="queue-list">
          {queue.items.map((v, i) => (
            <div
              key={v.id}
              data-queue-index={i}
              className={[
                'queue-item',
                i === current ? 'current' : '',
                dragging?.index === i ? 'dragging' : '',
                v.isMissing || v.isOffline ? 'unavailable' : '',
                // 挿入位置の線。動かない位置(自分のすぐ前後)には出さない
                dragging && dragging.insertAt === i && dragging.index !== i && dragging.index !== i - 1
                  ? 'drop-before'
                  : '',
                // 末尾へのドロップ(insertAt === 件数)は下に行が無いので、最終行の下辺に出す
                dragging &&
                i === queue.items.length - 1 &&
                dragging.insertAt === queue.items.length &&
                dragging.index !== i
                  ? 'drop-after'
                  : '',
              ].join(' ')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={cancelDrag}
              onContextMenu={cancelDrag}
            >
              <span
                className="queue-grip"
                title="拖动排序"
                onPointerDown={(e) => onPointerDown(e, i)}
              >
                <GripVertical />
              </span>
              <button className="queue-name" onClick={() => play(v)} title={v.path}>
                <span className="queue-no">{i + 1}</span>
                {/*
                  缩略图(v1.40)。**ディスクキャッシュの jpg を読むだけ**なので
                  原則 2 の内側(ChapterList の「コマは出さない」は、あちらが再生中の
                  文个シークデコードする話なので当てはまらない)。

                  `loading="lazy"` が要点 —— このパネルは仮想化していないので、
                  500 件ぶんの img を一度に読ませないためにこれで間引く。
                  読めなかったものは onError で隠して地色を見せる(カードと同じ作法)
                */}
                <span className="queue-thumb">
                  {v.thumbState === 2 && <TriangleAlert size={11} />}
                  {v.thumbPath && (
                    <img
                      key={v.id}
                      src={thumbSrc(convertFileSrc(v.thumbPath), thumbVersion)}
                      loading="lazy"
                      alt=""
                      draggable={false}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                      // 再生成に成功して読めるようになったら戻す(onError で隠しっぱなしにしない)
                      onLoad={(e) => {
                        e.currentTarget.style.display = '';
                      }}
                    />
                  )}
                </span>
                <span className="queue-file">{v.title || v.filename}</span>
              </button>
              <span className="queue-dur">{v.durationMs ? fmtTime(v.durationMs / 1000) : ''}</span>
              <button
                className="queue-remove"
                title="从队列移除"
                onClick={() => setQueue(removeFromQueue(queue, v.id))}
              >
                <X />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
