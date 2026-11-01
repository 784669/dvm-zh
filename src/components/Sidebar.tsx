import { convertFileSrc } from '@tauri-apps/api/core';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  ChevronDown, Copy, FolderSearch, Library, ListOrdered, TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useContextMenu } from '../hooks/useContextMenu';
import {
  buildLibraryMenu, buildPlaylistMenu, buildSeriesMenu, buildSideSectionMenu, buildSmartFolderMenu,
  buildWatchedFolderMenu,
} from '../lib/contextMenu';
import { fmtTime } from '../lib/format';
import { baseName } from '../lib/paths';
import { buildQuery, toFilterState } from '../lib/query';
import { QUEUE_LIMIT, sourceRemoved, sourceRenamed } from '../lib/queue';
import { replaceQueueWith } from '../lib/queueLoad';
import {
  SECTION_KEYS, parseCollapsedSections, serializeCollapsedSections,
} from '../lib/settings';
import type { SectionKey } from '../lib/settings';
import { thumbSrc } from '../lib/thumbs';
import { useShallow } from 'zustand/react/shallow';
import { pickState, useLibrary } from '../store';
import type {
  FolderNode, LibraryEntry, PlanItem, Playlist, Series, SidebarTab, SmartFolder, Tag, TagGroup,
  VideoQuery, WatchedFolder,
} from '../types';
import { ContextMenu } from './ContextMenu';
import { FileOpDialog } from './FileOpDialog';
import { FolderTree } from './FolderTree';
import { TagTree } from './TagTree';

const VIDEO_EXTENSIONS = [
  'mp4', 'm4v', 'mkv', 'avi', 'wmv', 'mov', 'flv', 'webm',
  'mpg', 'mpeg', 'ts', 'm2ts', 'mts', 'vob', 'ogv', 'ogm',
  'rm', 'rmvb', 'asf', 'divx', '3gp',
];

/** 右键菜单の対象(v1.20)。标签は TagTree、文件夹ツリーは FolderTree の担当 */
type MenuTarget =
  | { kind: 'wf'; folder: WatchedFolder }
  | { kind: 'sf'; sf: SmartFolder }
  | { kind: 'series'; series: Series }
  | { kind: 'playlist'; playlist: Playlist }
  // v1.42。セクション見出しの折りたたみ
  | { kind: 'section'; section: SectionKey; label: string }
  // v1.27。これだけ右点击ではなくボタンの左点击で打开
  | { kind: 'library' };

/**
 * 折りたためるセクションの見出し(v1.42)。媒体库タブの 5 か所で使う。
 *
 * **見出しの JSX はここ 1 本にする**。三角·件数·右点击が付いて 1 か所 10 行になり、
 * 5 か所に写すと片方だけ直したときにずれる。三角の見た目は详情面板の
 * `.section-toggle` / `.section-chevron` をそのまま使う(もともと `.side-section` と
 * 同じトーンで作られている。App.css の v1.15 の節を参照)。
 *
 * **`<div>` で包まず标志メントを返すこと**。`.sidebar` は `gap: 2px` の 1 段の flex で
 * 行が全部その直接の子なので、包むとセクションまるごとが 1 個の flex アイテムに潰れて
 * 行間が消える(`MediaInfoSection` が标志メントを返しているのも同じ理由)。
 *
 * `children` にはその節の一覧だけでなく「+ 添加文件夹」のような**付属のボタンも入れる** ——
 * 見出しを畳んだのにボタンだけ残ると、何に対する追加なのか分からなくなる
 */
