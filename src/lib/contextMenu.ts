import {
  AppWindow, ArrowDown, ArrowDownUp, ArrowUp, BookmarkPlus, Camera, ChevronDown, Copy, CopyMinus,
  CopyPlus, ExternalLink, EyeOff, FileDown, Folder, FolderInput, FolderOpen, FolderPlus,
  FolderSearch, FolderUp, Funnel, FunnelPlus, FunnelX, GalleryThumbnails, Layers, LayoutGrid,
  Library, ListOrdered, ListVideo, ListX, Palette, Pencil, Play, Plus, RefreshCw, SquareCheck,
  SquareDashed, Star, Trash2, Unplug, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  FolderNode, LibraryEntry, Playlist, Series, SmartFolder, Tag, TagGroup, VideoRow, ViewMode,
  WatchedFolder,
} from '../types';
import { hasActiveFilter } from './filterChips';
import { sortLabel, sortOptions } from './listColumns';
import type { FilterState } from './query';
import { TAG_PALETTE } from './tagColors';

/**
 * 右键菜单の項目(v1.14。適用範囲の拡大は v1.20)。
 * **どの項目をどんな状態で出すかはここだけで決める**。ContextMenu.tsx は
 * 受け取った配列を描画するだけにして、条件分岐をテストできる場所に閉じ込める。
 *
 * 使えない項目は消さずに disabled で残す(エクスプローラーと同じ)。
 * 選択件数や离线かどうかで項目の位置が動くと、
 * 「いつもの位置を点击したら別のものが実行された」が起きるため。
 *
 * **id は対象ごとの接頭辞を持つ**(`tag:` `group:` `wf:` `sf:` `series:` `tree:`
 * `blank:` `player:`)。v1.14 からある動画メニューとサブ文件夹カードだけは
 * 接頭辞なしのまま据え置く — 既に id 文字列で分岐しているので無用な差分を作らない
 */
export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  /** ホバーで出す補足。disabled のときは「なぜ押せないか」を入れる */
  hint?: string;
  /** 赤字で見せる(削除系) */
  danger?: boolean;
  /** 現在値としてチェック印を出す */
  checked?: boolean;
  /**
   * アイコンの代わりに描く色丸(v1.20。标签の色サブメニュー用)。
   * 「赤」「橙色」という名前だけでは色を選べないので、実物を見せる
   */
  swatch?: string;
  submenu?: MenuItem[];
}

/** 区切り線 */
export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

export const isSeparator = (e: MenuEntry): e is MenuSeparator => 'separator' in e;

/** 実体の文个触れるか(离线ドライブと見失った文件は触らない) */
const usable = (v: VideoRow) => !v.isMissing && !v.isOffline;

/** disabled にする理由を 1 つ返す。押せない項目をホバーしたときの説明に使う */
function whyUnusable(v: VideoRow): string {
  return v.isOffline ? '驱动器未连接' : '找不到文件';
}

/** 選択全件の评分が揃っていればその値。バラバラなら null */
function commonRating(selection: VideoRow[]): number | null {
  const first = selection[0]?.rating ?? 0;
  return selection.every((v) => v.rating === first) ? first : null;
}

/** 评分の ★5〜★1 +「未评价」。プレイヤーのメニューとも共有する(v1.20) */
export function ratingSubmenu(selection: VideoRow[]): MenuItem[] {
  const current = commonRating(selection);
  const stars = [5, 4, 3, 2, 1].map((n) => ({
    id: `rating:${n}`,
    label: '★'.repeat(n) + '☆'.repeat(5 - n),
    checked: current === n,
  }));
  return [...stars, { id: 'rating:0', label: '未评价', checked: current === 0 }];
}

/**
 * 再生队列のサブメニュー(v1.40)。3 つはそれぞれ別の場面を埋める:
 *
 * - **末尾に追加** が基本形
 * - **接着播放** は再生中の直後に挟む(一覧側からしか挟めない)。
 *   队列で再生していないときは末尾に足すのと同じになる(lib/queue.ts の addToQueue)
 * - **替换队列并播放** は、選んだものだけで再生を始める唯一の入口。
 *   ダブル点击はクエリ方式の連続再生のままなので、これが無いと
 *   「選択した数本だけを流す」ができない
 */
