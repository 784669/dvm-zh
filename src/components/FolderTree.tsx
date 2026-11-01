import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { ChevronDown, Folder } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useContextMenu } from '../hooks/useContextMenu';
import { buildFolderTreeMenu } from '../lib/contextMenu';
import { dedupeMessage } from '../lib/dedupeMessage';
import { useShallow } from 'zustand/react/shallow';
import { pickState, useLibrary } from '../store';
import type { FolderNode } from '../types';
import { ContextMenu } from './ContextMenu';
import { DedupeDialog } from './DedupeDialog';
import { ExcludeDialog } from './ExcludeDialog';

/** Windows のパスは大文字小文字を区別しない。ASCII だけ畳む(Rust / SQL 側の lower に合わせる) */
const sameDir = (a: string | null, b: string) =>
  a !== null && a.toLowerCase() === b.toLowerCase();

/** parent からツリーを組む。親が找不到ノードはトップレベル扱いにする */
function buildTree(nodes: FolderNode[]): Map<string | null, FolderNode[]> {
  const known = new Set(nodes.map((n) => n.path));
  const children = new Map<string | null, FolderNode[]>();
  for (const n of nodes) {
    const parent = n.parent !== null && known.has(n.parent) ? n.parent : null;
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  return children;
}

/**
 * 侧边栏「文件夹」タブの文件夹ツリー。
 * 点击すると**その文件夹直下だけ**に絞り込む(エクスプローラーと同じ)。
 * 监视文件夹配下をまとめて見たいときは「媒体库」タブの监视文件夹一覧を使う
 */
export function FolderTree({ nodes }: { nodes: FolderNode[] }) {
  const { dirPath, toggleDirPath } = useLibrary(
    useShallow(pickState('dirPath', 'toggleDirPath')),
  );
  // 既定は全部畳んだ状態(ルートだけ見える)。深い媒体库で侧边栏が伸びきらないように
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  /**
   * 一覧側の文件夹をダブル点击して潜ったときに、ツリーの表示が置いていかれないよう
   * 選択中文件夹の祖先を開いておく(エクスプローラーと同じ挙動)
   */
  useEffect(() => {
    if (dirPath === null) return;
    const byKey = new Map(nodes.map((n) => [n.path.toLowerCase(), n]));
    const ancestors: string[] = [];
    let cur = byKey.get(dirPath.toLowerCase());
    while (cur?.parent) {
      ancestors.push(cur.parent);
      cur = byKey.get(cur.parent.toLowerCase());
    }
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      if (ancestors.every((a) => prev.has(a))) return prev;
      const next = new Set(prev);
      for (const a of ancestors) next.add(a);
      return next;
    });
  }, [dirPath, nodes]);

  const toggleExpand = (path: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const { menu, open: openMenu, close: closeMenu } = useContextMenu<FolderNode>();
  // 右点击から打开確認ダイアログ(重複解消 / 取り込まない場所にする)
  const [dedupeScope, setDedupeScope] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<FolderNode | null>(null);

  /**
   * 右键菜单の実行(v1.20)。
   * 「从监控对象中移除」は載せていない — 监视文件夹行(媒体库タブ)の担当。
   * あちらは登録動画の扱いも尋ねるので、入口は 1 つに寄せる
   */
  const runMenuAction = async (id: string, n: FolderNode) => {
    const { pushToast, bumpVersion } = useLibrary.getState();
    try {
      switch (id) {
        case 'tree:open': toggleDirPath(n.path); break;
        case 'tree:expand': toggleExpand(n.path); break;
        case 'tree:reveal':
          try {
            await revealItemInDir(n.path);
          } catch {
            pushToast('无法在资源管理器中显示');
          }
          break;
        case 'tree:copyPath':
          try {
            await navigator.clipboard.writeText(n.path);
            pushToast('已复制路径', 'info');
          } catch {
            pushToast('无法复制到剪贴板');
          }
          break;
        case 'tree:watch':
          await api.addWatchedFolder(n.path);
          bumpVersion();
          break;
        // 下見を出すだけ。実行するかはダイアログで決める
        case 'tree:dedupe': setDedupeScope(n.path); break;
        case 'tree:exclude': setExcluding(n); break;
        default:
      }
    } catch {
      // トーストは call() の担当
    }
  };

  const renderNodes = (list: FolderNode[], depth: number) =>
    list.map((n) => {
      const children = tree.get(n.path) ?? [];
      const isOpen = expanded.has(n.path);
      return (
        <div key={n.path}>
          <div
            className={`side-item folder ${sameDir(dirPath, n.path) ? 'active' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => toggleDirPath(n.path)}
            onContextMenu={(e) =>
              openMenu(
                e,
                buildFolderTreeMenu(n, children.length > 0, isOpen, sameDir(dirPath, n.path)),
                n,
              )}
            title={`${n.path}\n单击筛选该文件夹直属的 ${n.directCount} 个（再次单击取消）${
              n.totalCount !== n.directCount ? `\n其下全部共 ${n.totalCount} 个` : ''
            }`}
          >
            {children.length > 0 ? (
              <button
                className={`tree-toggle ${isOpen ? 'open' : ''}`}
                title={isOpen ? '隐藏子文件夹' : '显示子文件夹'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(n.path);
                }}
              >
                {/* 開閉でアイコンを変えず CSS で回す(形が変わると大きさが違って見える) */}
                <ChevronDown />
              </button>
            ) : (
              <span className="tree-toggle spacer" />
            )}
            {n.watchedFolderId !== null ? (
              <span className={`dot ${n.online ? 'online' : 'offline'}`} />
            ) : (
              <Folder className="tag-mark" />
            )}
            <span className="folder-name">{n.name}</span>
            {/* 直下に動画が無い中継ぎの文件夹は「0」を出さない(数字だらけになるため) */}
            {n.directCount > 0 && <span className="count">{n.directCount}</span>}
          </div>
          {isOpen && renderNodes(children, depth + 1)}
        </div>
      );
    });

  const roots = tree.get(null) ?? [];
  const watched = roots.filter((n) => n.watchedFolderId !== null);
  const others = roots.filter((n) => n.watchedFolderId === null);

  if (nodes.length === 0) {
    return (
      <div className="side-empty">
        登记监视文件夹或添加视频后，这里会显示文件夹层级
      </div>
    );
  }

  return (
    <>
      {renderNodes(watched, 0)}
      {others.length > 0 && (
        <div className="side-section" title="监视文件夹之外的视频（逐个登记等）">
          其他位置
        </div>
      )}
      {renderNodes(others, 0)}

      {menu && (
        <ContextMenu
          key={`${menu.x},${menu.y}`}
          x={menu.x}
          y={menu.y}
          entries={menu.entries}
          onClose={closeMenu}
          onSelect={(id) => void runMenuAction(id, menu.target)}
        />
      )}

      {dedupeScope !== null && (
        <DedupeDialog
          scope={dedupeScope}
          onClose={() => setDedupeScope(null)}
          onDone={(result, trashed) => {
            const { pushToast, bumpVersion } = useLibrary.getState();
            setDedupeScope(null);
            bumpVersion();
            pushToast(dedupeMessage(result, trashed), result.failed > 0 ? 'error' : 'info');
          }}
        />
      )}

      {excluding !== null && (
        <ExcludeDialog
          path={excluding.path}
          videoCount={excluding.totalCount}
          onClose={() => setExcluding(null)}
          onDone={(removed) => {
            const { pushToast, bumpVersion } = useLibrary.getState();
            setExcluding(null);
            bumpVersion();
            pushToast(
              removed > 0
                ? `已登记为监视排除文件夹（${removed.toLocaleString()} 项已移除。文件仍然保留）`
                : '已登记为监视排除文件夹',
              'info',
            );
          }}
        />
      )}
    </>
  );
}
