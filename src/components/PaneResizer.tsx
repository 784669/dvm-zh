import { useRef } from 'react';

/**
 * ペインの境目に置く、掴んで幅を変える帯。
 *
 * `edge` は**帯から見てどちら側にペインがあるか**。
 * left = 左のペイン(侧边栏)を動かす → 右へ引くと広がる
 * right = 右のペイン(详情面板)を動かす → 左へ引くと広がる
 *
 * ポインタの掴み方はシークバー(player/PlayerControls.tsx)と同じ
 * setPointerCapture 方式。ドラッグ中にカーソルが帯から外れても追従する
 */
export function PaneResizer({
  width, edge, min, max, defaultWidth, onResize, onCommit, label,
}: {
  width: number;
  edge: 'left' | 'right';
  min: number;
  max: number;
  /** ダブル点击で戻す幅 */
  defaultWidth: number;
  onResize: (width: number) => void;
  /** ドラッグを離したときだけ呼ぶ(設定への保存用。動かすたびに書き込まない) */
  onCommit: () => void;
  label: string;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);

  const apply = (clientX: number) => {
    if (!drag.current) return;
    const dx = clientX - drag.current.x;
    const next = drag.current.w + (edge === 'left' ? dx : -dx);
    onResize(Math.min(Math.max(next, min), max));
  };

  return (
    <div
      className="pane-resizer"
      role="separator"
      aria-orientation="vertical"
      title={`${label}的宽度（双击恢复默认）`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => apply(e.clientX)}
      onPointerUp={(e) => {
        if (!drag.current) return;
        apply(e.clientX);
        drag.current = null;
        onCommit();
      }}
      onDoubleClick={() => {
        onResize(defaultWidth);
        onCommit();
      }}
    />
  );
}
