import { ask } from '@tauri-apps/plugin-dialog';
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useContextMenu } from '../hooks/useContextMenu';
import { buildTagGroupMenu, buildTagMenu } from '../lib/contextMenu';
import { TAG_PALETTE } from '../lib/tagColors';
import { useShallow } from 'zustand/react/shallow';
import { pickState, useLibrary } from '../store';
import type { Tag, TagGroup } from '../types';
import { ContextMenu } from './ContextMenu';

/** 折りたたんだ群组の id。未分類は id を持たないので 0 で表す(群组 id は 1 以上) */
const UNGROUPED = 0;

/**
 * 折りたたみ状態の保存キー。**媒体库ごとに分ける**(v1.27) ——
 * 中身は `tag_groups.id` の配列で、id は媒体库ごとに別物なので、
 * 共有すると「ジャンル(id=3)」を畳んだ状態が別の媒体库の
 * 「出演者(id=3)」に効いて、身に覚えのない群组が畳まれる
 */
const collapsedKey = (libraryId: string) => `dvm.collapsedTagGroups.${libraryId}`;

/**
 * ドラッグとみなすまでの移動量(px)。これ未満は点击(筛选のトグル)として扱う。
 *
 * **HTML5 の D&D は使えない**。Tauri のドラッグ&ドロップハンドラを無効にしないと
 * Windows では draggable / onDrop が動かず、無効にすると App.tsx の onDragDropEvent
 * (文件夹を落として监视文件夹登録)が壊れる。なのでポインタイベントで自前実装する
 */
const DRAG_THRESHOLD = 4;

function loadCollapsed(libraryId: string): Set<number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(collapsedKey(libraryId)) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((v): v is number => typeof v === 'number') : []);
  } catch {
    return new Set();
  }
}

/**
 * 删除标签。**確認からここに閉じ込める**(v1.20)。
 * `⋯` の編集パネルと右键菜单の両方から呼ぶので、
 * 文言をコピペすると片方だけ直して挙動がずれる。消えたら true
 */
async function confirmDeleteTag(tag: Tag): Promise<boolean> {
  const yes = await ask(
    `要删除标签「${tag.name}」吗？\n（将从 ${tag.videoCount} 个视频中移除。视频本身不会被删除）`,
    { title: '删除标签' },
  );
  if (!yes) return false;
  const { tagIds, toggleTagFilter, bumpVersion } = useLibrary.getState();
  await api.deleteTag(tag.id);
  // 消した标签で絞り込んだままだと 0 个なって戻れなくなる
  if (tagIds.includes(tag.id)) toggleTagFilter(tag.id);
  bumpVersion();
  return true;
}

/** 删除分组。中の标签は消えず未分類に落ちる。呼び出し口は上と同じ理由で 1 つ */
async function confirmDeleteGroup(group: TagGroup): Promise<boolean> {
  const yes = await ask(
    `要删除分组「${group.name}」吗？\n（${group.tagCount} 个标签将移到未分类。已添加到视频上的标签保持不变）`,
    { title: '删除分组' },
  );
  if (!yes) return false;
  await api.deleteTagGroup(group.id);
  useLibrary.getState().bumpVersion();
  return true;
}

