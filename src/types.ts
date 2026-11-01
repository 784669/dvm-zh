export interface VideoRow {
  id: number;
  path: string;
  filename: string;
  title: string | null;
  size: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  rating: number;
  viewCount: number;
  lastViewedAt: string | null;
  /** アプリ内再生のレジューム位置(0 = 位置なし) */
  resumeMs: number;
  /** 再生方式判定用(ffprobe 由来。未取得時 null) */
  videoCodec: string | null;
  audioCodec: string | null;
  isMissing: boolean;
  isOffline: boolean;
  thumbState: number;
  thumbPath: string | null;
  addedAt: string;
  // --- v1.16 でリストの列にするために足した(Rust の core/query.rs と手動同期) ---
  /**
   * 文件の作成時刻。**登録時に一度だけ**入り、以後更新されない。
   * Windows では复制やダウンロードでリセットされるので「動画が作られた日」ではない
   */
  fileCreatedAt: string | null;
  /** 文件の最終更新時刻(重新扫描で追従する) */
  fileModifiedAt: string | null;
  fps: number | null;
  bitrate: number | null;
  /**
   * 発見元の监视文件夹(null = 個別登録)。v1.33 で追加。
   * 删除とき「消しても次のスキャンで再登録されるか」の判定に使う
   */
  watchedFolderId: number | null;
}

/**
 * 詳細パネルで編集する标题と自由記入メモ(v1.34)。
 * メモは長文になりうるので `VideoRow` には入れず、1 件選んだときだけ引く
 */
export interface VideoInfo {
  title: string | null;
  comment: string | null;
}

export interface WatchedFolder {
  id: number;
  path: string;
  recursive: boolean;
  enabled: boolean;
  online: boolean;
  videoCount: number;
}

/**
 * 监视文件夹の中の「取り込まない場所」(v1.33)。
 * 监视文件夹は再帰的に走査されるので、ここに入れない限り
 * 配下の文件は一覧から消しても次のスキャンで再登録される
 */
export interface ExcludedPath {
  id: number;
  path: string;
  /** まだ配下に残っている登録数(0 でなければ消し残し) */
  videoCount: number;
}

/** 重複解消の下見(実行前に必ずこれを見せる) */
export interface DedupePlan {
  /** 対象になった重複群组数(= 残る本数) */
  groups: number;
  /** 移出媒体库本数 */
  removeCount: number;
  /** スコープの外にも同じ内容があったので見送った群组数 */
  skippedOutside: number;
  /** 大小 0 で判定できず見送った群组数 */
  skippedZeroSize: number;
  /** 外す本数の文件夹別内訳(多い順·上位 20) */
  byFolder: { path: string; count: number }[];
  /** 先頭 20 群组の中身 */
  samples: { keep: string; remove: string[] }[];
  removeIds: number[];
}

/** 重複解消の実行結果 */
export interface DedupeResult {
  /** 媒体库から外した本数 */
  removed: number;
  /** 送入回收站送れた本数(登録を外すだけのときは 0) */
  trashed: number;
  /** 送入回收站送れなかった本数(未接続のドライブ·権限·使用中など) */
  failed: number;
}

/**
 * 文件夹ツリーの 1 ノード(侧边栏の「文件夹」タブ)。
 * Rust 側が videos.path から組み立てたものをそのまま受け取る
 */
export interface FolderNode {
  /** 正規化した絶対パス。ツリーの識別子 */
  path: string;
  /** 親ノードの path。ルート(监视文件夹 / 监视文件夹外の置き場)は null */
  parent: string | null;
  /** 表示名。ルートはフルパス、それ以外は末尾セグメント */
  name: string;
  /** この文件夹直下の動画数(= 点击したときに出る件数) */
  directCount: number;
  /** 配下全部视频数(自分を含む) */
  totalCount: number;
  /** 监视文件夹のルートなら その id */
  watchedFolderId: number | null;
  online: boolean;
}

/** メインビューの先頭に出すサブ文件夹(文件夹カード) */
export interface SubfolderView {
  /** 「上层文件夹」。监视文件夹の外に出るときは null */
  parent: string | null;
  children: FolderNode[];
}