export function queueSubmenu(count: number): MenuItem[] {
  const n = count > 1 ? `${count} 个` : '';
  return [
    { id: 'queue:add', label: `${n}添加到队列`, icon: Plus, hint: '添加到队列末尾' },
    {
      id: 'queue:next',
      label: `${n}接着播放`,
      icon: ListVideo,
      hint: '插入到当前播放视频的下一个',
    },
    // サブメニューは区切り線を持てない(MenuItem[] なので)。3 項目なので要らない
    {
      id: 'queue:replace',
      label: `${n}替换队列并播放`,
      icon: Play,
      hint: '丢弃当前队列，仅用所选视频开始播放',
    },
  ];
}

/**
 * 動画カード / リスト行のメニュー。
 * `selection` が対象の全件、`target` は右点击したカードの動画。
 * 1 件しか意味を持たない項目(在资源管理器中显示など)は target を見る
 */
export function buildVideoMenu(selection: VideoRow[], target: VideoRow): MenuEntry[] {
  const n = selection.length;
  const single = n === 1;
  /** 1 件でも実体を触れるものがあるか(複数件まとめて実行する操作の判定) */
  const anyUsable = selection.some(usable);
  const targetHint = usable(target) ? undefined : whyUnusable(target);
  // 複数選択中は単一件専用の項目を押せなくする。10 件選んだまま押して
  // アプリが 10 個立ち上がる、といった事故を防ぐ
  const singleHint = single ? targetHint : '仅在选择 1 个时可用';
  const someHint = anyUsable ? undefined : '没有可操作的实体文件';
  const count = single ? '' : `${n} 个`;

  return [
    {
      id: 'play',
      label: '播放',
      icon: Play,
      disabled: !usable(target),
      hint: targetHint,
    },
    { separator: true },
    {
      id: 'rating',
      label: '评分',
      icon: Star,
      submenu: ratingSubmenu(selection),
    },
    /*
     * 再生队列(v1.40)。**サブメニューに畳んである** —— 動画メニューはちょうど
     * 12 項目で目安の上限なので、トップレベルはこの 1 つに収める。
     *
     * 「队列は常に 1 本」にしたので、**どの队列に入れるかを選ぶ入力が要らない**。
     * だからこの基準(候補一覧から選ぶ入力が要るものは載せない)の内側に入る。
     * 逆に「保存リストに追加」は**載せない** —— どのリストかを選ぶ必要があり、
     * 系列登録·标签付けとまったく同じ理由で详情面板側の担当になる
     */
    {
      id: 'queue',
      label: '队列',
      icon: ListVideo,
      submenu: queueSubmenu(selection.length),
    },
    { separator: true },
    /*
     * OS 連携の 2 つ(v1.40 でサブメニューに畳んだ)。
     *
     * v1.39 まで動画メニューはちょうど 12 項目で目安の上限にあり、队列を足すと
     * 13 になる。**新項目をサブメニューにしても、その入口 1 つぶんは増える** ——
     * 「サブメニューに畳むか既存項目を見直す」の後半を使い、
     * 「どのアプリで打开か」という同じ問いの 2 つをここにまとめて 1 枠に戻した。
     * `reveal`(在资源管理器中显示)は入れない —— あちらは動画を播放のではなく
     * 場所を見せる操作で、問いが違う
     */
    {
      id: 'openWithApp',
      label: '用其他应用打开',
      icon: ExternalLink,
      disabled: !single || !usable(target),
      hint: singleHint,
      submenu: [
        { id: 'openDefault', label: '默认应用', icon: ExternalLink },
        { id: 'openWith', label: '选择程序...', icon: AppWindow },
      ],
    },
    {
      id: 'reveal',
      label: '在资源管理器中显示',
      icon: FolderSearch,
      disabled: !usable(target),
      // 複数選んでいても、右点击した 1 件だけを見せる
      hint: targetHint ?? (single ? undefined : '显示右键点击的那 1 个'),
    },
    { separator: true },
    {
      id: 'openFolder',
      label: '打开此文件夹',
      icon: FolderOpen,
      // DB のパスから絞り込むだけなので、离线でも使える
      hint: single ? undefined : '按该视频所在的文件夹筛选',
    },
    {
      id: 'copyPath',
      label: single ? '复制完整路径' : `复制 ${count}完整路径`,
      icon: Copy,
    },
    { separator: true },
    {
      id: 'rename',
      label: '重命名...',
      icon: Pencil,
      disabled: !single || !usable(target),
      hint: singleHint,
    },
    {
      id: 'move',
      label: `${count}移动...`,
      icon: FolderInput,
      disabled: !anyUsable,
      hint: someHint,
    },
    {
      id: 'rethumb',
      label: '重新生成缩略图',
      icon: RefreshCw,
      disabled: !anyUsable,
      hint: someHint,
    },
    { separator: true },
    {
      id: 'removeFromLibrary',
      label: `${count}从媒体库删除`,
      icon: ListX,
      danger: true,
      // 見失った文件の後始末に使うので、离线でも押せる必要がある
      hint: '文件本身不会被删除',
    },
    {
      id: 'trash',
      label: `${count}送入回收站`,
      icon: Trash2,
      danger: true,
      disabled: !anyUsable,
      hint: someHint ?? '将文件送入回收站，并从媒体库中删除',
    },
  ];
}

