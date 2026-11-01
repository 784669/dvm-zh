import type { SortKey, VideoLabels, VideoRow } from '../types';
import { fmtTime } from './format';

/**
 * 详细列表视图の列定義(v1.16)。列に関する知識は全部ここに置き、
 * コンポーネントは受け取った定義を描くだけにする。
 *
 * ソート状態はグリッドと共有の 1 つ(store の `sort`)。列ヘッダはそれを
 * 書き換えるだけで、リスト専用の排序は持たない
 */

export type ColumnKey =
  | 'thumb'
  | 'duration'
  | 'size'
  | 'resolution'
  | 'rating'
  | 'added'
  | 'views'
  | 'lastViewed'
  | 'ext'
  | 'videoCodec'
  | 'audioCodec'
  | 'folder'
  | 'fileModified'
  | 'fileCreated'
  | 'fps'
  | 'bitrate'
  | 'tags'
  | 'series';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** px。名前列だけは可変なのでここには出てこない */
  width: number;
  align: 'left' | 'right';
  /**
   * この列排序方式るときのキー。null = 排列できない列(标签·系列)。
   * 動画は**标签の集合**を持つので「标签順」に自然な定義が無い(先頭の标签名? 個数?)。
   * どちらを選んでも期待と食い違うので、ヘッダをボタンにしない
   */
  sort: { asc: SortKey; desc: SortKey } | null;
  /**
   * ヘッダを最初に押したときの方向。
   * 追加日を古い順から見たい場面はまず無いので、日付·数量系は降順から始める
   */
  first: 'asc' | 'desc';
  /**
   * セルに出す文字列。値が無ければ null(呼び出し側が '—' にする)。
   * thumb だけは画像なのでこれを使わず、コンポーネントが特別扱いする。
   *
   * 标签·系列は行と別便で届く(v1.23)ので `labels` を見る。
   * 未取得は null(= '—')、取得済みで 0 件は '' (= 空欄)と区別すること
   */
  text: (v: VideoRow, labels?: VideoLabels) => string | null;
}

/**
 * lib/format.ts の fmtSize とはわざと別実装。
 * 大小列が狭いので KB を出さず、MB も小数を落として桁を短く保つ
 */
function fmtListSize(bytes: number): string {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  return `${(bytes / MB).toFixed(0)} MB`;
}

/** "2026-07-27 11:52:06" → "2026-07-27"。列が狭いので時刻は落とす */
function dateOnly(v: string | null): string | null {
  return v ? v.slice(0, 10) : null;
}

/** 文件名から拡張子を取り出す(ドットなし小文字)。Rust の ext_expr() と同じ規則 */
export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  return filename.slice(dot + 1).toLowerCase() || null;
}

