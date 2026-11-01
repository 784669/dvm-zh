import {
  BookmarkPlus,
  ChartColumn,
  Check,
  Funnel,
  Keyboard,
  LayoutGrid,
  List,
  PanelLeft,
  PanelRight,
  Redo2,
  RefreshCw,
  RotateCcwClock,
  Settings,
  Sparkles,
  Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { sortLabel, sortOptions } from '../lib/listColumns';
import { advancedCount, buildQuery } from '../lib/query';
import { splitToolbar, TOOLBAR_ITEMS, toolbarKeys } from '../lib/toolbarItems';
import type { ToolbarItemKey } from '../lib/toolbarItems';
import { useShallow } from 'zustand/react/shallow';
import { CARD_WIDTH_MAX, CARD_WIDTH_MIN, pickState, useLibrary } from '../store';
import type { SortKey } from '../types';
import { AdvancedSearch } from './AdvancedSearch';
import { HistoryModal } from './HistoryModal';
import { SettingsModal } from './SettingsModal';
import { ShortcutsModal } from './ShortcutsModal';
import { StatsModal } from './StatsModal';
import { ToolbarOverflow } from './ToolbarOverflow';

/** 部品をバーに置くか、≫ メニューの中に置くか */
type Place = 'bar' | 'menu';

export function Toolbar() {
  const {
    text, setText, sort, setSort, scanning, seriesId,
    showAiPanel, toggleAiPanel, advanced, duplicatesOnly,
    setShowStats, setShowShortcuts, bumpVersion, pushToast,
    viewMode, setViewMode, cardWidth, setCardWidth,
    inspectorPinned, setInspectorPinned, sidebarCollapsed, setSidebarCollapsed,
    filterPast, filterFuture, filterBack, filterForward,
  } = useLibrary(useShallow(pickState(
    'text', 'setText', 'sort', 'setSort', 'scanning', 'seriesId',
    'showAiPanel', 'toggleAiPanel', 'advanced', 'duplicatesOnly',
    'setShowStats', 'setShowShortcuts', 'bumpVersion', 'pushToast',
    'viewMode', 'setViewMode', 'cardWidth', 'setCardWidth',
    'inspectorPinned', 'setInspectorPinned', 'sidebarCollapsed', 'setSidebarCollapsed',
    'filterPast', 'filterFuture', 'filterBack', 'filterForward',
  )));
  const [input, setInput] = useState(text);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const advBtnRef = useRef<HTMLButtonElement>(null);
  const [advAt, setAdvAt] = useState({ x: 0, y: 0 });

  const barRef = useRef<HTMLDivElement>(null);
  /** ツールバーの内寸。測れるまでは null = 全項目を出す */
  const [avail, setAvail] = useState<number | null>(null);

  /*
   * 幅を測って、入りきらない項目を ≫ に畳む。
   *
   * useEffect ではなく useLayoutEffect なのは、初回に「全部出た姿」が 1 フレーム
   * 見えてしまうため(VideoGrid の列数計算は 1 フレームずれても目立たないので
   * あちらは useEffect のままでよい)。
   *
   * 初期値を null(= 全部出す)にしているのは、畳まれた姿から広がるより
   * 目に付きにくいから。「全部畳む」を初期値にすると起動時に必ずガタつく
   */
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => setAvail(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 幅が変わるとバーと ≫ の中身が入れ替わる。開いたまま項目が消えるのを防ぐ
  useEffect(() => {
    setMenuOpen(false);
  }, [avail]);

  // 打开たびにボタンの位置を測り直す。ポップオーバーは画面基準で描くため。
  // 幅が変わると検索欄が伸縮してボタンの x が動くので avail も見る
  useLayoutEffect(() => {
    if (!showAdvanced) return;
    const r = advBtnRef.current?.getBoundingClientRect();
    if (r) setAdvAt({ x: r.left, y: r.bottom + 6 });
  }, [showAdvanced, avail]);

  // 入力から 300ms 落ち着いたら検索を反映
  useEffect(() => {
    const t = setTimeout(() => setText(input), 300);
    return () => clearTimeout(t);
  }, [input, setText]);

  // AI の apply_filter や智能文件夹で text が外から変わったら入力欄も追従させる
  useEffect(() => {
    setInput((cur) => (cur === text ? cur : text));
  }, [text]);

  const advCount = advancedCount(advanced);
  const cardWidthPct =
    ((cardWidth - CARD_WIDTH_MIN) / (CARD_WIDTH_MAX - CARD_WIDTH_MIN)) * 100;

  const saveCurrentAsSmartFolder = async () => {
    const name = window.prompt('为当前搜索条件命名并保存');
    if (name === null) return;
    if (!name.trim()) {
      pushToast('请输入名称', 'info');
      return;
    }
    await api.createSmartFolder(name, buildQuery(useLibrary.getState()));
    bumpVersion();
  };

  /**
   * 1 項目を描く。**同じ項目の JSX を 2 か所に書かない** —— バーと ≫ メニューの
   * 違いは ToolButton / ToolSelect / ToolSlider の中だけに閉じ込める
   */
  const renderItem = (key: ToolbarItemKey, place: Place): ReactNode => {
    const { label } = TOOLBAR_ITEMS[key];
    /*
     * メニューの項目を押したら閉じてから実行する。「保存条件」の window.prompt は
     * 同期的にスレッドを止めるので、关闭描画を先に済ませないとメニューが
     * 出たままダイアログが打开(右键菜单と同じ理由)
     */
    const act = (fn: () => void) => () => {
      if (place !== 'menu') {
        fn();
        return;
      }
      setMenuOpen(false);
      window.setTimeout(fn, 0);
    };

    switch (key) {
      case 'sidebarToggle':
        /*
          侧边栏を畳むと幅を変える帯ごと消えるので、戻す手段はこのボタンだけ。
          侧边栏側に置くと畳んだあとに押せなくなる。だから畳まない項目にしてある
        */
        return (
          <ToolButton
            key={key}
            place={place}
            icon={PanelLeft}
            label={sidebarCollapsed ? '显示侧边栏' : '隐藏侧边栏'}
            onClick={act(() => {
              const next = !sidebarCollapsed;
              setSidebarCollapsed(next);
              void api.setSetting('sidebar_collapsed', next ? '1' : '0');
            })}
          />
        );

      case 'search':
        // 畳まないので place は必ず 'bar'
        return (
          <input
            key={key}
            className="search"
            type="search"
            // 狭いと切れるので短くし、説明は title に回す
            placeholder="搜索（空格分隔为 AND）"
            title="按文件名·标题搜索（空格分隔为 AND）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        );

      case 'advanced':
        /*
          畳まない。ポップオーバーを ≫ メニューの中から打开と、互いの
          「外側点击で关闭」が食い合って開いた瞬間に关闭。
          件数はアイコンの右上にバッジで重ねる(文字を並べる場所が無いため)
        */
        return (
          <button
            key={key}
            ref={advBtnRef}
            className={`tb-icon${advCount > 0 ? ' active' : ''}`}
            title={advCount > 0 ? `详细搜索(${advCount} 项条件）` : '详细搜索'}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Funnel />
            {advCount > 0 && <span className="tb-badge">{advCount}</span>}
          </button>
        );

      case 'filterBack':
        // 筛选履歴(v1.41、C-8)。押せるかどうかがそのまま「履歴があるか」
        return (
          <ToolButton
            key={key}
            place={place}
            icon={Undo2}
            label={label}
            title="后退筛选 (Alt+←)"
            disabled={filterPast.length === 0}
            onClick={act(filterBack)}
          />
        );

      case 'filterForward':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={Redo2}
            label={label}
            title="前进筛选 (Alt+→)"
            disabled={filterFuture.length === 0}
            onClick={act(filterForward)}
          />
        );

      case 'sort':
        /*
          排序はグリッドとリストで共有の 1 つ。详细列表の列ヘッダで選べる並びは
          26 種あり全部は並べられないので、ここは代表的なものだけを常設し、
          列ヘッダで選ばれた並びは「今それが選ばれている間だけ」項目を足して見せる
          (按系列顺序·重複まとめと同じ作法)
        */
        return (
          <ToolSelect
            key={key}
            place={place}
            label={label}
            className="sort-select"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
          >
            {/* 選択肢の組み立ては余白の右键菜单と共有する(片方だけ増えるのを防ぐ) */}
            {sortOptions({ sort, seriesId, duplicatesOnly }).map((k) => (
              <option key={k} value={k}>{sortLabel(k)}</option>
            ))}
          </ToolSelect>
        );

      case 'saveQuery':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={BookmarkPlus}
            label={label}
            title="将当前搜索条件保存为智能文件夹"
            onClick={act(() => void saveCurrentAsSmartFolder())}
          />
        );

      case 'viewMode':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={viewMode === 'grid' ? List : LayoutGrid}
            label={viewMode === 'grid' ? '详细列表视图' : '缩略图视图'}
            title={viewMode === 'grid' ? '切换为详细列表视图' : '切换为缩略图视图'}
            onClick={act(() => {
              const next = viewMode === 'grid' ? 'list' : 'grid';
              setViewMode(next);
              void api.setSetting('view_mode', next);
            })}
          />
        );

      case 'cardSize':
        return (
          <ToolSlider
            key={key}
            place={place}
            label={label}
            value={cardWidth}
            pct={cardWidthPct}
            onChange={setCardWidth}
            onCommit={() => void api.setSetting('card_width', String(cardWidth))}
          />
        );

      case 'rescan':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={RefreshCw}
            label={label}
            disabled={scanning}
            onClick={act(() => void api.rescanAll())}
          />
        );

      case 'stats':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={ChartColumn}
            label={label}
            onClick={act(() => setShowStats(true))}
          />
        );

      case 'history':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={RotateCcwClock}
            label={label}
            onClick={act(() => setShowHistory(true))}
          />
        );

      case 'inspectorPin':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={PanelRight}
            active={inspectorPinned}
            label="始终显示详情面板"
            title={
              inspectorPinned
                ? '解除详情面板固定（恢复为仅选中时显示）'
                : '始终显示详情面板'
            }
            onClick={act(() => {
              const next = !inspectorPinned;
              setInspectorPinned(next);
              void api.setSetting('inspector_pinned', next ? '1' : '0');
            })}
          />
        );

      case 'aiPanel':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={Sparkles}
            active={showAiPanel}
            label={label}
            onClick={act(toggleAiPanel)}
          />
        );

      case 'settings':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={Settings}
            label={label}
            onClick={act(() => setShowSettings(true))}
          />
        );

      case 'shortcuts':
        return (
          <ToolButton
            key={key}
            place={place}
            icon={Keyboard}
            label={label}
            // キーで開けることを、キーを知らない人に教える唯一の場所
            title="快捷键一览 (?)"
            onClick={act(() => setShowShortcuts(true))}
          />
        );
    }
  };

  const { bar, menu } = splitToolbar(toolbarKeys(viewMode), avail);
  /*
   * 并且てここには「畳んだ中に効いている筛选があれば ≫ を光らせる」判定があった。
   * v1.28 の筛选帯が★も时长も常にチップで出すようになったので、
   * 「件数が少ない理由が分からない」事故はそちらで防がれている。
   * 条个足すたびにこの式にも足す必要があり(足し忘れても静かに動く)、
   * 帯と二重に持つ意味が無くなったので消した
   */

  return (
    <div className="toolbar" ref={barRef}>
      {bar.map((key) => renderItem(key, 'bar'))}
      {menu.length > 0 && (
        <ToolbarOverflow open={menuOpen} onOpenChange={setMenuOpen}>
          {menu.map((key) => renderItem(key, 'menu'))}
        </ToolbarOverflow>
      )}

      {/*
        モーダルとポップオーバーは項目マップの外に置く。トリガーがバーにあっても
        ≫ の中にあっても、開いている間はレンダーされ続ける必要があるため
      */}
      {showAdvanced && <AdvancedSearch at={advAt} onClose={() => setShowAdvanced(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      <StatsModal />
      {/* 他のモーダルより後ろに書く —— .modal-overlay はどれも z-index 100 なので、
          設定を開いたまま出したときに DOM 順で前に来る必要がある */}
      <ShortcutsModal />
    </div>
  );
}

/**
 * バーではアイコンだけ、≫ メニューではアイコン + ラベル。
 * 押した状態はバーでは青塗り(.active)、メニューでは右端のチェック印で示す
 */
function ToolButton({
  place, label, title, icon: Icon, active, disabled, onClick,
}: {
  place: Place;
  /** メニューに出す短い見出し。長いと切れる */
  label: string;
  /** バーでのツールチップ。省くと label をそのまま使う */
  title?: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  if (place === 'menu') {
    return (
      <button className="tb-menu-item" disabled={disabled} onClick={onClick}>
        <Icon />
        <span className="tb-menu-label">{label}</span>
        {active && <Check className="tb-menu-mark" />}
      </button>
    );
  }
  return (
    <button
      className={`tb-icon${active ? ' active' : ''}`}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon />
    </button>
  );
}

/** メニューでは「ラベル : コントロール」の 1 行にする。裸の select だと何の select か分からない */
function ToolSelect({
  place, label, title, className, value, onChange, children,
}: {
  place: Place;
  label: string;
  title?: string;
  className: string;
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const select = (
    <select
      className={className}
      value={value}
      title={place === 'bar' ? (title ?? label) : undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
  if (place === 'bar') return select;
  return (
    <label className="tb-menu-row">
      <span className="tb-menu-label">{label}</span>
      {select}
    </label>
  );
}

/** 缩略图大小。グリッド表示のときだけ出る */
function ToolSlider({
  place, label, value, pct, onChange, onCommit,
}: {
  place: Place;
  label: string;
  value: number;
  /** 左側の塗りの割合。ネイティブの range は「ここまで塗る」を CSS だけでは表せない */
  pct: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const slider = (
    <input
      className="card-size"
      type="range"
      min={CARD_WIDTH_MIN}
      max={CARD_WIDTH_MAX}
      step={4}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      // ドラッグ中に毎回書き込まない(離したときだけ保存する)
      onPointerUp={onCommit}
      style={{ '--fill': `${pct}%` } as React.CSSProperties}
      title={place === 'bar' ? label : undefined}
    />
  );
  if (place === 'bar') return slider;
  return (
    <label className="tb-menu-row">
      <span className="tb-menu-label">{label}</span>
      {slider}
    </label>
  );
}