/** 一覧の先頭に並ぶサブ文件夹カードのメニュー(v1.14 は 3 項目だけ) */
export function buildFolderMenu(): MenuEntry[] {
  return [
    { id: 'folderOpen', label: '打开', icon: FolderOpen },
    { id: 'folderReveal', label: '在资源管理器中显示', icon: FolderSearch },
    { id: 'folderCopyPath', label: '复制路径', icon: Copy },
  ];
}

// ============================================================================
// v1.20:適用範囲の拡大。侧边栏·グリッドの余白·プレイヤー
//
// 「12 項目を超えたらサブメニューに畳む」の目安は**対象ごとに数える**。
// 動画メニューが 12 で上限なのは動画メニューの話であって、他の対象の予算は食わない
// ============================================================================

/** 「上移 / 下移」が押せない理由。押せるときは undefined */
function whyCantMove(index: number, total: number, dir: -1 | 1): string | undefined {
  if (dir === -1) return index <= 0 ? '已在最前' : undefined;
  return index >= total - 1 ? '已在最后' : undefined;
}

/** 标签の色サブメニュー。7 色 + 无颜色。現在の色にチェックを付ける */
function tagColorSubmenu(current: string | null): MenuItem[] {
  return [
    ...TAG_PALETTE.map((c) => ({
      id: `tag:color:${c.value}`,
      label: c.label,
      swatch: c.value,
      checked: current === c.value,
    })),
    { id: 'tag:color:none', label: '无颜色', checked: current === null },
  ];
}

/** 标签の所属群组を選ぶサブメニュー。未分類も 1 つの選択肢として並べる */
function tagGroupSubmenu(current: number | null, groups: TagGroup[]): MenuItem[] {
  return [
    { id: 'tag:group:none', label: '(未分类)', checked: current === null },
    ...groups.map((g) => ({
      id: `tag:group:${g.id}`,
      label: g.name,
      checked: current === g.id,
    })),
  ];
}

/**
 * 侧边栏の标签行(v1.20)。
 *
 * ここが受け持つのは**标签そのものの管理**(筛选·名前·色·群组·削除)。
 * 動画への标签付与は详情面板の标签パレットの担当で、v1.19 の切り分けは変えていない。
 *
 * `activeTagIds` は store の tagIds をそのまま渡す(筛选中の标签)
 */
