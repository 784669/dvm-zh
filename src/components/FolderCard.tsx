import { Folder, FolderUp } from 'lucide-react';
import { layout } from '../lib/listColumns';
import type { ColumnKey } from '../lib/listColumns';
import type { FolderNode } from '../types';

/**
 * メインビューの先頭に並べる文件夹 1 件。
 * 「上层文件夹」(up)と実在のサブ文件夹を同じ形で扱う
 */
export interface FolderEntry {
  /** 開いたときに設定する dirPath */
  path: string;
  name: string;
  up: boolean;
  /** 上层文件夹には件数を出さない */
  node: FolderNode | null;
}

export function toEntry(node: FolderNode): FolderEntry {
  return { path: node.path, name: node.name, up: false, node };
}

export function upEntry(parent: string): FolderEntry {
  return { path: parent, name: '上层文件夹', up: true, node: null };
}

function tooltip(entry: FolderEntry): string {
  if (entry.up) return `${entry.path}\n双击进入上层文件夹`;
  const n = entry.node!;
  return `${n.path}\n双击打开（直属 ${n.directCount} 个${
    n.totalCount !== n.directCount ? ` / 其下全部 ${n.totalCount} 个` : ''
  }）`;
}

/** 件数の表示。直下が 0 でも配下にあるなら「配下 N 件」を出す */
function subLabel(entry: FolderEntry): string {
  if (entry.up) return '';
  const n = entry.node!;
  if (n.directCount === 0) return `配下 ${n.totalCount} 件`;
  return n.totalCount !== n.directCount
    ? `${n.directCount} 件(配下 ${n.totalCount} 件)`
    : `${n.directCount} 件`;
}

/** 文件夹のカード / 行で共通の props */
interface FolderRowProps {
  entry: FolderEntry;
  onOpen: (path: string) => void;
  onContextMenu: (entry: FolderEntry, e: React.MouseEvent) => void;
}

/** グリッド表示の文件夹カード。動画カードと同じ高さに収まる */
export function FolderCard({ entry, onOpen, onContextMenu }: FolderRowProps) {
  return (
    <div
      className={`card folder-card ${entry.up ? 'up' : ''}`}
      title={tooltip(entry)}
      onDoubleClick={() => onOpen(entry.path)}
      onContextMenu={(e) => onContextMenu(entry, e)}
    >
      <div className="folder-thumb">
        {/* カードの缩略图枠に合わせて大きく出すので、ここだけ size を明示する */}
        <span className="folder-glyph">
          {entry.up ? <FolderUp size={34} /> : <Folder size={34} />}
        </span>
      </div>
      <div className="card-name">{entry.name}</div>
      <div className="card-sub">{subLabel(entry)}</div>
    </div>
  );
}

/**
 * 详细列表视图の文件夹行。動画行と同じ grid に乗せ、値の無いセルは空欄にする。
 * 件数は列ではなく名前セルの中に入れる — どの列構成でも必ず見えるようにするため
 */
export function FolderListRow({
  entry, onOpen, onContextMenu, height, columns,
}: FolderRowProps & { height: number; columns: ColumnKey[] }) {
  const { thumb, rest } = layout(columns);
  return (
    <div
      className={`list-row folder-row ${entry.up ? 'up' : ''}`}
      style={{ height }}
      title={tooltip(entry)}
      onDoubleClick={() => onOpen(entry.path)}
      onContextMenu={(e) => onContextMenu(entry, e)}
    >
      {thumb && (
        <div className="list-thumb folder-thumb">
          <span className="folder-glyph">
            {entry.up ? <FolderUp size={18} /> : <Folder size={18} />}
          </span>
        </div>
      )}
      <div className="list-name">
        <span className="list-title">{entry.name}</span>
        <span className="folder-count">{subLabel(entry)}</span>
      </div>
      {rest.map((key) => (
        <div key={key} className="list-col" />
      ))}
    </div>
  );
}