function TagEditor({ tag, groups, onDone }: { tag: Tag; groups: TagGroup[]; onDone: () => void }) {
  const bumpVersion = useLibrary((s) => s.bumpVersion);
  const [name, setName] = useState(tag.name);

  const apply = async (fn: () => Promise<void>) => {
    try {
      await fn();
      bumpVersion();
    } catch {
      // call() が既にトーストを出しているので、ここでは開いたままにするだけ
    }
  };

  return (
    <div className="tag-editor" onClick={(e) => e.stopPropagation()}>
      <div className="tag-editor-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && name !== tag.name) {
              apply(() => api.renameTag(tag.id, name.trim()));
            }
          }}
          placeholder="标签名"
        />
        <button
          disabled={!name.trim() || name === tag.name}
          onClick={() => apply(() => api.renameTag(tag.id, name.trim()))}
        >
          重命名
        </button>
      </div>

      <div className="tag-editor-row">
        <span className="tag-editor-label">色</span>
        {TAG_PALETTE.map((c) => (
          <button
            key={c.value}
            className={`tag-swatch ${tag.color === c.value ? 'on' : ''}`}
            style={{ background: c.value }}
            title={c.label}
            onClick={() => apply(() => api.setTagColor(tag.id, c.value))}
          />
        ))}
        <button
          className="tag-swatch none"
          title="无颜色"
          onClick={() => apply(() => api.setTagColor(tag.id, null))}
        >
          ×
        </button>
      </div>

      <div className="tag-editor-row">
        <span className="tag-editor-label">群组</span>
        <select
          value={tag.groupId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            apply(() => api.setTagGroup(tag.id, v === '' ? null : Number(v)));
          }}
        >
          <option value="">(未分類)</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      <div className="tag-editor-row">
        <button
          className="danger"
          onClick={async () => {
            if (await confirmDeleteTag(tag)) onDone();
          }}
        >
          删除标签
        </button>
        <button onClick={onDone}>关闭</button>
      </div>
      {tag.videoCount === 0 && (
        <div className="tag-editor-note">还没有带有此标签的视频</div>
      )}
    </div>
  );
}

function GroupEditor({
  group, index, total, onMove, onDone,
}: {
  group: TagGroup;
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onDone: () => void;
}) {
  const bumpVersion = useLibrary((s) => s.bumpVersion);
  const [name, setName] = useState(group.name);

  const apply = async (fn: () => Promise<void>) => {
    try {
      await fn();
      bumpVersion();
    } catch {
      // トーストは call() の担当
    }
  };

  return (
    <div className="tag-editor" onClick={(e) => e.stopPropagation()}>
      <div className="tag-editor-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && name !== group.name) {
              apply(() => api.renameTagGroup(group.id, name.trim()));
            }
          }}
          placeholder="分组名称"
        />
        <button
          disabled={!name.trim() || name === group.name}
          onClick={() => apply(() => api.renameTagGroup(group.id, name.trim()))}
        >
          重命名
        </button>
      </div>

      <div className="tag-editor-row">
        <span className="tag-editor-label">排序</span>
        <button disabled={index === 0} onClick={() => onMove(-1)}>↑ 上移</button>
        <button disabled={index === total - 1} onClick={() => onMove(1)}>↓ 下移</button>
      </div>

      <div className="tag-editor-row">
        <button
          className="danger"
          onClick={async () => {
            if (await confirmDeleteGroup(group)) onDone();
          }}
        >
          删除群组
        </button>
        <button onClick={onDone}>关闭</button>
      </div>
    </div>
  );
}

/**
 * 侧边栏の标签一覧。tag_groups > tags の 2 階層で出す(v1.19)。
 *
 * 群组見出しを点击すると配下标签をまとめて筛选に入れる。
 * 同じ群组の标签同士は Rust 側(core/query.rs)で OR になるので、
 * 「この群组の标签が何か付いている動画」が出る
 */