export function buildTagMenu(tag: Tag, groups: TagGroup[], activeTagIds: number[]): MenuEntry[] {
  const active = activeTagIds.includes(tag.id);
  // 「これだけで絞り込む」が今の状態と同じ結果になるなら押させない
  const onlyThis = activeTagIds.length === 1 && active;
  const noOthers = activeTagIds.length === 0;

  return [
    {
      id: 'tag:filter',
      label: active ? '从筛选中移除' : '添加到筛选',
      icon: Funnel,
      checked: active,
      hint: '筛选带有此标签的视频',
    },
    {
      id: 'tag:filterOnly',
      label: '仅按此标签筛选',
      icon: FunnelPlus,
      disabled: onlyThis || noOthers,
      hint: onlyThis
        ? '已经仅按此标签筛选了'
        : noOthers
          ? '没有其他正在筛选的标签'
          : '取消其他标签的筛选，仅保留此标签',
    },
    { separator: true },
    { id: 'tag:rename', label: '重命名...', icon: Pencil },
    {
      id: 'tag:color',
      label: '色',
      icon: Palette,
      submenu: tagColorSubmenu(tag.color),
    },
    {
      id: 'tag:group',
      label: '群组',
      icon: Layers,
      disabled: groups.length === 0,
      hint: groups.length === 0 ? '还没有标签群组' : undefined,
      submenu: tagGroupSubmenu(tag.groupId, groups),
    },
    { separator: true },
    {
      id: 'tag:delete',
      label: '删除标签',
      icon: Trash2,
      danger: true,
      hint: `${tag.videoCount} 个视频将移除（视频本身不删除）`,
    },
  ];
}

/**
 * 侧边栏の标签群组見出し(v1.20)。**未分類は `group = null` で呼ぶ**。
 *
 * 未分類は DB 上の行ではないので、名前·排序·削除がどれも意味を持たない。
 * 項目を消さずに disabled で残すのは動画メニューと同じ方針
 * (見出しごとに項目の位置が動くと押し間違える)
 */
export function buildTagGroupMenu(
  group: TagGroup | null,
  index: number,
  total: number,
  tagCount: number,
  allOn: boolean,
  collapsed: boolean,
): MenuEntry[] {
  const emptyHint = tagCount === 0 ? '还没有标签' : undefined;
  // 未分類は常に最後に置いているので、排列の対象にしない
  const ungroupedHint = group === null ? '未分类无法排序' : undefined;

  return [
    {
      id: 'group:filter',
      label: allOn ? '解除此群组的筛选' : '按此群组筛选',
      icon: Funnel,
      checked: allOn,
      disabled: tagCount === 0,
      hint: emptyHint ?? '将带有其中标签的视频一并显示',
    },
    {
      id: 'group:toggle',
      label: collapsed ? '显示标签' : '隐藏标签',
      icon: ChevronDown,
      disabled: tagCount === 0,
      hint: emptyHint,
    },
    { separator: true },
    {
      id: 'group:newTag',
      label: group ? '在此群组中创建标签...' : '创建不属于任何群组的标签...',
      icon: Plus,
    },
    { id: 'group:newGroup', label: '创建群组...', icon: FolderPlus },
    { separator: true },
    {
      id: 'group:rename',
      label: '重命名...',
      icon: Pencil,
      disabled: group === null,
      hint: group === null ? '未分类无法重命名' : undefined,
    },
    {
      id: 'group:moveUp',
      label: '上移',
      icon: ArrowUp,
      disabled: group === null || index <= 0,
      hint: ungroupedHint ?? whyCantMove(index, total, -1),
    },
    {
      id: 'group:moveDown',
      label: '下移',
      icon: ArrowDown,
      disabled: group === null || index >= total - 1,
      hint: ungroupedHint ?? whyCantMove(index, total, 1),
    },
    { separator: true },
    {
      id: 'group:delete',
      label: '删除群组',
      icon: Trash2,
      danger: true,
      disabled: group === null,
      hint: group === null
        ? '未分类无法删除'
        : `${group.tagCount} 个标签将移到未分类`,
    },
  ];
}