/** 侧边栏下半分の表示切り替え */
export type SidebarTab = 'library' | 'folders';

/**
 * 排序。Rust の `order_clause()` のホワイトリストと 1 対 1(片方だけ足さないこと)。
 *
 * ツールバーの select に出すのは lib/listColumns.ts の CURATED_SORTS だけで、
 * 残りは详细列表の列ヘッダから選ぶ
 */
export type SortKey =
  | 'added_desc' | 'added_asc'
  | 'name_asc' | 'name_desc'
  | 'size_asc' | 'size_desc'
  | 'duration_asc' | 'duration_desc'
  | 'rating_asc' | 'rating_desc'
  /** 最終視聴日。viewed_desc = 「最近观看顺序」 */
  | 'viewed_asc' | 'viewed_desc'
  /** 視聴回数。views_desc = 「最常观看顺序」 */
  | 'views_asc' | 'views_desc'
  /** 解像度(画素数で比較) */
  | 'res_asc' | 'res_desc'
  | 'ext_asc' | 'ext_desc'
  | 'codec_asc' | 'codec_desc'
  | 'acodec_asc' | 'acodec_desc'
  /** フルパス順。文件夹ごとにまとまり、中は文件名順になる */
  | 'folder_asc' | 'folder_desc'
  | 'fmodified_asc' | 'fmodified_desc'
  | 'fcreated_asc' | 'fcreated_desc'
  | 'fps_asc' | 'fps_desc'
  | 'bitrate_asc' | 'bitrate_desc'
  | 'series_asc'
  /** 保存播放列表の手動順(v1.40)。playlistId と組でだけ意味を持つ */
  | 'playlist_asc'
  /** 重複表示用。同じ文件が隣り合う */
  | 'dup'
  /** randomSeed から決定的にシャッフル(ページングしても崩れない) */
  | 'random';

export interface VideoQuery {
  /** 空白区切りで AND 検索(全角スペースも区切り) */
  text?: string;
  sort?: SortKey;
  /** 监视文件夹由来の動画全部(配下のサブ文件夹も含む) */
  folderId?: number | null;
  /** この文件夹**直下**の動画だけ(サブ文件夹は含まない)。folderId とは別物 */
  dirPath?: string | null;
  /**
   * 絞り込む标签。同じ群组の标签同士は OR、群组をまたぐと AND になる。
   * 未分類标签はそれぞれ独立した軸として AND(組み立ては Rust の core/query.rs)
   */
  tagIds?: number[];
  seriesId?: number | null;
  /** 保存播放列表で絞る(v1.40)。sort: 'playlist_asc' と組で登録順に並ぶ */
  playlistId?: number | null;
  missing?: boolean;
  /** この评分以上に絞る(1〜5) */
  minRating?: number;
  /** 尺の範囲(ミリ秒)。指定時、尺が未取得の動画は含まれない */
  minDurationMs?: number;
  maxDurationMs?: number;
  /** text の検索対象にフルパスも含める */
  searchPath?: boolean;
  /** 仅限未附任何标签的视频 */
  untagged?: boolean;
  /** 仅限从未播放过的视频 */
  unwatched?: boolean;
  /** 解像度の下限(ピクセル)。未取得の動画は含まれない */
  minWidth?: number;
  minHeight?: number;
  /** 视频编码で絞る(複数指定は OR) */
  videoCodecs?: string[];
  /** 媒体库追加日の範囲(YYYY-MM-DD。両端を含む) */
  addedAfter?: string;
  addedBefore?: string;
  /** 内容が同一(size + partial_hash が一致)の動画だけ */
  duplicatesOnly?: boolean;
  /** sort = 'random' のときのシャッフル種 */
  randomSeed?: number;