export function TagTree({
  tags, groups, filtering,
}: {
  tags: Tag[];
  groups: TagGroup[];
  /** 侧边栏の筛选が効いているか。効いている間は畳まず、空の群组も出さない */
  filtering: boolean;
}) {
  const { tagIds, toggleTagFilter, setTagFilter, bumpVersion, libraryId } = useLibrary(
    useShallow(pickState('tagIds', 'toggleTagFilter', 'setTagFilter', 'bumpVersion', 'libraryId')),
  );
  // 媒体库 id が分かってから読む(App.tsx が起動直後に 1 回だけ入れる)。
  // それまでは畳まれていない状態 = 全部見えている側に倒す
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (libraryId) setCollapsed(loadCollapsed(libraryId));
  }, [libraryId]);
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const [editingGroup, setEditingGroup] = useState<number | null>(null);
  // 作成フォームの表示先。tag は「どの群组に作るか」を持つ(null = 未分類)
  const [creating, setCreating] =
    useState<{ kind: 'group' } | { kind: 'tag'; groupId: number | null } | null>(null);
  const [newName, setNewName] = useState('');

  /**
   * D&D の状態。**掴むものによってドロップ先の意味が違う**ので判別可能ユニオンにしてある:
   * 标签は群组の上に落として所属を変え、群组は他の群组の前後に落として排列る
   */
  const dragStart = useRef<{ kind: 'tag' | 'group'; id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<
    | { kind: 'tag'; id: number; x: number; y: number; overGroup: number | null }
    | { kind: 'group'; id: number; x: number; y: number; insertAt: number | null }
    | null
  >(null);
  // ドラッグで終わった pointerup の直後に click が来るので、筛选のトグルを 1 回だけ抑える
  const suppressClick = useRef(false);

  /** 右键菜单(v1.20)。対象は标签 1 個か群组見出し(未分類は group=null) */
  const { menu, open: openMenu, close: closeMenu } = useContextMenu<
    { kind: 'tag'; tag: Tag } | { kind: 'group'; group: TagGroup | null; index: number }
  >();

  /**
   * ドラッグ中の右点击はドラッグを中止してメニューを出さない(エクスプローラーと同じ)。
   * `onDragPointerDown` が `e.button !== 0` で弾くのでドラッグ自体は始まらないが、
   * **左ボタンで掴んだままの右点击**では pointerup が来ず、掴んだ状態が宙に浮く
   */
  const cancelDragForMenu = () => {
    if (!dragStart.current && !dragging) return false;
    dragStart.current = null;
    setDragging(null);
    return true;
  };

  const onDragPointerDown = (e: React.PointerEvent, kind: 'tag' | 'group', id: number) => {
    if (e.button !== 0) return;
    dragStart.current = { kind, id, x: e.clientX, y: e.clientY };
    // capture しておくと、行の外にカーソルが出ても move/up を取りこぼさない
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
    // capture 中は pointerenter が飛ばないので、座標からドロップ先を引く
    const at = document.elementFromPoint(e.clientX, e.clientY);
    if (start.kind === 'tag') {
      const el = at?.closest('[data-drop-group]');
      const over = el instanceof HTMLElement ? Number(el.dataset.dropGroup) : null;
      setDragging({ kind: 'tag', id: start.id, x: e.clientX, y: e.clientY, overGroup: over });
    } else {
      // 群组は「どの群组の前に入るか」。見出しの上半分なら手前、下半分なら次の位置
      const el = at?.closest('[data-group-index]');
      let insertAt: number | null = null;
      if (el instanceof HTMLElement) {
        const idx = Number(el.dataset.groupIndex);
        const r = el.getBoundingClientRect();
        insertAt = e.clientY < r.top + r.height / 2 ? idx : idx + 1;
      }
      setDragging({ kind: 'group', id: start.id, x: e.clientX, y: e.clientY, insertAt });
    }
  };

  const onDragPointerUp = async () => {
    const start = dragStart.current;
    const drop = dragging;
    dragStart.current = null;
    setDragging(null);
    if (!start || !drop) return; // 動かしていない = ただの点击
    suppressClick.current = true;
    // click が来なかったとき(ドロップ先がボタンの上だった等)に标志が残って
    // 次の点击を食べてしまわないよう、同じイベントループの最後で必ず戻す
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    try {
      if (drop.kind === 'tag') {
        const tag = tags.find((t) => t.id === drop.id);
        // ドロップ先が無い(侧边栏の外)か、元と同じ群组なら何もしない
        if (drop.overGroup === null || !tag) return;
        if ((tag.groupId ?? UNGROUPED) === drop.overGroup) return;
        await api.setTagGroup(tag.id, drop.overGroup === UNGROUPED ? null : drop.overGroup);
      } else {
        const from = groups.findIndex((g) => g.id === drop.id);
        if (drop.insertAt === null || from < 0) return;
        // 自分を配列から抜くぶん、後ろへ動かすときは挿入位置が 1 つ手前にずれる
        const to = drop.insertAt > from ? drop.insertAt - 1 : drop.insertAt;
        if (to === from) return;
        const next = [...groups];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        await api.reorderTagGroups(next.map((g) => g.id));
      }
      bumpVersion();
    } catch {
      // トーストは call() の担当
    }
  };

  const toggleCollapse = (id: number) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // id が分かる前に書くと、どの媒体库のものか分からない行が残る
      if (libraryId) localStorage.setItem(collapsedKey(libraryId), JSON.stringify([...next]));
      return next;
    });

  // 群组ごとに仕分ける。消えた群组を指す标签は未分類に落とす(参照切れ対策)
  const known = new Set(groups.map((g) => g.id));
  const byGroup = new Map<number, Tag[]>();
  for (const t of tags) {
    const key = t.groupId != null && known.has(t.groupId) ? t.groupId : UNGROUPED;
    const list = byGroup.get(key) ?? [];
    list.push(t);
    byGroup.set(key, list);
  }
  const ungrouped = byGroup.get(UNGROUPED) ?? [];

  const startCreate = (target: { kind: 'group' } | { kind: 'tag'; groupId: number | null }) => {
    setNewName('');
    setCreating(target);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name || !creating) return;
    try {
      if (creating.kind === 'group') await api.createTagGroup(name);
      else await api.createTag(name, creating.groupId);
      setNewName('');
      setCreating(null);
      bumpVersion();
    } catch {
      // 名前が重複したときなど。トーストが出るので入力は残したままにする
    }
  };

  const moveGroup = async (index: number, dir: -1 | 1) => {
    const next = [...groups];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    try {
      await api.reorderTagGroups(next.map((g) => g.id));
      bumpVersion();
    } catch {
      // トーストは call() の担当
    }
  };

  /** 群组見出しの点击と同じ筛选。配下标签をまとめて入れ替える */
  const toggleGroupFilter = (ids: number[]) => {
    if (ids.length === 0) return;
    const allOn = ids.every((id) => tagIds.includes(id));
    setTagFilter(
      allOn ? tagIds.filter((id) => !ids.includes(id)) : [...new Set([...tagIds, ...ids])],
    );
  };

  /** 右键菜单の実行(v1.20)。削除は `⋯` の編集パネルと同じ関数を通す */
  const runMenuAction = async (
    id: string,
    target: { kind: 'tag'; tag: Tag } | { kind: 'group'; group: TagGroup | null; index: number },
  ) => {
    try {
      if (target.kind === 'tag') {
        const tag = target.tag;
        if (id.startsWith('tag:color:')) {
          const v = id.slice('tag:color:'.length);
          await api.setTagColor(tag.id, v === 'none' ? null : v);
          bumpVersion();
          return;
        }
        if (id.startsWith('tag:group:')) {
          const v = id.slice('tag:group:'.length);
          await api.setTagGroup(tag.id, v === 'none' ? null : Number(v));
          bumpVersion();
          return;
        }
        switch (id) {
          case 'tag:filter': toggleTagFilter(tag.id); break;
          case 'tag:filterOnly': setTagFilter([tag.id]); break;
          case 'tag:rename': {
            const name = window.prompt('新标签名称', tag.name);
            if (name === null || name.trim() === '' || name.trim() === tag.name) return;
            await api.renameTag(tag.id, name.trim());
            bumpVersion();
            break;
          }
          case 'tag:delete': await confirmDeleteTag(tag); break;
          default:
        }
        return;
      }

      const { group, index } = target;
      const key = group?.id ?? UNGROUPED;
      switch (id) {
        case 'group:filter':
          toggleGroupFilter((byGroup.get(key) ?? []).map((t) => t.id));
          break;
        case 'group:toggle': toggleCollapse(key); break;
        case 'group:newTag': startCreate({ kind: 'tag', groupId: group?.id ?? null }); break;
        case 'group:newGroup': startCreate({ kind: 'group' }); break;
        case 'group:rename': {
          if (!group) return;
          const name = window.prompt('新分组名称', group.name);
          if (name === null || name.trim() === '' || name.trim() === group.name) return;
          await api.renameTagGroup(group.id, name.trim());
          bumpVersion();
          break;
        }
        case 'group:moveUp': await moveGroup(index, -1); break;
        case 'group:moveDown': await moveGroup(index, 1); break;
        case 'group:delete': if (group) await confirmDeleteGroup(group); break;
        default:
      }
    } catch {
      // トーストは call() の担当
    }
  };

  const createForm = (placeholder: string) => (
    <div className="tag-create" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={newName}
        placeholder={placeholder}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitCreate();
          if (e.key === 'Escape') setCreating(null);
        }}
      />
      <button disabled={!newName.trim()} onClick={submitCreate}>作成</button>
      <button onClick={() => setCreating(null)}>取消</button>
    </div>
  );

  const renderTag = (t: Tag) => (
    <div key={t.id}>
      <div
        className={`side-item folder tag-row ${tagIds.includes(t.id) ? 'active' : ''} ${
          dragging?.kind === 'tag' && dragging.id === t.id ? 'dragging' : ''
        }`}
        data-drop-group={t.groupId ?? UNGROUPED}
        onPointerDown={(e) => onDragPointerDown(e, 'tag', t.id)}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        // ウィンドウがフォーカスを失うなどしたらゴーストを消す
        onPointerCancel={() => {
          dragStart.current = null;
          setDragging(null);
        }}
        onClick={() => {
          // ドラッグで終わったときは筛选を切り替えない
          if (suppressClick.current) return;
          toggleTagFilter(t.id);
        }}
        onContextMenu={(e) => {
          if (cancelDragForMenu()) return;
          openMenu(e, buildTagMenu(t, groups, tagIds), { kind: 'tag', tag: t });
        }}
        title={`${t.name}（点击筛选。拖到分组标题上即可移动）`}
      >
        {/* 标签色の丸。监视文件夹の接続状態(.dot)と同じ CSS の円にしている */}
        <span className="tag-dot" style={t.color ? { background: t.color } : undefined} />
        <span className="folder-name">{t.name}</span>
        <span className="count">{t.videoCount}</span>
        <button
          className="remove"
          title="编辑标签（名称·颜色·分组·删除）"
          // ここを掴んでもドラッグを始めない(ボタンとして押せなくなるため)
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setEditingTag(editingTag === t.id ? null : t.id);
          }}
        >
          ⋯
        </button>
      </div>
      {editingTag === t.id && (
        <TagEditor tag={t} groups={groups} onDone={() => setEditingTag(null)} />
      )}
    </div>
  );

  /** 群组 / 未分類の見出し行。未分類は id を持たないので group = null で呼ぶ */
  const renderHeader = (group: TagGroup | null, index: number) => {
    const key = group?.id ?? UNGROUPED;
    const groupTags = byGroup.get(key) ?? [];
    const ids = groupTags.map((t) => t.id);
    // 配下标签が全部選ばれていれば「群组ごと選択中」とみなす
    // 筛选で空になった群组は見出しごと消す。
    // ただしドラッグ中は「移動先」として要るので残す
    if (filtering && groupTags.length === 0 && !dragging) return null;
    const allOn = ids.length > 0 && ids.every((id) => tagIds.includes(id));
    // 絞った結果が畳まれていては意味がないので、筛选中は必ず打开
    const isCollapsed = !filtering && collapsed.has(key);
    // ドラッグ中の标签を受け入れられるか(元と同じ群组には落とせない)
    const tagDrag = dragging?.kind === 'tag' ? dragging : null;
    const draggingTag = tagDrag ? tags.find((t) => t.id === tagDrag.id) : undefined;
    const isDropTarget =
      tagDrag != null &&
      tagDrag.overGroup === key &&
      draggingTag != null &&
      (draggingTag.groupId ?? UNGROUPED) !== key;

    // 群组の排列中の挿入位置。動かない位置(自分のすぐ前後)には線を出さない
    const groupDrag = dragging?.kind === 'group' ? dragging : null;
    const from = groupDrag ? groups.findIndex((g) => g.id === groupDrag.id) : -1;
    const insertAt =
      groupDrag && groupDrag.insertAt !== from && groupDrag.insertAt !== from + 1
        ? groupDrag.insertAt
        : null;
    const cls = [
      'tag-group-block',
      isDropTarget ? 'drop-target' : '',
      group != null && insertAt === index ? 'insert-before' : '',
      group != null && index === groups.length - 1 && insertAt === groups.length ? 'insert-after' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div
        key={`g${key}`}
        className={cls}
        // 未分類は排列の対象外(常に最後)なので index を持たせない。
        // 見出しではなく**ブロック全体**に付けるのは、展開したまま排列るときに
        // 配下标签の上を通っても挿入位置の線が消えないようにするため
        {...(group ? { 'data-group-index': index } : {})}
      >
        <div
          className={`side-item folder tag-group ${allOn ? 'active' : ''} ${
            groupDrag?.id === group?.id && group != null ? 'dragging' : ''
          }`}
          data-drop-group={key}
          onPointerDown={group ? (e) => onDragPointerDown(e, 'group', group.id) : undefined}
          onPointerMove={group ? onDragPointerMove : undefined}
          onPointerUp={group ? onDragPointerUp : undefined}
          onPointerCancel={() => {
            dragStart.current = null;
            setDragging(null);
          }}
          onClick={() => {
            // 排列のドラッグで終わったときは筛选を切り替えない
            if (suppressClick.current) return;
            toggleGroupFilter(ids);
          }}
          onContextMenu={(e) => {
            if (cancelDragForMenu()) return;
            openMenu(
              e,
              buildTagGroupMenu(group, index, groups.length, ids.length, allOn, isCollapsed),
              { kind: 'group', group, index },
            );
          }}
          title={[
            group?.name ?? '未分類',
            ids.length === 0
              ? '（还没有标签'
              : '（点击可汇总显示带有其中标签的视频',
            group ? '。上下拖动可排序）' : ')',
          ].join('')}
        >
          <button
            className={`tree-toggle ${isCollapsed ? '' : 'open'}`}
            title={isCollapsed ? '显示标签' : '隐藏标签'}
            // ここを掴んでも排列を始めない(ボタンとして押せなくなるため)
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(key);
            }}
          >
            {/* 開閉でアイコンを変えず CSS で回す(形が変わると大きさが違って見える) */}
            <ChevronDown />
          </button>
          <span className="folder-name">{group?.name ?? '未分類'}</span>
          <span className="count">{groupTags.length}</span>
          <button
            className="remove"
            title={group ? `「${group.name}」添加标签` : '添加不属于任何分组的标签'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              startCreate({ kind: 'tag', groupId: group?.id ?? null });
            }}
          >
            <Plus size={13} />
          </button>
          {group && (
            <button
              className="remove"
              title="编辑分组（名称·排序·删除）"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setEditingGroup(editingGroup === group.id ? null : group.id);
              }}
            >
              ⋯
            </button>
          )}
        </div>
        {group && editingGroup === group.id && (
          <GroupEditor
            group={group}
            index={index}
            total={groups.length}
            onMove={(dir) => moveGroup(index, dir)}
            onDone={() => setEditingGroup(null)}
          />
        )}
        {creating?.kind === 'tag' && creating.groupId === (group?.id ?? null) &&
          createForm('输入标签名后按 Enter')}
        {!isCollapsed && groupTags.map(renderTag)}
      </div>
    );
  };

  return (
    <>
      {/* 筛选中は作成ボタンを出さない — 探している最中に出ていても邪魔なだけ */}
      {!filtering && (
        <>
          <div className="tag-tree-head">
            <button onClick={() => startCreate({ kind: 'group' })} title="创建归纳标签的分类轴">
              <Plus size={12} /> 群组
            </button>
            <button
              onClick={() => startCreate({ kind: 'tag', groupId: null })}
              title="创建不属于任何分组的标签"
            >
              <Plus size={12} /> 标签
            </button>
          </div>
          {creating?.kind === 'group' && createForm('输入分组名后按 Enter')}
        </>
      )}

      {groups.map((g, i) => renderHeader(g, i))}
      {/* 未分類は中身があるときだけ出す。作成フォームを開いている間と、
          ドラッグ中(群组から外す先が要る)も出しておく */}
      {(ungrouped.length > 0 ||
        dragging != null ||
        (creating?.kind === 'tag' && creating.groupId === null)) &&
        renderHeader(null, -1)}

      {/* ドラッグ中のゴースト。カーソルに追従させて「何を掴んでいるか」を見せる */}
      {dragging && (
        <div className="tag-drag-ghost" style={{ left: dragging.x + 12, top: dragging.y + 8 }}>
          {dragging.kind === 'tag'
            ? tags.find((t) => t.id === dragging.id)?.name
            : groups.find((g) => g.id === dragging.id)?.name}
        </div>
      )}

      {!filtering && tags.length === 0 && groups.length === 0 && (
        <div className="tag-tree-empty">
          先创建分组（如「类型」）和标签，之后选中视频即可在详情面板中添加
        </div>
      )}

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
    </>
  );
}