/**
 * 侧边栏のセクション見出し(v1.42)。
 *
 * 折りたたみが右点击にも入口を持つのは标签群组(`group:toggle`)·
 * 文件夹ツリー(`tree:expand`)と同じ規約。**「全部展开」を必ず置く** ——
 * 5 つ全部畳んだ状態から見出しの点击だけで戻すと 5 回押すことになる
 */
export function buildSideSectionMenu(label: string, collapsed: boolean): MenuEntry[] {
  return [
    {
      id: 'section:toggle',
      label: collapsed ? `${label}显示` : `${label}隐藏`,
      icon: ChevronDown,
    },
    { separator: true },
    { id: 'section:collapseAll', label: '全部折叠', icon: CopyMinus },
    { id: 'section:expandAll', label: '全部展开', icon: CopyPlus },
  ];
}

/**
 * 侧边栏の监视文件夹行(v1.20)。
 *
 * 离线でも「表示」「复制路径」「从监控对象中移除」は押せる —
 * どれも DB とパス文字列だけの操作で、ドライブに触らない。
 * 从媒体库删除を离线でも押せるようにしたのと同じ理由
 */
export function buildWatchedFolderMenu(folder: WatchedFolder, isActive: boolean): MenuEntry[] {
  const offlineHint = folder.online ? undefined : '驱动器未连接';
  return [
    {
      id: 'wf:open',
      label: '显示此文件夹及其下级',
      icon: FolderOpen,
      checked: isActive,
      hint: '包含子文件夹一并显示',
    },
    {
      id: 'wf:openDirect',
      label: '仅显示此文件夹的直接下级',
      icon: Folder,
      hint: '不含子文件夹，仅筛选直接下级',
    },
    { separator: true },
    {
      id: 'wf:reveal',
      label: '在资源管理器中显示',
      icon: FolderSearch,
      disabled: !folder.online,
      hint: offlineHint,
    },
    { id: 'wf:copyPath', label: '复制路径', icon: Copy },
    { separator: true },
    {
      id: 'wf:remove',
      label: '从监控对象中移除',
      icon: ListX,
      danger: true,
      hint: '文件夹本身不会被删除',
    },
  ];
}

/**
 * 侧边栏の智能文件夹行(v1.20)。
 *
 * 排列は侧边栏を絞り込んでいる間は使えない — 見えている行の index で
 * 動かすと、隠れている行を飛び越して並びが壊れるため。
 * 呼ぶ側は**絞り込む前の配列**の index / total を渡すこと
 */
export function buildSmartFolderMenu(
  sf: SmartFolder,
  index: number,
  total: number,
  filtering: boolean,
): MenuEntry[] {
  const filterHint = filtering ? '筛选中无法排序' : undefined;
  return [
    {
      id: 'sf:open',
      label: '打开此条件',
      icon: FolderSearch,
      hint: '恢复已保存的搜索条件',
    },
    {
      // v1.41(C-4)。「平日の消化リスト」のような条个 1 点击で流すための入口
      id: 'sf:load',
      label: '载入队列并播放',
      icon: ListVideo,
      hint: '用符合条件的视频替换当前队列(最多前 500 个)',
    },
    { separator: true },
    { id: 'sf:rename', label: '重命名...', icon: Pencil },
    {
      id: 'sf:overwrite',
      label: '用当前搜索条件覆盖',
      icon: BookmarkPlus,
      hint: `用当前筛选条件${sf.name}」替换`,
    },
    {
      id: 'sf:moveUp',
      label: '上移',
      icon: ArrowUp,
      disabled: filtering || index <= 0,
      hint: filterHint ?? whyCantMove(index, total, -1),
    },
    {
      id: 'sf:moveDown',
      label: '下移',
      icon: ArrowDown,
      disabled: filtering || index >= total - 1,
      hint: filterHint ?? whyCantMove(index, total, 1),
    },
    { separator: true },
    {
      id: 'sf:delete',
      label: '删除',
      icon: Trash2,
      danger: true,
      hint: '仅删除已保存的条件(视频不删除)',
    },
  ];
}

