import { Fragment, useEffect, useRef, useState } from 'react';
import { useFilterMasters } from '../hooks/useFilterMasters';
import { dedupeMessage } from '../lib/dedupeMessage';
import { describeFilter, type ClearAction } from '../lib/filterChips';
import type { FilterState } from '../lib/query';
import { useShallow } from 'zustand/react/shallow';
import { pickState, useLibrary } from '../store';
import { EMPTY_ADVANCED, type AdvancedFilter } from '../types';
import { DedupeDialog } from './DedupeDialog';

/**
 * 筛选帯(v1.28)。ツールバーと一覧の間に常駐する 1 行。
 *
 * 狙いは 2 つ。
 * 1. **标签の OR / AND を目で分かるようにする**。同じ箱の中は「 或 」、箱と箱は「并且」。
 *    箱の分け方は Rust 側の軸(core/query.rs)と同じ規則(lib/filterChips.ts)
 * 2. **いまの条个何件マッチしているかを出す**。件数は VideoGrid が使っているものを
 *    そのまま受け取る —— ここで数え直すと count_videos が 2 回走り、
 *    しかも帯とグリッドで数字が食い違う瞬間ができる
 *
 * 条件が無くても消さない。出し入れするとツールバーと一覧の間が 32px 伸縮して
 * グリッドが上下に跳ねるため(件数を常に見せたいという理由もある)
 */
