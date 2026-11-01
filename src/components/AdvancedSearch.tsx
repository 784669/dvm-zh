import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  advancedCount, CODEC_OPTIONS, DURATION_LABELS, DURATION_RANGES, GB, MB,
  ORIENTATION_OPTIONS, RESOLUTION_MAX_OPTIONS, RESOLUTION_OPTIONS, sizeUnitFor,
  WITHIN_DAYS_OPTIONS,
} from '../lib/query';
import { useShallow } from 'zustand/react/shallow';
import { pickState, useLibrary } from '../store';
import type { AdvancedFilter, DurationBucket, ExtensionCount, Orientation } from '../types';

/** .adv-popover の幅(App.css と対)と、画面端に残す余白 */
const POPOVER_W = 640;
/** 1 カラムに落とす幅。これを下回ると 2 列が窮屈になる */
const ONE_COL_W = 340;
const EDGE = 8;
/** 上下に残す余白。ポップオーバーはこれを引いた高さで内部スクロールする */
const V_MARGIN = 16;

/** 1 分 (ms)。尺の入力は分で受ける */
const MIN = 60_000;

/**
 * ツールバーの「詳細検索」ポップオーバー(v1.35 で 2 カラムに拡張)。
 *
 * **筛选の入口はここ 1 つ**。v1.34 までツールバー本体にあった★と时长もここに移した
 * (理由は DESIGN.md「ツールバー」節)。頻繁に使う条件の組み合わせは
 * 智能文件夹に名前を付けて侧边栏に置くほうが速い。
 *
 * **位置はボタンの座標を受け取って画面基準(fixed)で決める**。ツールバーは
 * overflow: hidden なので、中に absolute で置くとそこで切られてしまう。
 * 列選択ポップオーバー·右键菜单と同じ扱い
 */