/**
 * 侧边栏の保存播放列表行(v1.40)。
 *
 * **中身の編集はここに置かない** —— 編集経路は「队列に読み込む → 直す → 覆盖保存」の
 * 1 本だけにしてある。棚側にも直接編集を足すと書き込み経路が 2 本になり、
 * 「削除は即反映、追加は覆盖保存が必要」という説明しづらい非対称が生まれる
 * (详情面板から文件操作を外したときと同じ判断)
 */
export function buildPlaylistMenu(
  playlist: Playlist,
  isActive: boolean,
  index: number,
  total: number,
  filtering: boolean,
): MenuEntry[] {
  const empty = playlist.videoCount === 0;
  // 智能文件夹と同じ理由で、筛选中は排列を無効にする
  const filterHint = filtering ? '筛选中无法排序' : undefined;
  return [
    {
      id: 'pl:load',
      label: '载入队列并播放',
      icon: ListVideo,
      disabled: empty,
      hint: empty ? '播放列表为空' : '将替换当前队列',
    },
    {
      id: 'pl:filter',
      label: isActive ? '解除筛选' : '按此列表筛选',
      icon: Funnel,
      checked: isActive,
      hint: '按列表中保存的排列顺序显示',
    },
    { separator: true },
    { id: 'pl:rename', label: '重命名...', icon: Pencil },
    {
      id: 'pl:duplicate',
      label: '複製',
      icon: CopyPlus,
      hint: `「${playlist.name} 的副本」创建`,
    },
    {
      // v1.41(C-3)。フルパスの並びを UTF-8 の M3U8 に書くだけなので、
      // mpv·VLC などの外部プレイヤーでそのまま流せる
      id: 'pl:export',
      label: '导出为 M3U8...',
      icon: FileDown,
      disabled: empty,
      hint: empty ? '播放列表为空' : '保存为可供外部播放器使用的列表',
    },
    {
      id: 'pl:moveUp',
      label: '上移',
      icon: ArrowUp,
      disabled: filtering || index <= 0,
      hint: filterHint ?? whyCantMove(index, total, -1),
    },
    {
      id: 'pl:moveDown',
      label: '下移',
      icon: ArrowDown,
      disabled: filtering || index >= total - 1,
      hint: filterHint ?? whyCantMove(index, total, 1),
    },
    { separator: true },
    {
      id: 'pl:delete',
      label: '删除',
      icon: Trash2,
      danger: true,
      hint: '仅删除列表(视频不删除)',
    },
  ];
}

/** 侧边栏の系列行(v1.20) */
export function buildSeriesMenu(series: Series, isActive: boolean): MenuEntry[] {
  return [
    {
      id: 'series:filter',
      label: isActive ? '解除筛选' : '按此系列筛选',
      icon: ListOrdered,
      checked: isActive,
      hint: '系列内按注册顺序排列',
    },
    { separator: true },
    { id: 'series:rename', label: '重命名...', icon: Pencil },
    { separator: true },
    {
      id: 'series:delete',
      label: '删除系列',
      icon: Trash2,
      danger: true,
      hint: `${series.videoCount} 个视频将移除（视频本身不删除）`,
    },
  ];
}

/**
 * 侧边栏「文件夹」タブのツリー行(v1.20)。
 *
 * サブ文件夹カードの `buildFolderMenu()` とは**別関数にする**。
 * ツリーは离线判定と開閉状態を持つので、無理に共有すると
 * 両方に相手の都合の引数が生える
 */
