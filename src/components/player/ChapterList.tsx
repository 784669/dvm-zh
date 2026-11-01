import { ListOrdered } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { chapterIndexAt, hasChapters } from '../../lib/chapters';
import type { Chapter } from '../../lib/chapters';
import { fmtTime } from '../../lib/format';

/**
 * 章节一覧(v1.29、mpv のみ)。コントロールバーのボタンから打开。
 *
 * **コマ(缩略图)は出さない**。打开たびに章节数だけシークデコードが走り、
 * mpv で本編を再生している最中に同じ文个もう一度読みに行くことになる
 * (シークバーのコマ出しを別設定にしたのと同じ懸念)
 */
export function ChapterList({
  chapters,
  currentTime,
  open,
  onToggle,
  onSeek,
}: {
  chapters: Chapter[];
  currentTime: number;
  open: boolean;
  onToggle: () => void;
  onSeek: (sec: number) => void;
}) {
  // 1 つだけの章节は飛び先が無いので、ボタンごと出さない
  if (!hasChapters(chapters)) return null;

  return (
    <div className="chapter-anchor">
      <button
        className={open ? 'active' : ''}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        title={`章节（${chapters.length}）（Ctrl+← / Ctrl+→ 切换前后）`}
      >
        <ListOrdered />
      </button>
      {open && (
        <ChapterPopover
          chapters={chapters}
          currentTime={currentTime}
          onClose={onToggle}
          onSeek={onSeek}
        />
      )}
    </div>
  );
}

/**
 * 一覧の中身。**Esc は拾わない** —— プレイヤーの `onEscape` 側で
 * 「開いていれば先に一覧を关闭」と分岐している(window のハンドラと取り合うと、
 * 一覧を关闭つもりの Esc でプレイヤーごと关闭)
 */
function ChapterPopover({
  chapters,
  currentTime,
  onClose,
  onSeek,
}: {
  chapters: Chapter[];
  currentTime: number;
  onClose: () => void;
  onSeek: (sec: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const current = chapterIndexAt(chapters, currentTime);

  // 外側の点击で关闭(ColumnPicker と同じ作法)。
  // 開いた直後の点击で閉じないよう、次のフレームから拾う
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // アンカー(ボタンごと)の外だけを見る。ボタン自身の onClick が关闭担当
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  // 長い一覧では、開いた時点で今いる章节が見えている必要がある
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <div className="chapter-popover" ref={ref}>
      {chapters.map((c, i) => (
        <button
          key={c.time}
          ref={i === current ? currentRef : undefined}
          className={`chapter-item ${i === current ? 'current' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onSeek(c.time);
            onClose();
          }}
        >
          <span className="chapter-time">{fmtTime(c.time)}</span>
          <span className="chapter-name">{c.label}</span>
        </button>
      ))}
    </div>
  );
}