export function FilterBar({
  filters, total, counted,
}: {
  /** VideoGrid が buildQuery に渡したものと同じ筛选一式 */
  filters: FilterState;
  total: number;
  /** 一度でも数え終わったか。false の間は 0 を「0 件」と読ませない */
  counted: boolean;
}) {
  const {
    setText, setAdvanced, toggleTagFilter, setTagFilter, setFolderId, toggleDirPath,
    toggleSeriesFilter, togglePlaylistFilter, toggleMissingOnly, toggleDirPathRecursive,
    toggleDuplicatesOnly, applyFilter, version, bumpVersion, pushToast,
  } = useLibrary(useShallow(pickState(
    'setText', 'setAdvanced', 'toggleTagFilter', 'setTagFilter', 'setFolderId', 'toggleDirPath',
    'toggleSeriesFilter', 'togglePlaylistFilter', 'toggleMissingOnly', 'toggleDirPathRecursive',
    'toggleDuplicatesOnly', 'applyFilter', 'version', 'bumpVersion', 'pushToast',
  )));
  const [showDedupe, setShowDedupe] = useState(false);

  // 名前を引かないと出せない条件が効いているときだけマスタを取りに行く
  const needsMasters =
    filters.tagIds.length > 0 || filters.folderId !== null || filters.seriesId !== null ||
    filters.playlistId !== null;
  const masters = useFilterMasters(needsMasters, version);
  const terms = describeFilter(filters, masters);

  /*
   * 縦ホイールで横へ流す。何もしないと、縦に動けないこの帯を wheel が素通りして
   * 後ろのグリッドがスクロールしてしまう(実機で確認済み)。
   * React の onWheel は passive で登録されるため preventDefault が効かない。
   * だから直接 addEventListener する
   */
  const termsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = termsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /*
   * 右端のフェードは**本当に溢れているときだけ**出す。出しっぱなしにすると、
   * 端に来ただけのチップが薄くなって「まだ続きがある」と誤解させる。
   * 幅(窓のリ大小)とチップの中身の両方で測り直す
   */
  const [overflowing, setOverflowing] = useState(false);
  const shape = terms.map((t) => t.chips.map((c) => c.label).join()).join('|');
  useEffect(() => {
    const el = termsRef.current;
    if (!el) return;
    const update = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shape]);

  /**
   * チップの × を押したときの振り分け。ClearAction の種類はここで出し切る。
   * **詳細検索の項目が増えてもこの switch は増えない** —— 既定値は EMPTY_ADVANCED から引き、
   * 範囲と複数選択はキーを持ち回る形にしてある
   */
  const clear = (action: ClearAction) => {
    switch (action.type) {
      case 'text': setText(''); break;
      case 'tag': toggleTagFilter(action.tagId); break;
      case 'tagAxis':
        setTagFilter(filters.tagIds.filter((id) => !action.tagIds.includes(id)));
        break;
      case 'folder': setFolderId(null); break;
      case 'dirPath': toggleDirPath(null); break;
      case 'series':
        if (filters.seriesId !== null) toggleSeriesFilter(filters.seriesId);
        break;
      case 'playlist':
        if (filters.playlistId !== null) togglePlaylistFilter(filters.playlistId);
        break;
      case 'missing': toggleMissingOnly(); break;
      case 'duplicates': toggleDuplicatesOnly(); break;
      case 'advanced':
        setAdvanced({ [action.key]: EMPTY_ADVANCED[action.key] } as Partial<AdvancedFilter>);
        break;
      case 'advancedRange':
        setAdvanced(Object.fromEntries(
          action.keys.map((k) => [k, EMPTY_ADVANCED[k]]),
        ) as Partial<AdvancedFilter>);
        break;
      case 'listItem':
        setAdvanced({
          [action.key]: filters.advanced[action.key].filter((v) => v !== action.value),
        } as Partial<AdvancedFilter>);
        break;
    }
  };

  return (
    <div className="filterbar">
      <div className={`fb-terms${overflowing ? ' overflowing' : ''}`} ref={termsRef}>
        {terms.length === 0 && <span className="fb-empty">无筛选</span>}
        {terms.map((term, i) => (
          <Fragment key={term.key}>
            {i > 0 && <span className="fb-join">并且</span>}
            {/* 箱の枠は 2 つ以上のとき(= 実際に「 或 」が起きているとき)だけ付ける */}
            <span className={`fb-term${term.chips.length > 1 ? ' or' : ''}`}>
              {term.caption !== null && (
                <span className="fb-caption">
                  {term.caption}
                  {/*
                    箱ごと外す × は**見出しの隣**に置く。チップの右端に置くと
                    直前のチップの × と並んでどちらを消すのか分からなくなる
                  */}
                  {term.clearAll !== null && (
                    <button
                      className="fb-term-clear"
                      title={`「${term.caption}」的条件一并移除`}
                      onClick={() => clear(term.clearAll!)}
                    >
                      ×
                    </button>
                  )}
                </span>
              )}
              {term.chips.map((chip, j) => (
                <Fragment key={chip.key}>
                  {j > 0 && <span className="fb-or"> 或 </span>}
                  <span
                    className={`chip${chip.unresolved ? ' unresolved' : ''}`}
                    // 色付き标签は枠と文字色で示す(Inspector と同じ作法)
                    style={chip.color ? { borderColor: chip.color, color: chip.color } : undefined}
                    title={chip.unresolved ? '名称读取中，或该项已被删除' : chip.label}
                  >
                    {chip.label}
                    <button title="移除此条件" onClick={() => clear(chip.clear)}>×</button>
                  </span>
                </Fragment>
              ))}
            </span>
          </Fragment>
        ))}
      </div>

      <span className="fb-count">
        {counted
          ? <>{terms.length > 0 ? '' : '全 '}<b>{total.toLocaleString()}</b> 件</>
          : '统计中…'}
      </span>
      {/*
        文件夹で絞っているときだけ出すトグル(v1.35)。ここに置くのは
        「いま出ている一覧の範囲を変える」操作で、対象が目の前にあると分かるから
        (ツールバーに置くと畳み込みの幅計算に条件付きの項目が混ざる)。
        潜っても効き続けるので「この下ぜんぶを見ながら歩く」ができる
      */}
      {filters.dirPath !== null && (
        <button
          className={`fb-toggle${filters.dirPathRecursive ? ' on' : ''}`}
          title={
            filters.dirPathRecursive
              ? '不再包含子文件夹（仅限此文件夹直属）'
              : '将子文件夹中的视频也加入列表'
          }
          onClick={toggleDirPathRecursive}
        >
          包含子文件夹
        </button>
      )}
      {/*
        重複を見ているときだけ出す作業ボタン(v1.33)。ツールバーではなくここに置くのは、
        「いま画面に出ている重複」が対象だと分かる場所だから。
        文件夹で絞り込んでいれば、その文件夹配下だけが対象になる
      */}
      {filters.duplicatesOnly && (
        <button
          className="fb-dedupe"
          title={
            filters.dirPath !== null
              ? `${filters.dirPath} 的范围内，内容相同的视频只保留 1 个（不删除文件）`
              : '在整个媒体库中，内容相同的视频只保留 1 个（不删除文件）'
          }
          onClick={() => setShowDedupe(true)}
        >
          消除重复
        </button>
      )}
      {terms.length > 0 && (
        <button
          className="fb-clear"
          title="清除全部筛选条件（排序保持不变）"
          onClick={() => applyFilter({})}
        >
          全部清除
        </button>
      )}

      {showDedupe && (
        <DedupeDialog
          scope={filters.dirPath ?? undefined}
          onClose={() => setShowDedupe(false)}
          onDone={(result, trashed) => {
            setShowDedupe(false);
            bumpVersion();
            pushToast(dedupeMessage(result, trashed), result.failed > 0 ? 'error' : 'info');
          }}
        />
      )}
    </div>
  );
}