export function AdvancedSearch({
  at, onClose,
}: {
  at: { x: number; y: number };
  onClose: () => void;
}) {
  const { advanced, setAdvanced, clearAdvanced } = useLibrary(
    useShallow(pickState('advanced', 'setAdvanced', 'clearAdvanced')),
  );
  const ref = useRef<HTMLDivElement>(null);
  const [exts, setExts] = useState<ExtensionCount[] | null>(null);

  /*
   * 単位は**画面だけの状態**。条件として意味を持つのはバイト数だけなので保存しない。
   * 開いたときに今の値から決める(0.5GB は「512 MB」と出る。lib/query.ts の sizeUnitFor)
   */
  const [sizeUnit, setSizeUnit] = useState(
    () => sizeUnitFor(advanced.minSizeBytes, advanced.maxSizeBytes),
  );

  // 拡張子の候補は**開いたときに 1 回だけ**引く(全件走査なので原則 3 に沿って Rust 側)
  useEffect(() => {
    let alive = true;
    api.listExtensions().then((list) => { if (alive) setExts(list); });
    return () => { alive = false; };
  }, []);

  // 外側点击と Esc で关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // 点击で開いた直後の同じイベントで閉じないよう次のフレームから拾う
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  /*
   * 幅が足りなければ 1 カラムに落とす。窓を 460px 近くまで縮められる設計なので、
   * 640px 固定だと画面外にはみ出す(ツールバーの「残る限界」と同じ話)
   */
  const width = Math.min(POPOVER_W, window.innerWidth - EDGE * 2);
  const oneCol = width < POPOVER_W && width < ONE_COL_W * 1.6;
  const left = Math.max(EDGE, Math.min(at.x, window.innerWidth - width - EDGE));
  // 縦は画面に収める。溢れたぶんは中でスクロールする(标签パレットと同じ作法)
  const maxHeight = Math.max(200, window.innerHeight - at.y - V_MARGIN);

  const set = (patch: Partial<AdvancedFilter>) => setAdvanced(patch);
  /** 空欄は null(= 未指定)。0 に意味がある欄があるので 0 と空欄を混ぜない */
  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));
  /** ミリ秒 → 分の表示。端数は出さない(入力欄が分単位なので) */
  const toMin = (ms: number | null) => (ms === null ? '' : String(Math.round(ms / MIN)));
  /** バイト → 表示中の単位。割り切れないときだけ小数を見せる */
  const toUnit = (b: number | null) => {
    if (b === null) return '';
    const v = b / sizeUnit;
    return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
  };

  const toggleIn = (key: 'videoCodecs' | 'extensions', value: string) => {
    const cur = advanced[key];
    set({ [key]: cur.includes(value) ? cur.filter((c) => c !== value) : [...cur, value] });
  };

  /** 単位を変えたら、いま入っている値の**見た目の数字**を保つ(500 MB → 500 GB) */
  const changeUnit = (next: typeof MB | typeof GB) => {
    const keep = (b: number | null) => (b === null ? null : Math.round((b / sizeUnit) * next));
    set({ minSizeBytes: keep(advanced.minSizeBytes), maxSizeBytes: keep(advanced.maxSizeBytes) });
    setSizeUnit(next);
  };

  return (
    <div
      className={`adv-popover${oneCol ? ' one-col' : ''}`}
      ref={ref}
      style={{ left, top: at.y, width, maxHeight }}
    >
      <div className="adv-title">详细搜索</div>

      <div className="adv-cols">
        {/* ---- 左: 搜索方式 / 评分·观看 ---------------------------------- */}
        <div className="adv-col-box">
          <div className="adv-group">搜索方式</div>
          <label className="adv-check">
            <input
              type="checkbox"
              checked={advanced.searchPath}
              onChange={(e) => set({ searchPath: e.target.checked })}
            />
            将文件夹路径也纳入搜索范围
          </label>
          <label className="adv-check">
            <input
              type="checkbox"
              checked={advanced.searchComment}
              onChange={(e) => set({ searchComment: e.target.checked })}
            />
            将备注也纳入搜索范围
          </label>

          <div className="adv-group">评分·观看</div>
          <div className="adv-row">
            <span className="adv-label">评分</span>
            <select
              value={advanced.unrated ? 'none' : String(advanced.minRating)}
              onChange={(e) => {
                const v = e.target.value;
                // 无星级と「★N 以上」は同時に成り立たないので、セレクト 1 つで排他にする
                set(v === 'none'
                  ? { unrated: true, minRating: 0 }
                  : { unrated: false, minRating: Number(v) });
              }}
            >
              <option value="0">未指定</option>
              <option value="none">无星级(未评分)</option>
              <option value="1">★1 以上</option>
              <option value="2">★2 以上</option>
              <option value="3">★3 以上</option>
              <option value="4">★4 以上</option>
              <option value="5">★5</option>
            </select>
          </div>
          <label className="adv-check">
            <input
              type="checkbox"
              checked={advanced.untagged}
              onChange={(e) => set({ untagged: e.target.checked })}
            />
            仅限未添加标签的
          </label>
          <label className="adv-check">
            <input
              type="checkbox"
              checked={advanced.unwatched}
              onChange={(e) => set({ unwatched: e.target.checked })}
            />
            仅限尚未观看的
          </label>
          <label className="adv-check">
            <input
              type="checkbox"
              checked={advanced.resumedOnly}
              onChange={(e) => set({ resumedOnly: e.target.checked })}
            />
            仅限看到一半的
          </label>
          <div className="adv-row">
            <span className="adv-label">播放次数</span>
            <input
              type="number" min={0} className="adv-num"
              value={advanced.minViewCount ?? ''}
              onChange={(e) => set({ minViewCount: num(e.target.value) })}
            />
            <span className="adv-tilde">〜</span>
            <input
              type="number" min={0} className="adv-num"
              value={advanced.maxViewCount ?? ''}
              onChange={(e) => set({ maxViewCount: num(e.target.value) })}
            />
            <span className="adv-unit">回</span>
          </div>

          <div className="adv-group">时长</div>
          <div className="adv-row">
            <input
              type="number" min={0} className="adv-num"
              value={toMin(advanced.minDurationMs)}
              onChange={(e) => set({ minDurationMs: num(e.target.value) === null ? null : num(e.target.value)! * MIN })}
            />
            <span className="adv-tilde">〜</span>
            <input
              type="number" min={0} className="adv-num"
              value={toMin(advanced.maxDurationMs)}
              onChange={(e) => set({ maxDurationMs: num(e.target.value) === null ? null : num(e.target.value)! * MIN })}
            />
            <span className="adv-unit">分</span>
          </div>
          {/* プリセットは「その値を書き込むショートカット」。文言は帯のチップと共有 */}
          <div className="adv-chips">
            {(Object.keys(DURATION_LABELS) as DurationBucket[]).map((k) => {
              const r = DURATION_RANGES[k];
              const on = (r.min ?? null) === advanced.minDurationMs
                && (r.max ?? null) === advanced.maxDurationMs;
              return (
                <button
                  key={k}
                  type="button"
                  className={`adv-chip ${on ? 'on' : ''}`}
                  onClick={() => set(on
                    ? { minDurationMs: null, maxDurationMs: null }
                    : { minDurationMs: r.min ?? null, maxDurationMs: r.max ?? null })}
                >
                  {DURATION_LABELS[k]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- 右: 文件 / 日付 -------------------------------------- */}
        <div className="adv-col-box">
          <div className="adv-group">文件</div>
          <div className="adv-row">
            <span className="adv-label">大小</span>
            <input
              type="number" min={0} className="adv-num"
              value={toUnit(advanced.minSizeBytes)}
              onChange={(e) => set({ minSizeBytes: num(e.target.value) === null ? null : Math.round(num(e.target.value)! * sizeUnit) })}
            />
            <span className="adv-tilde">〜</span>
            <input
              type="number" min={0} className="adv-num"
              value={toUnit(advanced.maxSizeBytes)}
              onChange={(e) => set({ maxSizeBytes: num(e.target.value) === null ? null : Math.round(num(e.target.value)! * sizeUnit) })}
            />
            <select
              className="adv-unit-select"
              value={sizeUnit === GB ? 'GB' : 'MB'}
              onChange={(e) => changeUnit(e.target.value === 'GB' ? GB : MB)}
            >
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>

          <div className="adv-row adv-col">
            <span className="adv-label">扩展名</span>
            <div className="adv-chips">
              {exts === null && <span className="adv-hint">加载中…</span>}
              {exts?.length === 0 && <span className="adv-hint">没有视频</span>}
              {exts?.map((e) => (
                <button
                  key={e.ext}
                  type="button"
                  className={`adv-chip ${advanced.extensions.includes(e.ext) ? 'on' : ''}`}
                  title={`${e.count.toLocaleString()} 件`}
                  onClick={() => toggleIn('extensions', e.ext)}
                >
                  {e.ext} <span className="adv-chip-n">{e.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="adv-row">
            分辨率
            <select
              value={advanced.minHeight}
              onChange={(e) => set({ minHeight: Number(e.target.value) })}
            >
              {RESOLUTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={advanced.maxHeight}
              onChange={(e) => set({ maxHeight: Number(e.target.value) })}
            >
              {RESOLUTION_MAX_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="adv-row">
            <span className="adv-label">方向</span>
            <select
              value={advanced.orientation}
              onChange={(e) => set({ orientation: e.target.value as Orientation })}
            >
              {ORIENTATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="adv-row adv-col">
            <span className="adv-label">编解码器</span>
            <div className="adv-chips">
              {CODEC_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`adv-chip ${advanced.videoCodecs.includes(c) ? 'on' : ''}`}
                  onClick={() => toggleIn('videoCodecs', c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="adv-group">日期</div>
          {/*
            相対指定を絶対日付より上に置く。**保存しても腐らない**のはこちらだけなので、
            智能文件夹に入れるならこちらを選んでほしい
          */}
          <div className="adv-row">
            <span className="adv-label">添加</span>
            <select
              value={advanced.addedWithinDays}
              onChange={(e) => set({ addedWithinDays: Number(e.target.value) })}
            >
              {WITHIN_DAYS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="adv-row">
            <span className="adv-label" />
            <input
              type="date"
              value={advanced.addedAfter}
              onChange={(e) => set({ addedAfter: e.target.value })}
            />
            <span className="adv-tilde">〜</span>
            <input
              type="date"
              value={advanced.addedBefore}
              onChange={(e) => set({ addedBefore: e.target.value })}
            />
          </div>
          <div className="adv-row">
            <span className="adv-label">更新</span>
            <select
              value={advanced.modifiedWithinDays}
              onChange={(e) => set({ modifiedWithinDays: Number(e.target.value) })}
            >
              {WITHIN_DAYS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="adv-row">
            <span className="adv-label" />
            <input
              type="date"
              value={advanced.modifiedAfter}
              onChange={(e) => set({ modifiedAfter: e.target.value })}
            />
            <span className="adv-tilde">〜</span>
            <input
              type="date"
              value={advanced.modifiedBefore}
              onChange={(e) => set({ modifiedBefore: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="adv-actions">
        <button onClick={clearAdvanced} disabled={advancedCount(advanced) === 0}>
          清空条件
        </button>
        <button onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