  // --- v1.35 で追加(Rust の core/query.rs と手動同期) ---
  /** dirPath をサブ文件夹込みで解釈する */
  dirPathRecursive?: boolean;
  /** 文件大小の範囲(バイト)。size は NOT NULL なので未取得の除外が起きない */
  minSizeBytes?: number;
  maxSizeBytes?: number;
  /** 拡張子で絞る(ドット無し·小文字。複数指定は OR) */
  extensions?: string[];
  /** 解像度の上限(ピクセル)。**その値未満**(minHeight の「以上」と隙間なく分ける) */
  maxHeight?: number;
  /** 画面の方向。正方形は landscape 側 */
  orientation?: Orientation;
  /** ★を付けていないものだけ。minRating の 0 は「無条件」なので別物 */
  unrated?: boolean;
  /** 途中まで観て終わっていないものだけ(アプリ内再生でのみ記録される) */
  resumedOnly?: boolean;
  /** 再生回数の範囲 */
  minViewCount?: number;
  maxViewCount?: number;
  /** 文件更新日期の範囲(YYYY-MM-DD。両端を含む) */
  modifiedAfter?: string;
  modifiedBefore?: string;
  /** 「過去 N 日」の相対指定。保存しても腐らないのが絶対日付との違い */
  addedWithinDays?: number;
  modifiedWithinDays?: number;
  /** text の検索対象にメモ(comment)も含める */
  searchComment?: boolean;
}

/** 画面の方向。'' = 未指定 */
export type Orientation = '' | 'portrait' | 'landscape';

/**
 * **詳細検索ポップオーバーに出ている条件そのもの**(v1.35)。
 *
 * v1.34 までは「ツールバー本体に出していない条件」という意味だったが、
 * v1.35 で★と时长もツールバーから外して筛选の入口を漏斗 1 つにしたので、
 * いまは「詳細検索の中身ぜんぶ」と一致する。`advancedCount()` がそのままバッジの数字になる。
 *
 * ここに入らない筛选は**別の入口を持つもの**だけ:
 * テキスト(検索欄)·标签·系列·文件夹(侧边栏)·
 * 找不到 / 重複(侧边栏の全体行)·包含子文件夹(筛选帯)
 *
 * 数値は 2 系統ある。**プリセットのセレクトは 0 = 未指定、自由入力は null = 未指定**。
 * 自由入力側で 0 に意味がある(再生回数 0 = 未視聴)ため区別が要る
 */
export interface AdvancedFilter {
  searchPath: boolean;
  searchComment: boolean;
  /** 0 = 未指定。1〜5 で「★N 以上」 */
  minRating: number;
  unrated: boolean;
  minDurationMs: number | null;
  maxDurationMs: number | null;
  minSizeBytes: number | null;
  maxSizeBytes: number | null;
  extensions: string[];
  /** 0 = 未指定 */
  minHeight: number;
  /** 0 = 未指定。指定した値**未満** */
  maxHeight: number;
  orientation: Orientation;
  videoCodecs: string[];
  untagged: boolean;
  unwatched: boolean;
  resumedOnly: boolean;
  minViewCount: number | null;
  maxViewCount: number | null;
  addedAfter: string;
  addedBefore: string;
  /** 0 = 未指定 */
  addedWithinDays: number;
  modifiedAfter: string;
  modifiedBefore: string;
  /** 0 = 未指定 */
  modifiedWithinDays: number;
}

export const EMPTY_ADVANCED: AdvancedFilter = {
  searchPath: false,
  searchComment: false,
  minRating: 0,
  unrated: false,
  minDurationMs: null,
  maxDurationMs: null,
  minSizeBytes: null,
  maxSizeBytes: null,
  extensions: [],
  minHeight: 0,
  maxHeight: 0,
  orientation: '',
  videoCodecs: [],
  untagged: false,
  unwatched: false,
  resumedOnly: false,
  minViewCount: null,
  maxViewCount: null,
  addedAfter: '',
  addedBefore: '',
  addedWithinDays: 0,
  modifiedAfter: '',
  modifiedBefore: '',
  modifiedWithinDays: 0,
};

/** 詳細検索の拡張子チップ 1 つぶん(Rust の core/query::ExtensionCount と対) */
export interface ExtensionCount {
  ext: string;
  count: number;
}

/**
 * 視聴履歴の 1 行(v1.18)。1 視聴 = 1 行なので、同じ動画が何度も出る。
 * 操作履歴(OpEntry)と違って取り消しの概念は無い
 */