/** パスから親文件夹名だけを取り出す(フルパスは列に収まらない) */
export function folderOf(path: string): string | null {
  const parts = path.replace(/\//g, '\\').split('\\').filter(Boolean);
  // 末尾は文件名なので 1 つ手前
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

export const COLUMNS: Record<ColumnKey, ColumnDef> = {
  thumb: {
    key: 'thumb', label: '缩略图', width: 64, align: 'left',
    sort: { asc: 'name_asc', desc: 'name_desc' }, first: 'asc',
    text: () => null,
  },
  duration: {
    key: 'duration', label: '时长', width: 60, align: 'right',
    sort: { asc: 'duration_asc', desc: 'duration_desc' }, first: 'desc',
    text: (v) => (v.durationMs != null ? fmtTime(v.durationMs / 1000) : null),
  },
  size: {
    key: 'size', label: '大小', width: 70, align: 'right',
    sort: { asc: 'size_asc', desc: 'size_desc' }, first: 'desc',
    text: (v) => fmtListSize(v.size),
  },
  resolution: {
    key: 'resolution', label: '分辨率', width: 84, align: 'right',
    sort: { asc: 'res_asc', desc: 'res_desc' }, first: 'desc',
    text: (v) => (v.width && v.height ? `${v.width}×${v.height}` : null),
  },
  rating: {
    key: 'rating', label: '评分', width: 70, align: 'left',
    sort: { asc: 'rating_asc', desc: 'rating_desc' }, first: 'desc',
    // 0 は空欄。'☆☆☆☆☆' を並べると列がうるさくなる
    text: (v) => (v.rating > 0 ? '★'.repeat(v.rating) : ''),
  },
  added: {
    key: 'added', label: '添加日期', width: 82, align: 'right',
    sort: { asc: 'added_asc', desc: 'added_desc' }, first: 'desc',
    text: (v) => dateOnly(v.addedAt),
  },
  views: {
    key: 'views', label: '观看', width: 44, align: 'right',
    sort: { asc: 'views_asc', desc: 'views_desc' }, first: 'desc',
    text: (v) => String(v.viewCount),
  },
  lastViewed: {
    key: 'lastViewed', label: '最近观看', width: 82, align: 'right',
    sort: { asc: 'viewed_asc', desc: 'viewed_desc' }, first: 'desc',
    text: (v) => dateOnly(v.lastViewedAt),
  },
  ext: {
    key: 'ext', label: '扩展名', width: 56, align: 'left',
    sort: { asc: 'ext_asc', desc: 'ext_desc' }, first: 'asc',
    text: (v) => extensionOf(v.filename),
  },
  videoCodec: {
    key: 'videoCodec', label: '视频', width: 64, align: 'left',
    sort: { asc: 'codec_asc', desc: 'codec_desc' }, first: 'asc',
    text: (v) => v.videoCodec,
  },
  audioCodec: {
    key: 'audioCodec', label: '音频', width: 64, align: 'left',
    sort: { asc: 'acodec_asc', desc: 'acodec_desc' }, first: 'asc',
    text: (v) => v.audioCodec,
  },
  folder: {
    key: 'folder', label: '文件夹', width: 120, align: 'left',
    sort: { asc: 'folder_asc', desc: 'folder_desc' }, first: 'asc',
    text: (v) => folderOf(v.path),
  },
  fileModified: {
    key: 'fileModified', label: '文件更新日期', width: 96, align: 'right',
    sort: { asc: 'fmodified_asc', desc: 'fmodified_desc' }, first: 'desc',
    text: (v) => dateOnly(v.fileModifiedAt),
  },
  fileCreated: {
    key: 'fileCreated', label: '文件创建日期', width: 96, align: 'right',
    sort: { asc: 'fcreated_asc', desc: 'fcreated_desc' }, first: 'desc',
    text: (v) => dateOnly(v.fileCreatedAt),
  },
  fps: {
    key: 'fps', label: 'fps', width: 52, align: 'right',
    sort: { asc: 'fps_asc', desc: 'fps_desc' }, first: 'desc',
    // 29.97 は小数が要るが 30.00 と出したくないので、整数なら小数を落とす
    text: (v) =>
      v.fps == null ? null : Number.isInteger(v.fps) ? String(v.fps) : v.fps.toFixed(2),
  },
  bitrate: {
    key: 'bitrate', label: '比特率', width: 84, align: 'right',
    sort: { asc: 'bitrate_asc', desc: 'bitrate_desc' }, first: 'desc',
    text: (v) =>
      v.bitrate == null
        ? null
        : v.bitrate >= 1_000_000
          ? `${(v.bitrate / 1_000_000).toFixed(2)} Mbps`
          : `${Math.round(v.bitrate / 1000)} kbps`,
  },
  // 标签·系列はチップではなくカンマ区切りのテキストで出す(v1.23)。
  // 行が 28〜44px と細いので、チップを並べるより読める文字数が多い
  tags: {
    key: 'tags', label: '标签', width: 160, align: 'left',
    sort: null, first: 'asc',
    text: (_v, labels) => (labels ? labels.tags.map((t) => t.name).join(', ') : null),
  },
  series: {
    key: 'series', label: '系列', width: 120, align: 'left',
    sort: null, first: 'asc',
    text: (_v, labels) => (labels ? labels.series.map((s) => s.name).join(', ') : null),
  },
};

/** ポップオーバーに並べる順(チェックを付けたとき既定でこの位置に入る) */
export const COLUMN_ORDER: ColumnKey[] = [
  'thumb', 'duration', 'size', 'resolution', 'rating', 'tags', 'series', 'ext',
  'videoCodec', 'audioCodec', 'fps', 'bitrate', 'folder',
  'views', 'lastViewed', 'added', 'fileModified', 'fileCreated',
];

/**
 * この構成で标签·系列の別便(api.videoLabels)が要るか。
 * 出さない列のために毎ページ問い合わせを投げないため
 */
export function needsLabels(cols: ColumnKey[]): boolean {
  return cols.includes('tags') || cols.includes('series');
}

/** 既定の列構成。v1.15 までのリスト表示と同じ見た目になる */
export const DEFAULT_COLUMNS: ColumnKey[] = [
  'thumb', 'duration', 'size', 'resolution', 'rating', 'added',
];

/**
 * 設定 `list_columns` の JSON を読む。settings 初の JSON なので、
 * 壊れていても必ず既定に落として起動できるようにする
 * (未知のキーは黙って捨てる。旧バージョンで保存した構成をそのまま読めるようにするため)
 */
export function parseColumns(json: string | null): ColumnKey[] {
  if (!json) return DEFAULT_COLUMNS;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_COLUMNS;
  }
  if (!Array.isArray(raw)) return DEFAULT_COLUMNS;
  const seen = new Set<string>();
  const cols = raw.filter(
    (k): k is ColumnKey =>
      typeof k === 'string' && k in COLUMNS && !seen.has(k) && !!seen.add(k),
  );
  // 名前列は固定なので、それ以外が全部消えた構成は「壊れている」とみなす
  return cols.length > 0 ? normalize(cols) : DEFAULT_COLUMNS;
}

/**
 * 缩略图は必ず先頭に寄せる。エクスプローラーと同じく
 * 「アイコン → 名前 → 残り」の並びを崩さないため(排列の対象外)
 */
function normalize(cols: ColumnKey[]): ColumnKey[] {
  const { thumb, rest } = layout(cols);
  return thumb ? ['thumb', ...rest] : rest;
}

/**
 * 描画順の分解。缩略图は常に先頭、名前はその次。
 * 名前は固定列なので `cols` には含まれない
 */
export function layout(cols: ColumnKey[]): { thumb: boolean; rest: ColumnKey[] } {
  return { thumb: cols.includes('thumb'), rest: cols.filter((k) => k !== 'thumb') };
}

/**
 * 末尾に空けておく幅(px)。ヘッダの列選択ボタンがここに収まる。
 * 行側はこのトラックを埋めないので、最後の列とスクロールバーの間の余白にもなる
 */
export const GUTTER_W = 22;

/**
 * 名前列がこれ以上は縮まない幅(px)。
 * 0 まで縮ませると、列を増やしたときに名前が消えて行を識別できなくなる。
 * ここを下回るときは横スクロールに逃がす(最大化した窓なら全列出しても届かない)
 */
export const NAME_MIN_W = 160;

/**
 * grid-template-columns の値。名前列だけが伸縮する。
 * ヘッダ行·動画行·文件夹行がこれを共有するので列がずれない
 */
export function gridTemplate(cols: ColumnKey[]): string {
  return trackWidths(cols)
    .map((w, i) => (i === nameTrackIndex(cols) ? `minmax(${w}px, 1fr)` : `${w}px`))
    .join(' ');
}

/** 名前列は「缩略图があればその次」に入る */
function nameTrackIndex(cols: ColumnKey[]): number {
  return layout(cols).thumb ? 1 : 0;
}

function trackWidths(cols: ColumnKey[]): number[] {
  const { thumb, rest } = layout(cols);
  return [
    ...(thumb ? [COLUMNS.thumb.width] : []),
    NAME_MIN_W,
    ...rest.map((k) => COLUMNS[k].width),
    GUTTER_W,
  ];
}

/** 列と列の隙間、および行の左右の余白(App.css の .list-row と合わせる) */
const GAP_W = 10;
const ROW_PADDING_W = 16;

/**
 * 名前列が下限まで縮んだときの行の幅(px)。
 *
 * 可視幅がこれを下回ると横スクロールになる。**行の幅は max-content で決めてはいけない** —
 * 文件名の时长で行ごとに幅が変わり、スクロールしたとき列が揃わなくなる
 */
export function totalWidth(cols: ColumnKey[]): number {
  const tracks = trackWidths(cols);
  return tracks.reduce((a, b) => a + b, 0) + GAP_W * (tracks.length - 1) + ROW_PADDING_W;
}

/**
 * ヘッダを押したときの遷移。同じ列なら反転、別の列ならその列の既定の方向。
 * 排列できない列(sort === null)は今の排序をそのまま返す
 */
export function nextSort(col: ColumnDef, current: SortKey): SortKey {
  if (!col.sort) return current;
  if (current === col.sort.asc) return col.sort.desc;
  if (current === col.sort.desc) return col.sort.asc;
  return col.sort[col.first];
}

/** 今の排序がこの列によるものなら方向を返す。違う列なら null(矢印を出さない) */
export function sortDirOf(col: ColumnDef, current: SortKey): 'asc' | 'desc' | null {
  if (!col.sort) return null;
  if (current === col.sort.asc) return 'asc';
  if (current === col.sort.desc) return 'desc';
  return null;
}

/**
 * ツールバーの select に常に並べる排序。
 * ここに無いキーは列ヘッダからしか選べないが、選ばれている間だけ option を注入する
 */
export const CURATED_SORTS: SortKey[] = [
  'added_desc', 'added_asc', 'name_asc', 'name_desc', 'size_desc', 'duration_desc',
  'rating_desc', 'viewed_desc', 'views_desc', 'random',
];

const SORT_LABELS: Record<SortKey, string> = {
  added_desc: '添加时间(降序)',
  added_asc: '添加时间(升序)',
  name_asc: '名称(升序)',
  name_desc: '名称(降序)',
  size_asc: '大小(升序)',
  size_desc: '大小(降序)',
  duration_asc: '时长(升序)',
  duration_desc: '时长(降序)',
  rating_asc: '评分(升序)',
  rating_desc: '按评分顺序',
  viewed_asc: '最后观看(升序)',
  viewed_desc: '最近观看顺序',
  views_asc: '观看次数(升序)',
  views_desc: '最常观看顺序',
  res_asc: '分辨率(升序)',
  res_desc: '分辨率(降序)',
  ext_asc: '扩展名(升序)',
  ext_desc: '扩展名(降序)',
  codec_asc: '视频编解码器(升序)',
  codec_desc: '视频编解码器(降序)',
  acodec_asc: '音频编解码器(升序)',
  acodec_desc: '音频编解码器(降序)',
  folder_asc: '文件夹(升序)',
  folder_desc: '文件夹(降序)',
  fmodified_asc: '文件更新日期(升序)',
  fmodified_desc: '文件更新日期(降序)',
  fcreated_asc: '文件创建日期(升序)',
  fcreated_desc: '文件创建日期(降序)',
  fps_asc: 'fps(升序)',
  fps_desc: 'fps(降序)',
  bitrate_asc: '比特率(升序)',
  bitrate_desc: '比特率(降序)',
  series_asc: '按系列顺序',
  playlist_asc: '按播放列表顺序',
  dup: '合并重复项',
  random: '随机',
};

export function sortLabel(key: SortKey): string {
  return SORT_LABELS[key];
}

/**
 * 排序の選択肢。ツールバーの select と、グリッド余白の右键菜单(v1.20)で共有する。
 *
 * 按系列顺序·重複順はその筛选が効いている間だけ意味を持つので、そのときだけ足す。
 * CURATED_SORTS に無いキー(列ヘッダから選んだもの)は、選ばれている間だけ末尾に足す —
 * 足さないと select / メニューが現在値を表現できず、開いた瞬間に別の並びへ飛ぶ
 */
export function sortOptions(
  s: { sort: SortKey; seriesId: number | null; duplicatesOnly: boolean },
): SortKey[] {
  const keys = [...CURATED_SORTS];
  if (s.seriesId !== null) keys.push('series_asc');
  if (s.duplicatesOnly) keys.push('dup');
  if (!keys.includes(s.sort)) keys.push(s.sort);
  return keys;
}