export function buildFolderTreeMenu(
  node: FolderNode,
  hasChildren: boolean,
  isExpanded: boolean,
  isActive: boolean,
): MenuEntry[] {
  const watched = node.watchedFolderId !== null;
  return [
    {
      id: 'tree:open',
      label: '显示此文件夹的直接下级',
      icon: FolderOpen,
      checked: isActive,
      hint: '再次选择则解除',
    },
    {
      id: 'tree:expand',
      label: isExpanded ? '隐藏子文件夹' : '显示子文件夹',
      icon: ChevronDown,
      disabled: !hasChildren,
      hint: hasChildren ? undefined : '没有子文件夹',
    },
    { separator: true },
    {
      id: 'tree:reveal',
      label: '在资源管理器中显示',
      icon: FolderSearch,
      disabled: !node.online,
      hint: node.online ? undefined : '驱动器未连接',
    },
    { id: 'tree:copyPath', label: '复制路径', icon: Copy },
    { separator: true },
    {
      id: 'tree:watch',
      label: '添加到监控文件夹',
      icon: FolderPlus,
      disabled: watched,
      // 「外す」は监视文件夹行の担当。入口を 2 か所に置かない
      hint: watched ? '已经是监控文件夹' : '将成为启动时扫描与自动监控的对象',
    },
    { separator: true },
    {
      // 実行前に必ず下見(件数と内訳)を出すので、ここでは確認を挟まず打开だけ
      id: 'tree:dedupe',
      label: '消除此文件夹的重复',
      icon: CopyMinus,
      hint: '仅保留内容相同的视频中的 1 个(不删除文件)',
    },
    {
      id: 'tree:exclude',
      label: '注册到监控排除文件夹',
      icon: EyeOff,
      hint: '从下次扫描起忽略其下级(不删除文件)',
    },
  ];
}

/**
 * 切换媒体库(v1.27)。侧边栏最上部のボタンから**左点击で**打开。
 *
 * **「重命名」「从列表移除」はここに置かない。** 破壊的に見える操作と
 * 候補一覧から選ぶ入力が要るものは管理画面(設定モーダル)の担当、という v1.14 の基準。
 * 逆に切り替えは設定モーダルに置かない —— 同じ操作の入口を 2 か所に作らない。
 *
 * **未接続の媒体库も押せるままにする。** 無効にすると「なぜ出ているのか」だけが
 * 残って何も起きないので、選んだときにドライブを繋ぐよう案内するほうが先に進める
 */
export function buildLibraryMenu(libraries: LibraryEntry[], currentId: string): MenuEntry[] {
  return [
    ...libraries.map((lib) => ({
      id: `lib:switch:${lib.id}`,
      label: lib.online ? lib.name : `${lib.name}(未连接)`,
      icon: lib.online ? Library : Unplug,
      checked: lib.id === currentId,
      hint: lib.online ? lib.root : `${lib.root} 无法连接到`,
    })),
    { separator: true },
    { id: 'lib:create', label: '新建媒体库...', icon: FolderPlus },
    { id: 'lib:add', label: '打开现有媒体库...', icon: FolderOpen },
  ];
}

/** グリッド余白のメニューが見る状態。筛选は buildQuery と同じ FilterState をそのまま渡す */
export interface GridBlankState {
  /** いま一覧に出ている件数 */
  total: number;
  selectionCount: number;
  viewMode: ViewMode;
  /** 「上层文件夹」。文件夹で絞っていないか、监视文件夹の外に出るときは null */
  parentPath: string | null;
  filters: FilterState;
}

/**
 * グリッドの余白(v1.20)。
 *
 * v1.14 では「余白は選択解除だけでメニューは出さない」としていたが、
 * エクスプローラーの余白メニュー(表示 ▸ / 排列 ▸ / 最新の情報に更新)が
 * まさにこの内容で、ユーザーの手が覚えている。それに合わせる。
 *
 * 「重新扫描」「文件夹を追加」はアプリ全体の処理なので載せない
 * (ツールバー / 侧边栏の担当)
 */