export interface ViewEntry {
  id: number;
  videoId: number;
  /** 'YYYY-MM-DD HH:MM:SS'(localtime) */
  viewedAt: string;
  /** 閉じた時点の再生位置。null = 不明(外部プレイヤー / 異常終了)。0 とは意味が違う */
  watchedMs: number | null;
  filename: string;
  title: string | null;
  durationMs: number | null;
  thumbPath: string | null;
  isMissing: boolean;
}

/**
 * 視聴履歴の期間の集計(v1.36。Rust の core/history::ViewStats と対)。
 * watchedMs は**到達位置の合計**であって実視聴時間ではない
 */
export interface ViewStats {
  /** 視聴回数(= 行数) */
  count: number;
  /** 観た動画の本数(同じ動画を何度観ても 1) */
  videoCount: number;
  /** 到達位置の合計(ミリ秒)。watchedMs が不明な行は含まない */
  watchedMs: number;
  /** watchedMs が不明な行数。合計に入っていないことを画面で断るために持つ */
  unknownCount: number;
}

/** 尺フィルタのプリセット */
export type DurationBucket = 'lt5' | '5to20' | '20to60' | 'gt60';

/** グリッド(缩略图)か详细列表か */
export type ViewMode = 'grid' | 'list';

/**
 * 連続再生の位置。プレイヤーは「クエリ + 一覧内の位置」だけを持ち、
 * 次の 1 件は Rust から都度引く(グリッドのページキャッシュに依存させない)
 */
export interface PlayQueue {
  query: VideoQuery;
  index: number;
  total: number;
}

/**
 * 保存播放列表(v1.40)。侧边栏に並ぶ「棚」。
 * 中身の並びは Rust 側の `playlist_entries.position` が持つ
 */
export interface Playlist {
  id: number;
  name: string;
  videoCount: number;
  position: number;
  /** 中身の合計再生時間(ミリ秒)。尺が未取得の動画は入らない(v1.41、C-6) */
  durationMs: number;
  /** 缩略图生成済みの先頭動画の jpg パス。1 枚も無ければ null(v1.41、C-6) */
  thumbPath: string | null;
}

/** M3U8 取り込みの結果(v1.41、C-3。Rust の commands/playlists::M3u8Import と対) */
export interface M3u8Import {
  playlistId: number;
  name: string;
  /** 播放列表に入った動画数(重複は畳まれる) */
  count: number;
  /** 実在しない·対応形式でないなどで登録できなかった行数 */
  skipped: number;
}

/**
 * 再生队列(v1.40)。**DB には無い。フロントのメモリだけにある。**
 *
 * 保存リストを開いてもここへ**複写**されるだけで、編集は保存側に一切届かない。
 * 書き戻すのは「覆盖保存」を押したときだけ(DESIGN.md「播放列表」節)。
 *
 * `items` は手で並べた列そのもの。同じ動画は 2 回入らない(追加が冪等になる)ので、
 * 「いま再生中」は **`currentId`(video_id)で指せる** —— 排列ても追随する。
 */
export interface QueueState {
  items: VideoRow[];
  /**
   * いま队列から再生している動画の id。null = 队列では再生していない。
   *
   * **`items` に無い id が入りうる**。再生中の 1 个队列から外しても再生は
   * 続けるため(そのときは `orphanIndex` が次の行き先を覚えている)
   */
  currentId: number | null;
  /**
   * 再生中の動画を队列から外したときの、外した位置。
   * 次へ進むとここの要素が来る。队列に居るあいだは null
   */
  orphanIndex: number | null;
  /** この中身の出所になった保存リスト(null = ゼロから組んだ無名の队列) */
  sourceId: number | null;
  sourceName: string;
  /** 出所から変わっているか。`●` と「覆盖保存」の活性を決める */
  dirty: boolean;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  /** 所属群组(null = 未分類) */
  groupId: number | null;
  /** 分组名称。見出し表示と AI へのヒントに使う */
  groupName: string | null;
  videoCount: number;
}

/**
 * 标签をまとめる軸(v1.19)。「ジャンル」「メディア種別」のような分類の入れ物で、
 * 群组自体は動画に付かない。検索では同じ群组の标签同士が OR になる
 */
export interface TagGroup {
  id: number;
  name: string;
  sortOrder: number;
  tagCount: number;
}