function SideSection({
  label, count, collapsed, filtering, onToggle, onContextMenu, children,
}: {
  label: string;
  /** 項目数。**畳んでいるときだけ出す** —— 行の `.count` は動画の本数なので、
   *  開いている間も出すと同じ見た目の数字が 2 つの意味で並ぶ */
  count: number;
  collapsed: boolean;
  /** 筛选中。畳みを無視して必ず開き、押しても何も起きない三角は消す */
  filtering: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const open = filtering || !collapsed;
  return (
    <>
      <div className="side-section-head" onContextMenu={onContextMenu}>
        {filtering ? (
          // 筛选中は畳めないので、v1.41 までと同じただの見出しに戻す。
          // 三角を残すと「押しても何も変わらないボタン」になる
          <span className="side-section-label">{label}</span>
        ) : (
          <button
            className={`section-toggle ${open ? 'open' : ''}`}
            onClick={onToggle}
            title={open ? `${label}隐藏` : `${label}显示`}
          >
            {/* 開閉でアイコンを変えず CSS で回す(形が変わると大きさが違って見える) */}
            <ChevronDown className="section-chevron" />
            {label}
          </button>
        )}
        {!open && <span className="count">{count}</span>}
      </div>
      {open && children}
    </>
  );
}

/**
 * いま画面に効いている筛选を VideoQuery にする(覆盖智能文件夹用)。
 * store は FilterState を丸ごと含んでいるのでそのまま渡す ——
 * 項目を書き写すと、条件が増えたときにここだけ古いまま残る
 */
function currentQuery(): VideoQuery {
  return buildQuery(useLibrary.getState());
}

export function Sidebar() {
  const {
    folderId, setFolderId, dirPath, version, bumpVersion, sidebarWidth,
    seriesId, toggleSeriesFilter,
    playlistId, togglePlaylistFilter,
    missingOnly, toggleMissingOnly,
    duplicatesOnly, toggleDuplicatesOnly, applyFilter, pushToast,
    libraryId: currentLibId, thumbVersion,
  } = useLibrary(useShallow(pickState(
    'folderId', 'setFolderId', 'dirPath', 'version', 'bumpVersion', 'sidebarWidth',
    'seriesId', 'toggleSeriesFilter', 'playlistId', 'togglePlaylistFilter',
    'missingOnly', 'toggleMissingOnly', 'duplicatesOnly', 'toggleDuplicatesOnly',
    'applyFilter', 'pushToast', 'libraryId', 'thumbVersion',
  )));
  const [tab, setTab] = useState<SidebarTab>('library');
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [smartFolders, setSmartFolders] = useState<SmartFolder[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [missingCount, setMissingCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [relinkPlan, setRelinkPlan] = useState<PlanItem[] | null>(null);
  // 切换媒体库(v1.27)。一覧は version で取り直す —— 設定モーダルで
  // 名前を変えたときにボタンの表示を追従させるため(切り替え自体は再起動なので稀)
  const [libraries, setLibraries] = useState<LibraryEntry[]>([]);
  const [switching, setSwitching] = useState(false);
  const { menu, open: openMenu, openAt, close: closeMenu } = useContextMenu<MenuTarget>();
  // 媒体库タブの項目名で絞り込む(v1.19)。DB は引かず手元の配列を絞るだけなので
  // デバウンスは要らない。動画そのものの検索はツールバー側の担当
  const [sideFilter, setSideFilter] = useState('');
  /*
   * 畳んでいるセクション(v1.42)。項目が増えると左ペインが縦に伸びきるので節ごとに畳める。
   *
   * **localStorage ではなく settings に持つ**。TagTree の群组を localStorage に
   * 置いているのは中身が `tag_groups.id` で媒体库ごとに別物だからで、
   * こちらのキーは媒体库に依存しない固定文字列。`sidebar_tab` と同じ扱いにする
   */
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set());

  useEffect(() => {
    api.listWatchedFolders().then(setFolders);
    api.listTags().then(setTags);
    api.listTagGroups().then(setTagGroups);
    api.listSeries().then(setSeriesList);
    api.listSmartFolders().then(setSmartFolders);
    api.listPlaylists().then(setPlaylists);
    api.countVideos({}).then(setTotalCount);
    api.countVideos({ missing: true }).then(setMissingCount);
    api.countVideos({ duplicatesOnly: true }).then(setDuplicateCount);
  }, [version]);

  useEffect(() => {
    api.listLibraries().then(setLibraries);
  }, [version]);

  // 前回開いていたタブを復元する(view_mode / card_width と同じく settings に持つ)
  useEffect(() => {
    api.getSetting('sidebar_tab').then((v) => {
      if (v === 'folders' || v === 'library') setTab(v);
    });
  }, []);

  /**
   * ツリーは全動画のパスを 1 回読んで組み立てるので、
   * 「文件夹」タブを開いているときだけ取りに行く
   */
  useEffect(() => {
    if (tab !== 'folders') return;
    api.listFolderTree().then(setFolderTree);
  }, [tab, version]);

  // 畳んでいた節を復元する(sidebar_tab と同じくここで読む)
  useEffect(() => {
    api.getSetting('sidebar_sections').then((v) => setCollapsed(parseCollapsedSections(v)));
  }, []);

  const selectTab = (next: SidebarTab) => {
    setTab(next);
    api.setSetting('sidebar_tab', next);
  };

  /** 畳み状態の唯一の書き込み口。state と設定を必ず一緒に動かす */
  const saveCollapsed = (next: Set<SectionKey>) => {
    setCollapsed(next);
    api.setSetting('sidebar_sections', serializeCollapsedSections(next));
  };

  const toggleSection = (key: SectionKey) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    saveCollapsed(next);
  };

  /**
   * 保存した検索条个復元する。壊れた JSON は握り潰さずトーストで知らせる。
   *
   * **項目をここで並べないこと**。以前は手で書き写していたため尺の範囲が抜けており、
   * 保存して開き直すと时长の条件だけ静かに消えていた。
   * 変換は `toFilterState`(= `buildQuery` の逆)に一本化してある
   */
  const openSmartFolder = (sf: SmartFolder) => {
    let q: VideoQuery;
    try {
      q = JSON.parse(sf.queryJson);
    } catch {
      pushToast(`「${sf.name}」的搜索条件读取失败`);
      return;
    }
    applyFilter(toFilterState(q));
  };

  /**
   * 文件夹ごと動かした動画の再リンク。
   * 変更前は文字入力(消えた文件夹はダイアログで選べない)、変更後は文件夹選択にする
   */
  const startRelink = async () => {
    const fromPrefix = window.prompt(
      '请输入变更前的文件夹路径\n（以此路径开头的视频将作为处理对象）',
      '',
    );
    if (fromPrefix === null || fromPrefix.trim() === '') return;
    const dest = await open({ directory: true, multiple: false, title: '变更后的文件夹' });
    if (typeof dest !== 'string') return;
    const plan = await api.planRelink(fromPrefix.trim(), dest);
    if (plan.length === 0) {
      pushToast('没有以该路径开头的视频', 'info');
      return;
    }
    setRelinkPlan(plan);
  };

  const removeSmartFolder = async (sf: SmartFolder) => {
    const yes = await ask(`要删除智能文件夹「${sf.name}」吗？\n（视频不会被删除）`, {
      title: '删除智能文件夹',
    });
    if (!yes) return;
    await api.deleteSmartFolder(sf.id);
    bumpVersion();
  };

  /**
   * 保存リストを队列へ**複写**して再生を始める(v1.40)。
   * 複写なので、ここから先の編集は保存リストに一切届かない
   * (書き戻すのは「覆盖保存」を押したときだけ)。
   * 確認(A-29)·上限·再生開始は replaceQueueWith(v1.41 で C-4 と共通化)の担当
   */
  const loadPlaylist = async (p: Playlist) => {
    try {
      const rows = await api.getPlaylistVideos(p.id);
      await replaceQueueWith(rows, { id: p.id, name: p.name }, {
        label: `「${p.name}」`,
        emptyMessage: `「${p.name}」为空`,
      });
    } catch {
      // トーストは call() の担当
    }
  };

  /**
   * 智能文件夹の中身で替换队列并播放する(v1.41、C-4)。
   * 「平日の消化リスト」のような条个 1 点击で流すための入口
   */
  const loadSmartFolder = async (sf: SmartFolder) => {
    let q: VideoQuery;
    try {
      q = JSON.parse(sf.queryJson);
    } catch {
      pushToast(`「${sf.name}」的搜索条件读取失败`);
      return;
    }
    try {
      // 上限 + 1 件引く。501 件返れば「切り詰めた」と分かる(件数クエリを別に投げない)
      const rows = await api.queryVideos(q, QUEUE_LIMIT + 1, 0);
      await replaceQueueWith(rows, null, {
        label: `「${sf.name}」`,
        emptyMessage: `「${sf.name}」匹配的视频不存在`,
      });
    } catch {
      // トーストは call() の担当
    }
  };

  /** 播放列表を M3U8 に書き出す(v1.41、C-3)。外部プレイヤーでそのまま流せる */
  const exportPlaylist = async (p: Playlist) => {
    const dest = await save({
      title: '导出为 M3U8',
      // リスト名は文件名に使えない文字を含み得るので、そこだけ置き換える
      defaultPath: `${p.name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`,
      filters: [{ name: 'M3U8 播放列表', extensions: ['m3u8'] }],
    });
    if (typeof dest !== 'string') return;
    try {
      const n = await api.exportM3u8(p.id, dest);
      pushToast(`「${p.name}」已导出（${n} 件)`, 'info');
    } catch {
      // トーストは call() の担当
    }
  };

  /**
   * M3U8 を読み込んで播放列表を作る(v1.41、C-3)。
   * 未登録の動画は個別登録として媒体库にも入る(取り込みは Rust 側)
   */
  const importM3u8 = async () => {
    const selected = await open({
      multiple: false,
      title: '读取 M3U8',
      filters: [{ name: 'M3U8 播放列表', extensions: ['m3u8', 'm3u'] }],
    });
    if (typeof selected !== 'string') return;
    try {
      const r = await api.importM3u8(selected);
      pushToast(
        r.skipped > 0
          ? `「${r.name}」已创建（${r.count} 件。${r.skipped} 行未找到，已移除）`
          : `「${r.name}」已创建（${r.count} 件)`,
        'info',
      );
      bumpVersion();
    } catch {
      // トーストは call() の担当
    }
  };

  const removePlaylist = async (p: Playlist) => {
    const yes = await ask(
      `要删除播放列表「${p.name}」吗？\n（视频本身不会被删除）`,
      { title: '删除播放列表' },
    );
    if (!yes) return;
    await api.deletePlaylist(p.id);
    if (playlistId === p.id) togglePlaylistFilter(p.id);
    // このリストから読み込んだ队列の出所を外す(残すと「覆盖保存」が必ず失敗する)
    const s = useLibrary.getState();
    s.setQueue(sourceRemoved(s.queue, p.id));
    bumpVersion();
  };

  const removeSeries = async (s: Series) => {
    const yes = await ask(
      `要删除系列「${s.name}」吗？\n（视频本身不会被删除）`,
      { title: '删除系列' },
    );
    if (!yes) return;
    await api.deleteSeries(s.id);
    if (seriesId === s.id) toggleSeriesFilter(s.id);
    bumpVersion();
  };

  const addFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: '添加监视文件夹' });
    if (typeof selected === 'string') {
      await api.addWatchedFolder(selected);
      bumpVersion();
    }
  };

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      title: '添加视频文件',
      filters: [{ name: '视频', extensions: VIDEO_EXTENSIONS }],
    });
    if (Array.isArray(selected) && selected.length > 0) {
      await api.registerFiles(selected);
      bumpVersion();
    }
  };

  const removeFolder = async (f: WatchedFolder) => {
    const yes = await ask(`「${f.path}」从监视对象中移除吗？`, { title: '取消监视文件夹' });
    if (!yes) return;
    let removeVideos = false;
    if (f.videoCount > 0) {
      removeVideos = await ask(
        `要同时从媒体库删除来自该文件夹的 ${f.videoCount} 个视频吗？\n（否 = 保留为逐个登记。文件本身不会被删除）`,
        { title: '注册处理方式' },
      );
    }
    await api.removeWatchedFolder(f.id, removeVideos);
    if (folderId === f.id) setFolderId(null);
    bumpVersion();
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      pushToast('已复制路径', 'info');
    } catch {
      pushToast('无法复制到剪贴板');
    }
  };

  const reveal = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch {
      pushToast('无法在资源管理器中显示');
    }
  };

  /**
   * 排列は 1 つ隣と入れ替えるだけ。**絞り込む前の配列**を渡すこと —
   * 見えている行の index で動かすと、隠れている行を飛び越して並びが壊れる
   * (メニュー側でも筛选中は無効にしてある)
   */
  const moveSmartFolder = async (index: number, dir: -1 | 1) => {
    const next = [...smartFolders];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    try {
      await api.reorderSmartFolders(next.map((sf) => sf.id));
      bumpVersion();
    } catch {
      // トーストは call() の担当
    }
  };

  /** 播放列表の排列。moveSmartFolder と同じ流儀(絞り込む前の index で動かす) */
  const movePlaylist = async (index: number, dir: -1 | 1) => {
    const next = [...playlists];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    try {
      await api.reorderPlaylists(next.map((p) => p.id));
      bumpVersion();
    } catch {
      // トーストは call() の担当
    }
  };

  /**
   * 媒体库を切り替える(v1.27)。**成功するとアプリが再起動する**ので、
   * この呼び出しの後ろに処理を書かないこと(Promise は解決しない)。
   * 再生中なら先に止める —— mpv は透過ウィンドウを別に持っているので、
   * 再生したままプロセスを差し替えない
   */
  const switchLibrary = async (lib: LibraryEntry) => {
    if (lib.id === currentLibId) return;
    if (!lib.online) {
      pushToast(`「${lib.name}」无法连接（${lib.root})`);
      return;
    }
    /*
     * v1.40 まではここで「队列が失われます」の確認を挟んでいたが、v1.41 の
     * 常時自動保存(C-2)で不要になった —— 队列はこの媒体库の library.db に
     * 保存済みで、戻ってくればそのまま復元される
     */
    const yes = await ask(`「${lib.name}」切换。要重启应用吗？`, {
      title: '切换媒体库',
    });
    if (!yes) return;
    setSwitching(true);
    useLibrary.getState().setPlayingVideo(null);
    try {
      await api.switchLibrary(lib.id);
    } catch {
      // ここに戻ってくるのは失敗したときだけ(トーストは call() の担当)
      setSwitching(false);
    }
  };

  /** 新規作成 → 置き場所を選ぶ → 空の媒体库を作る → 続けて切り替えるか聞く */
  const createLibrary = async () => {
    const name = window.prompt('新媒体库名称');
    if (name === null || name.trim() === '') return;
    // 既定はアプリのデータ文件夹配下。外付け HDD を選べばドライブごと持ち運べる
    const parent = await open({
      directory: true,
      defaultPath: await api.defaultLibraryDir(),
      title: '选择存放媒体库的文件夹',
    });
    if (typeof parent !== 'string') return;
    const lib = await api.createLibrary(name.trim(), parent);
    setLibraries(await api.listLibraries());
    await switchLibrary(lib);
  };

  /** 既存の媒体库文件夹を一覧に加える(外付け HDD を別の PC に挿したとき等) */
  const addExistingLibrary = async () => {
    const root = await open({ directory: true, title: '选择媒体库文件夹' });
    if (typeof root !== 'string') return;
    const lib = await api.addExistingLibrary(root);
    setLibraries(await api.listLibraries());
    await switchLibrary(lib);
  };

  /** 右键菜单の実行(v1.20)。削除系は × ボタンと同じ関数を呼ぶ */
  const runMenuAction = async (id: string, target: MenuTarget) => {
    try {
      if (target.kind === 'library') {
        if (id === 'lib:create') return await createLibrary();
        if (id === 'lib:add') return await addExistingLibrary();
        const lib = libraries.find((l) => `lib:switch:${l.id}` === id);
        if (lib) await switchLibrary(lib);
        return;
      }

      if (target.kind === 'section') {
        switch (id) {
          case 'section:toggle': toggleSection(target.section); break;
          case 'section:collapseAll': saveCollapsed(new Set(SECTION_KEYS)); break;
          case 'section:expandAll': saveCollapsed(new Set()); break;
          default:
        }
        return;
      }

      if (target.kind === 'wf') {
        const f = target.folder;
        switch (id) {
          case 'wf:open': setFolderId(f.id); break;
          // 配下全部ではなく直下だけ。文件夹ツリー側の筛选に切り替わる
          case 'wf:openDirect': useLibrary.getState().toggleDirPath(f.path); break;
          case 'wf:reveal': await reveal(f.path); break;
          case 'wf:copyPath': await copyPath(f.path); break;
          case 'wf:remove': await removeFolder(f); break;
          default:
        }
        return;
      }

      if (target.kind === 'sf') {
        const sf = target.sf;
        const index = smartFolders.findIndex((x) => x.id === sf.id);
        switch (id) {
          case 'sf:open': openSmartFolder(sf); break;
          case 'sf:load': await loadSmartFolder(sf); break;
          case 'sf:rename': {
            const name = window.prompt('新名称', sf.name);
            if (name === null || name.trim() === '' || name.trim() === sf.name) return;
            await api.updateSmartFolder(sf.id, name.trim());
            bumpVersion();
            break;
          }
          case 'sf:overwrite': {
            const yes = await ask(
              `「${sf.name}」的条件替换为当前筛选条件吗？`,
              { title: '覆盖智能文件夹' },
            );
            if (!yes) return;
            await api.updateSmartFolder(sf.id, undefined, currentQuery());
            bumpVersion();
            break;
          }
          case 'sf:moveUp': await moveSmartFolder(index, -1); break;
          case 'sf:moveDown': await moveSmartFolder(index, 1); break;
          case 'sf:delete': await removeSmartFolder(sf); break;
          default:
        }
        return;
      }

      if (target.kind === 'playlist') {
        const p = target.playlist;
        const index = playlists.findIndex((x) => x.id === p.id);
        switch (id) {
          case 'pl:load': await loadPlaylist(p); break;
          case 'pl:filter': togglePlaylistFilter(p.id); break;
          case 'pl:rename': {
            const name = window.prompt('新播放列表名称', p.name);
            if (name === null || name.trim() === '' || name.trim() === p.name) return;
            await api.renamePlaylist(p.id, name.trim());
            // このリストから読み込んだ队列の标题も追随させる
            const s = useLibrary.getState();
            s.setQueue(sourceRenamed(s.queue, p.id, name.trim()));
            bumpVersion();
            break;
          }
          case 'pl:duplicate': await api.duplicatePlaylist(p.id).then(() => bumpVersion()); break;
          case 'pl:export': await exportPlaylist(p); break;
          case 'pl:moveUp': await movePlaylist(index, -1); break;
          case 'pl:moveDown': await movePlaylist(index, 1); break;
          case 'pl:delete': await removePlaylist(p); break;
          default:
        }
        return;
      }

      const s = target.series;
      switch (id) {
        case 'series:filter': toggleSeriesFilter(s.id); break;
        case 'series:rename': {
          const name = window.prompt('新系列名称', s.name);
          if (name === null || name.trim() === '' || name.trim() === s.name) return;
          await api.renameSeries(s.id, name.trim());
          bumpVersion();
          break;
        }
        case 'series:delete': await removeSeries(s); break;
        default:
      }
    } catch {
      // トーストは call() の担当
    }
  };

  // 媒体库タブの筛选。マッチしないセクションは見出しごと消える
  const needle = sideFilter.trim().toLowerCase();
  const hit = (s: string) => !needle || s.toLowerCase().includes(needle);
  const shownSmart = smartFolders.filter((sf) => hit(sf.name));
  const shownPlaylists = playlists.filter((p) => hit(p.name));
  const shownFolders = folders.filter((f) => hit(baseName(f.path)));
  const shownSeries = seriesList.filter((s) => hit(s.name));
  // 标签は分组名称でも引ける(「ジャンル」と打てばその群组の标签が全部出る)
  const shownTags = tags.filter(
    (t) => hit(t.name) || hit(t.groupName ?? '') || (t.groupId == null && hit('未分類')),
  );
  const currentLib = libraries.find((l) => l.id === currentLibId) ?? null;
  /*
   * セクション見出しに渡す共通の props(v1.42)。筛选中は畳みを無視して必ず打开 ——
   * TagTree の群组(`renderHeader` の `!filtering && collapsed.has(key)`)と同じ規約で、
   * 絞った結果が畳まれていては意味がないため
   */
  const sectionProps = (section: SectionKey, label: string, count: number) => ({
    label,
    count,
    collapsed: collapsed.has(section),
    filtering: needle !== '',
    onToggle: () => toggleSection(section),
    onContextMenu: (e: React.MouseEvent) =>
      openMenu(e, buildSideSectionMenu(label, collapsed.has(section)), {
        kind: 'section' as const, section, label,
      }),
  });
  const nothingMatches =
    needle !== '' &&
    shownSmart.length === 0 &&
    shownPlaylists.length === 0 &&
    shownFolders.length === 0 &&
    shownSeries.length === 0 &&
    shownTags.length === 0;

  return (
    // 幅はドラッグで変えられる。min-width も同じ値にして flex に縮められないようにする
    <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      {/*
        v1.27。ここは v1.26 まで「DVM」の固定文字列だった。
        切り替えの入口はここだけ(名前の変更と一覧からの削除は設定モーダルの担当)
      */}
      <button
        className="sidebar-title library-switch"
        disabled={switching}
        title={currentLib ? `${currentLib.root}\n单击切换媒体库` : 'DVM'}
        onClick={(e) => {
          // 点击位置ではなくボタンの真下に出す(押す場所で位置がずれない)
          const r = e.currentTarget.getBoundingClientRect();
          openAt(r.left, r.bottom + 2, buildLibraryMenu(libraries, currentLibId), {
            kind: 'library',
          });
        }}
      >
        <Library />
        <span className="library-name">
          {switching ? '正在切换...' : (currentLib?.name ?? 'DVM')}
        </span>
        <ChevronDown className="library-caret" />
      </button>
      <button
        className={`side-item ${folderId === null && dirPath === null && !missingOnly ? 'active' : ''}`}
        onClick={() => {
          if (missingOnly) toggleMissingOnly();
          // setFolderId は dirPath(文件夹ツリーの筛选)も一緒に外す
          setFolderId(null);
        }}
      >
        全部视频 <span className="count">{totalCount}</span>
      </button>
      {missingCount > 0 && (
        <button
          className={`side-item warn ${missingOnly ? 'active' : ''}`}
          onClick={toggleMissingOnly}
          title="仅显示找不到文件的视频（可通过重新链接路径或从媒体库删除来清理）"
        >
          <TriangleAlert />
          找不到 <span className="count">{missingCount}</span>
        </button>
      )}
      {missingOnly && (
        <button className="side-action" onClick={startRelink}>
          重新链接路径...
        </button>
      )}
      {duplicateCount > 0 && (
        <button
          className={`side-item ${duplicatesOnly ? 'active' : ''}`}
          onClick={toggleDuplicatesOnly}
          title="仅显示内容相同的视频（大小与首部哈希一致）。相同项会相邻排列"
        >
          <Copy />
          重複 <span className="count">{duplicateCount}</span>
        </button>
      )}

      {/* ここから下だけをタブで入れ替える。上の 3 行はどちらのタブでも解除できるように残す */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${tab === 'library' ? 'active' : ''}`}
          onClick={() => selectTab('library')}
          title="智能文件夹·监视文件夹·系列·标签"
        >
          媒体库
        </button>
        <button
          className={`sidebar-tab ${tab === 'folders' ? 'active' : ''}`}
          onClick={() => selectTab('folders')}
          title="按文件夹层级筛选（仅显示该文件夹直属视频）"
        >
          文件夹
        </button>
      </div>

      {tab === 'folders' && <FolderTree nodes={folderTree} />}

      {tab === 'library' && (
        <>
          <input
            className="side-filter"
            type="search"
            placeholder="筛选标签·系列"
            title="按侧边栏项目名筛选（搜索视频本身请用上方搜索框）"
            value={sideFilter}
            onChange={(e) => setSideFilter(e.target.value)}
          />

          {shownSmart.length > 0 && (
            <SideSection {...sectionProps('smart', '智能文件夹', smartFolders.length)}>
              {shownSmart.map((sf) => (
                <div
                  key={sf.id}
                  className="side-item folder"
                  onClick={() => openSmartFolder(sf)}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      // 排列の index は絞り込む前の並びで数える
                      buildSmartFolderMenu(
                        sf,
                        smartFolders.findIndex((x) => x.id === sf.id),
                        smartFolders.length,
                        needle !== '',
                      ),
                      { kind: 'sf', sf },
                    )}
                  title={`${sf.name}（恢复已保存的搜索条件）`}
                >
                  <FolderSearch className="tag-mark" />
                  <span className="folder-name">{sf.name}</span>
                  <button
                    className="remove"
                    title="删除智能文件夹"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSmartFolder(sf);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </SideSection>
          )}

          {/*
            保存播放列表(v1.40)。**智能文件夹の直後**に置く ——
            智能文件夹 = 条件で選んだ集合、播放列表 = 手で選んだ集合で、
            並べるなら隣同士が意味的に正しい。
            点击は既存 2 つと揃えて「一覧を絞り込む」。队列への読み込みは右点击から。
            **0 件でも見出し + 案内を出す**(标签と同じ「ここから始める」流儀)——
            機能に気づく入口が右键菜单と Q キーだけで、棚が空の人ほど見えなかった
          */}
          {(shownPlaylists.length > 0 || !needle) && (
            <SideSection {...sectionProps('playlist', '播放列表', playlists.length)}>
              {playlists.length === 0 && !needle && (
                <div className="side-empty">
                  选中视频后右键 →「队列」排列，再从队列面板保存后就会显示在这里
                </div>
              )}
              {shownPlaylists.map((p) => (
                <div
                  key={p.id}
                  className={`side-item playlist-row ${playlistId === p.id ? 'active' : ''}`}
                  onClick={() => togglePlaylistFilter(p.id)}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      // 排列の index は絞り込む前の並びで数える(智能文件夹と同じ)
                      buildPlaylistMenu(
                        p,
                        playlistId === p.id,
                        playlists.findIndex((x) => x.id === p.id),
                        playlists.length,
                        needle !== '',
                      ),
                      { kind: 'playlist', playlist: p },
                    )}
                  title={`${p.name}（点击筛选。右键可读取到队列）`}
                >
                  {/*
                    先頭缩略图 + 2 行(v1.41、C-6)。队列行と同じ 44×25 の枠で、
                    **ディスクキャッシュの jpg を読むだけ**(原則 2 の内側)。
                    缩略图を持つ動画が 1 本も無ければ枠の地色だけが見える
                  */}
                  <span className="pl-thumb">
                    {p.thumbPath && (
                      <img
                        src={thumbSrc(convertFileSrc(p.thumbPath), thumbVersion)}
                        loading="lazy"
                        alt=""
                        draggable={false}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                        onLoad={(e) => {
                          e.currentTarget.style.display = '';
                        }}
                      />
                    )}
                  </span>
                  <span className="pl-lines">
                    <span className="folder-name">{p.name}</span>
                    <span className="pl-meta">
                      {p.videoCount} 本
                      {p.durationMs > 0 ? `·${fmtTime(p.durationMs / 1000)}` : ''}
                    </span>
                  </span>
                  <button
                    className="remove"
                    title="删除播放列表"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePlaylist(p);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {/* M3U8 の取り込み(v1.41、C-3)。筛选中は追加ボタン隐藏(下の 2 つと同じ) */}
              {!needle && (
                <button
                  className="side-action"
                  title="读取 M3U8 / M3U 并创建同名播放列表（未登记的视频也会一并登记到媒体库）"
                  onClick={importM3u8}
                >
                  + 读取 M3U8
                </button>
              )}
            </SideSection>
          )}

          {(shownFolders.length > 0 || !needle) && (
            <SideSection {...sectionProps('watched', '监视文件夹', folders.length)}>
              {shownFolders.map((f) => (
                <div
                  key={f.id}
                  className={`side-item folder ${folderId === f.id ? 'active' : ''}`}
                  onClick={() => setFolderId(f.id)}
                  onContextMenu={(e) =>
                    openMenu(e, buildWatchedFolderMenu(f, folderId === f.id), {
                      kind: 'wf', folder: f,
                    })}
                  title={`${f.path}\n单击显示该文件夹下的全部（若要按子文件夹筛选，请用「文件夹」标签页）`}
                >
                  <span className={`dot ${f.online ? 'online' : 'offline'}`} />
                  <span className="folder-name">{baseName(f.path)}</span>
                  <span className="count">{f.videoCount}</span>
                  <button
                    className="remove"
                    title="从监控对象中移除"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFolder(f);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}

              {/* 筛选中は追加ボタン隐藏 — 探している最中に出ていても邪魔なだけ */}
              {!needle && (
                <>
                  <button className="side-action" onClick={addFolder}>+ 添加文件夹</button>
                  <button className="side-action" onClick={addFiles}>+ 添加文件</button>
                </>
              )}
            </SideSection>
          )}

          {shownSeries.length > 0 && (
            <SideSection {...sectionProps('series', '系列', seriesList.length)}>
              {shownSeries.map((s) => (
                <div
                  key={s.id}
                  className={`side-item folder ${seriesId === s.id ? 'active' : ''}`}
                  onClick={() => toggleSeriesFilter(s.id)}
                  onContextMenu={(e) =>
                    openMenu(e, buildSeriesMenu(s, seriesId === s.id), {
                      kind: 'series', series: s,
                    })}
                  title={`${s.name}（点击筛选。系列内按登记顺序显示）`}
                >
                  <ListOrdered className="tag-mark" />
                  <span className="folder-name">{s.name}</span>
                  <span className="count">{s.videoCount}</span>
                  <button
                    className="remove"
                    title="删除系列"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSeries(s);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </SideSection>
          )}

          {/* 标签が 0 個でも見出しを出す — ここから作成を始めるため。
              ただし筛选中にヒットが無いなら消す(TagTree 側も全部 null を返す) */}
          {(shownTags.length > 0 || !needle) && (
            <SideSection {...sectionProps('tag', '标签', tags.length)}>
              <TagTree tags={shownTags} groups={tagGroups} filtering={needle !== ''} />
            </SideSection>
          )}

          {nothingMatches && (
            <div className="side-empty">没有与「{sideFilter.trim()}」匹配的项目</div>
          )}
        </>
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

      {relinkPlan && (
        <FileOpDialog kind="relink" plan={relinkPlan} onClose={() => setRelinkPlan(null)} />
      )}
    </aside>
  );
}
