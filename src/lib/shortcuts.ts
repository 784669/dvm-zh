/*
 * 快捷键の一覧(v1.39)。
 *
 * **ここが一覧の唯一の出所**。キー処理そのものは各ハンドラの switch が持ったままで、
 * この表は「何が割り当てられているか」だけを持つ(リバインドは作らないと決めた。
 * 理由は DESIGN.md「快捷键の一覧」節)。
 *
 * 表とハンドラが二重管理になるのは承知のうえで、**ずれは shortcuts.test.ts が見張る** ——
 * usePlayerShortcuts.ts と VideoGrid.tsx のソースから `case '…':` を抜き出して、
 * ここに載っているかを突き合わせている。キーを足して一覧に書き忘れたらテストが落ちる。
 * だから `keys` には表示用の文字列ではなく **生の `e.key` の値**を入れること。
 */

export type ShortcutMod = 'Ctrl' | 'Shift' | 'Alt';

export interface ShortcutDef {
  /** 修飾キー。表示にも使う */
  mods?: ShortcutMod[];
  /**
   * 実際の `e.key` の値。**英字は小文字だけを持つ** —— ハンドラは `case 'k': case 'K':` と
   * 2 つ並べているが、一覧では 1 つに畳む(テスト側が大文字を小文字に寄せて突き合わせる)。
   * 複数入っているものは「どれを押しても同じ」の意味(Space と K など)
   */
  keys: string[];
  /**
   * `e.key` を持たない項目の表記(配合鼠标使用操作)。
   * **`keys` が空のときだけ使う**。ソースとの突き合わせからも外れる
   */
  display?: string;
  label: string;
  /** 「mpv のみ」「最多前 1000 个」などの補足 */
  note?: string;
}

export type ShortcutGroupKey = 'grid' | 'player' | 'menu' | 'input' | 'mouse' | 'common';

export interface ShortcutGroup {
  key: ShortcutGroupKey;
  title: string;
  /** この系統がいつ効くか。見出し的直接下级に出す */
  when: string;
  items: ShortcutDef[];
}

/**
 * 表示用のキー名。矢印は記号にする(`←` のほうが一覧では圧倒的に読みやすい)。
 * ここに無いものはそのまま出す(`Home` / `PageUp` / `<` など)
 */
const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Delete: 'Del',
};

export function keyLabel(key: string): string {
  // 英字 1 文字は大文字で見せる(表では小文字で持っている)
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  return KEY_LABELS[key] ?? key;
}

/**
 * 1 項目を `<kbd>` に流し込む単位に分ける。
 * `{ mods: ['Ctrl'], keys: ['ArrowLeft', 'ArrowRight'] }` → `['Ctrl', '←', '→']`
 */
export function chordLabel(def: ShortcutDef): string[] {
  // 修飾キーは keys が空でも前に付ける(Ctrl+点击 / Shift+点击)
  const tail = def.keys.length > 0 ? def.keys.map(keyLabel) : def.display ? [def.display] : [];
  return [...(def.mods ?? []), ...tail];
}

/**
 * 文字を打っている最中か。
 *
 * VideoGrid.tsx と usePlayerShortcuts.ts に同じ判定がベタ書きで 2 つあったものを
 * 関数にした(`?` のハンドラで 3 つめの複製を作らないため)。判定内容は変えていない ——
 * `contentEditable` を見ていないのも従来どおりで、アプリ内に該当する要素が無いから
 */