export function buildGridBlankMenu(s: GridBlankState): MenuEntry[] {
  const f = s.filters;
  const noFolder = f.dirPath === null ? '仅在使用文件夹筛选时可用' : undefined;
  // 筛选帯(v1.28)と同じ判定を使う。「帯にチップが 1 つも無いのにここは押せる」
  // という食い違いが構造的に起きないようにするため
  const filtered = hasActiveFilter(f);

  return [
    {
      id: 'blank:selectAll',
      label: '全选',
      icon: SquareCheck,
      disabled: s.total === 0,
      hint: s.total === 0 ? '没有正在显示的视频' : undefined,
    },
    {
      id: 'blank:clearSelection',
      label: '取消选择',
      icon: SquareDashed,
      disabled: s.selectionCount === 0,
      hint: s.selectionCount === 0 ? '没有选中的视频' : undefined,
    },
    { separator: true },
    {
      // v1.41(C-4)。選択してから追加する手間を省き、いま見えている結果を丸ごと流す
      id: 'blank:loadQueue',
      label: '将当前列表载入队列并播放',
      icon: ListVideo,
      disabled: s.total === 0,
      hint: s.total === 0
        ? '没有正在显示的视频'
        : '用筛选结果替换当前队列(最多前 500 个)',
    },
    { separator: true },
    {
      id: 'blank:view',
      label: '显示',
      icon: LayoutGrid,
      submenu: [
        { id: 'blank:view:grid', label: '缩略图', checked: s.viewMode === 'grid' },
        { id: 'blank:view:list', label: '详细列表', checked: s.viewMode === 'list' },
      ],
    },
    {
      id: 'blank:sort',
      label: '排列',
      icon: ArrowDownUp,
      // ツールバーの select と同じ選択肢を使う(片方だけ増えるのを防ぐ)
      submenu: sortOptions(f).map((k) => ({
        id: `blank:sort:${k}`,
        label: sortLabel(k),
        checked: f.sort === k,
      })),
    },
    { separator: true },
    {
      id: 'blank:up',
      label: '返回上层文件夹',
      icon: FolderUp,
      disabled: s.parentPath === null,
      hint: s.parentPath === null
        ? (noFolder ?? '没有更上层的文件夹了')
        : undefined,
    },
    {
      id: 'blank:reveal',
      label: '在资源管理器中显示此文件夹',
      icon: FolderSearch,
      disabled: f.dirPath === null,
      hint: noFolder,
    },
    { separator: true },
    {
      id: 'blank:clearFilters',
      label: '解除全部筛选',
      icon: FunnelX,
      disabled: !filtered,
      hint: filtered ? undefined : '当前没有筛选条件',
    },
    { id: 'blank:refresh', label: '重新加载', icon: RefreshCw },
  ];
}

/**
 * プレイヤー画面(v1.20)。
 *
 * **再生·音量·速度·全画面·連続再生·リピートは載せない** —
 * 同じバーにボタンがあり、キーもある。「対象そのものへの操作」という基準では
 * 再生の制御は「対象(文件)」ではなく「今の再生状態」に属する。
 *
 * 例外は缩略图位置。ボタンはあるが 2.5 秒で消える帯の中にあり、
 * 操作の対象も再生状態ではなく動画レコード(set_thumb_time)なので基準の内側にある
 */
export function buildPlayerMenu(video: VideoRow): MenuEntry[] {
  const hint = usable(video) ? undefined : whyUnusable(video);
  return [
    { id: 'player:rating', label: '评分', icon: Star, submenu: ratingSubmenu([video]) },
    { separator: true },
    {
      id: 'player:setThumb',
      label: '将此位置设为缩略图',
      icon: GalleryThumbnails,
      hint: '快捷键: T',
    },
    {
      // v1.26。バーにボタンはあるが 2.5 秒で消えるので、setThumb と同じ理由でここにも置く。
      // 実体の文个読む操作なので、离线·見失った文件では無効にする
      id: 'player:saveFrame',
      label: '将此帧保存为图片',
      icon: Camera,
      disabled: !usable(video),
      hint: hint ?? '快捷键: S',
    },
    { separator: true },
    {
      id: 'player:reveal',
      label: '在资源管理器中显示',
      icon: FolderSearch,
      disabled: !usable(video),
      hint,
    },
    { id: 'player:copyPath', label: '复制完整路径', icon: Copy },
    { separator: true },
    { id: 'player:close', label: '关闭', icon: X, hint: '快捷键: Esc' },
  ];
}