/** 選択中の動画のうち、その标签が付いている件数(标签パレットの 3 状態表示用) */
export interface TagCount {
  tagId: number;
  count: number;
}

/**
 * 一覧(グリッド·详细列表)のチップに出す标签·系列(v1.23)。
 * **Rust の core/labels.rs と手動同期**。
 *
 * VideoRow には入れず、表示中のページの id ぶんだけ別便で取る(理由は core/labels.rs 冒頭)。
 * 「まだ取れていない」は undefined、「1 つも付いていない」は空配列で表す —
 * 呼び出し側がセルを `—` にするか空欄にするかを決められるようにするため
 */
export interface VideoLabels {
  videoId: number;
  tags: { id: number; name: string; color: string | null }[];
  series: { id: number; name: string }[];
}

/** 保存した検索条件。queryJson は VideoQuery をそのまま JSON にしたもの */
export interface SmartFolder {
  id: number;
  name: string;
  queryJson: string;
  position: number;
}

/** 統計の 1 項目(棒グラフ 1 本ぶん)。Rust の core/stats::Bucket と対 */
export interface StatBucket {
  key: string;
  label: string;
  count: number;
  /**
   * この束の总大小(バイト)と合計再生時間(ミリ秒)(v1.37)。
   * 棒グラフの軸切り替え(件数 / 容量 / 時間)がこの 3 つを出し分ける。
   * **動画を数えていない内訳(byViewMonth)では 0**
   */
  bytes: number;
  durationMs: number;
}

export interface LibraryStats {
  videoCount: number;
  totalSizeBytes: number;
  totalDurationMs: number;
  tagCount: number;
  seriesCount: number;
  missingCount: number;
  unwatchedCount: number;
  untaggedCount: number;
  duplicateCount: number;
  /** 评分の内訳。key = 星の数。**常に 6 本**(0 件の星も含む) */
  byRating: StatBucket[];
  byCodec: StatBucket[];
  byResolution: StatBucket[];
  byFolder: StatBucket[];
  byMonth: StatBucket[];
  // --- v1.37 ---
  /** key は尺プリセット('lt5' / '5to20' / '20to60' / 'gt60' / 'unknown') */
  byDuration: StatBucket[];
  /** key はドット無し·小文字の拡張子(上位 12) */
  byExtension: StatBucket[];
  /** key は 'landscape' / 'portrait' / 'unknown' */
  byOrientation: StatBucket[];
  /** key は筛选の範囲そのもの('0' / '1' / '2-4' / '5-9' / '10-') */
  byViewCount: StatBucket[];
  /** 文件更新日期の年別(古い順。key = 'YYYY'、不明は '')。追加月とは別物 */
  byFileYear: StatBucket[];
  /** 月ごとの視聴回数(古い順、直近 24 か月)。view_history 由来なので v1.18 以降だけ */
  byViewMonth: StatBucket[];
  /** 星期 × 时段的观看次数(v1.41、C-7)。[曜日 0=日〜6=土][0〜23 時] の 7×24 */
  viewHeatmap: number[][];
}

export interface Series {
  id: number;
  name: string;
  videoCount: number;
}

/** transcode:progress イベントのペイロード */
export interface TranscodeProgress {
  videoId: number;
  /** 0〜100。尺が不明なときは null(スピナー表示) */
  percent: number | null;
  message: string;
}

/** 画面右下に出す通知(主に API 失敗の報告) */
export interface Toast {
  id: number;
  message: string;
  kind: 'error' | 'info';
}

/** 媒体库 1 つぶん(v1.27。Rust の core/libraries.rs と手動同期) */
export interface LibraryEntry {
  id: string;
  name: string;
  /** 媒体库文件夹の絶対パス。直下に library.db / thumbs / backups がある */
  root: string;
  sortOrder: number;
  lastOpenedAt: string | null;
  /** ルート(ドライブ·共有)に到達できるか。DB には持たず毎回判定している */
  online: boolean;
}

/**
 * 起動時に媒体库を開けたかどうか(v1.27)。
 * `ok` 以外のときは空の placeholder で起動しているので、
 * フロントは復旧画面を出して通常の操作をさせない
 */
export type LibraryStatus = 'ok' | 'offline' | 'missing' | 'broken' | 'none';