export function isTypingTarget(e: Event): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    key: 'grid',
    title: '列表',
    when: '在缩略图视图或详细列表视图时',
    items: [
      { keys: ['ArrowLeft', 'ArrowRight'], label: '上一个 / 下一个视频' },
      { keys: ['ArrowUp', 'ArrowDown'], label: '上下移动一行' },
      { mods: ['Shift'], keys: ['ArrowLeft'], label: '保持选中并移动以扩大范围', note: '箭头键·Home·End 中任意一个' },
      { keys: ['Home', 'End'], label: '到开头 / 末尾' },
      { keys: ['Enter'], label: '播放' },
      { mods: ['Ctrl'], keys: ['a'], label: '全选', note: '最多前 1000 个' },
      { keys: ['q'], label: '将选择添加到播放队列', note: '右键菜单的「队列」中也可选择「下次播放」' },
      { keys: ['Delete'], label: '删除', note: '在对话框中选择从媒体库删除，还是送入回收站' },
      // 処理は App.tsx(Escape と同じく、VideoGrid のソース突き合わせの対象外)
      { mods: ['Alt'], keys: ['ArrowLeft', 'ArrowRight'], label: '筛选 后退 / 前进', note: '在智能文件夹、AI 搜索、统计之间切换所改的条件' },
      { keys: ['Escape'], label: '取消选择' },
    ],
  },
  {
    key: 'player',
    title: '播放中',
    when: '在使用应用内播放器播放时',
    items: [
      { keys: [' ', 'k'], label: '播放 ⇄ 暂停' },
      { keys: ['ArrowLeft', 'ArrowRight'], label: '后退 / 前进 10 秒' },
      { mods: ['Ctrl'], keys: ['ArrowLeft', 'ArrowRight'], label: '上一个 / 下一章节', note: '仅在使用 mpv 播放时' },
      { keys: ['PageUp', 'PageDown'], label: '上一个 / 下一章节', note: '仅在使用 mpv 播放时' },
      { keys: ['ArrowUp', 'ArrowDown'], label: '音量 ±10%' },
      { keys: ['m'], label: '静音 ⇄ 取消静音' },
      { keys: ['f'], label: '全屏 ⇄ 退出' },
      { keys: ['<', '>'], label: '降低 / 提高播放速度' },
      { keys: ['n', 'p'], label: '到下一 / 上一个视频', note: '仅在使用连续播放·播放队列打开时' },
      { keys: ['q'], label: '打开 / 关闭播放队列', note: '播放中也可排列·删除' },
      { keys: ['t'], label: '将此位置设为缩略图' },
      { keys: ['s'], label: '将此帧保存为图片' },
      { keys: ['u'], label: '显示尺寸 原始大小 ⇄ 适应', note: '仅在使用 mpv 播放时' },
      { keys: ['a'], label: '切换连续播放' },
      { keys: ['r'], label: '切换循环播放' },
      { keys: ['Escape'], label: '关闭', note: '全屏时仅可退出' },
    ],
  },
  {
    key: 'menu',
    title: '右键菜单',
    when: '菜单打开期间(背后的列表·播放操作将暂停)',
    items: [
      { keys: ['ArrowUp', 'ArrowDown'], label: '选择项目' },
      { keys: ['ArrowRight'], label: '打开子菜单' },
      { keys: ['ArrowLeft'], label: '关闭子菜单' },
      { keys: ['Enter', ' '], label: '执行所选项' },
      { keys: ['Escape'], label: '关闭', note: '若已打开子菜单，则仅关闭它' },
    ],
  },
  {
    key: 'input',
    title: '输入中',
    when: '标题、备注、标签、系列、AI 助手的输入框',
    items: [
      { keys: ['Enter'], label: '确定', note: '在 AI 助手中为发送' },
      { mods: ['Shift'], keys: ['Enter'], label: '在 AI 助手中为换行' },
      { keys: ['Escape'], label: '撤销编辑', note: '标题、备注、标签名的修改' },
    ],
  },
  {
    key: 'mouse',
    title: '配合鼠标使用',
    when: '列表的卡片·行及其空白区域',
    items: [
      { keys: [], display: '点击', label: '仅选择那 1 个' },
      { mods: ['Ctrl'], keys: [], display: '点击', label: '加入 / 移出选择' },
      { mods: ['Shift'], keys: [], display: '点击', label: '从刚选中的位置开始选择范围' },
      {
        keys: [],
        display: '从空白区域拖拽',
        label: '选中框选范围',
        note: '从卡片上方抓取可添加到队列面板',
      },
      {
        mods: ['Ctrl'],
        keys: [],
        display: '从空白区域拖拽',
        label: '将框选范围加入选择',
      },
    ],
  },
  {
    key: 'common',
    title: '窗口通用',
    when: '任意位置',
    items: [
      { keys: ['?'], label: '打开 / 关闭此快捷键列表' },
      { keys: ['Escape'], label: '关闭已打开的弹窗·菜单' },
    ],
  },
];