export interface LibraryState {
  status: LibraryStatus;
  message: string;
  /** 開こうとした媒体库。status が 'none' のときだけ null */
  current: LibraryEntry | null;
}

export interface AppInfo {
  dataDir: string;
  /** いま開いている媒体库(v1.27) */
  libraryId: string;
  libraryName: string;
  libraryRoot: string;
  dbPath: string;
  dbSize: number;
  thumbsDir: string;
  thumbCount: number;
  thumbCacheSize: number;
  backupsDir: string;
  /** コマの画像の**既定**の保存先(v1.26)。設定が空欄のときの行き先 */
  framesDir: string;
  /** MCP サーバーの可执行文件。同梱されていなければ null */
  mcpPath: string | null;
  /** 播放用转码缓存(v1.38)。**媒体库横断の合計** */
  transcodeCount: number;
  transcodeSize: number;
}

export interface BackupInfo {
  fileName: string;
  path: string;
  size: number;
  createdAt: string;
}

/** 文件操作の dry-run で 1 件ごとに付く状態 */
export type PlanStatus = 'ok' | 'conflict' | 'sourceMissing' | 'offline' | 'unchanged';

/** dry-run の 1 行。この表を見せて承認をもらってから apply する */
export interface PlanItem {
  videoId: number;
  from: string;
  to: string;
  status: PlanStatus;
  note: string | null;
}

export interface OpResult {
  videoId: number;
  from: string;
  to: string;
  ok: boolean;
  error: string | null;
}

/** fileop:progress イベントのペイロード */
export interface FileOpProgress {
  done: number;
  total: number;
  current: string;
}

// --- 媒体信息(详情面板の折りたたみセクション。v1.15) ---
//
// Rust の core/metadata.rs と手動で同期している(型生成ツールは使っていない)。
// 値は ffprobe のほぼ生。単位変換·日本語ラベルは lib/mediaInfo.ts の担当

/** ffprobe の tags 1 件。エンコーダ名·作成日時·mkv の BPS などが入る */
export interface MediaTag {
  key: string;
  value: string;
}

export interface MediaFormat {
  formatName: string | null;
  formatLongName: string | null;
  durationMs: number | null;
  size: number | null;
  bitrate: number | null;
  streamCount: number | null;
  tags: MediaTag[];
}

/**
 * ffprobe の 1 流。映像 / 音声 / 字幕 / 添付を同じ型で運ぶ
 * (種別ごとに使うフィールドが違うだけ。取れなかった値は null)
 */
export interface MediaStream {
  index: number;
  /** 'video' | 'audio' | 'subtitle' | 'attachment' | 'data' */
  kind: string;
  codecName: string | null;
  codecLongName: string | null;
  codecTag: string | null;
  profile: string | null;
  /** codec 依存の生値(h264 の 40 が L4.0)。表示は fmtLevel() で変換する */
  level: number | null;
  durationMs: number | null;
  bitrate: number | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
  /** 埋め込みの封面图(kind は 'video' だが本編ではない) */
  isAttachedPic: boolean;
  tags: MediaTag[];
  width: number | null;
  height: number | null;
  displayAspectRatio: string | null;
  sampleAspectRatio: string | null;
  pixFmt: string | null;
  bitDepth: number | null;
  colorSpace: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorRange: string | null;
  fieldOrder: string | null;
  avgFrameRate: number | null;
  rFrameRate: number | null;
  frameCount: number | null;
  rotation: number | null;
  /** 'HDR10 (PQ)' / 'HLG' / 'Dolby Vision'(フレームを読まずに分かる範囲) */
  hdr: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  sampleFmt: string | null;
}

export interface MediaChapter {
  startMs: number;
  endMs: number;
  title: string | null;
}

export interface MediaInfo {
  format: MediaFormat;
  streams: MediaStream[];
  chapters: MediaChapter[];
}

/** 操作履歴の 1 行 */
export interface OpEntry {
  id: number;
  timestamp: string;
  /** "user" / "ai" / "system" */
  actor: string;
  action: string;
  payload: string | null;
  undoable: boolean;
  /** 取り消せない理由 */
  reason: string | null;
  undoneAt: string | null;
}
