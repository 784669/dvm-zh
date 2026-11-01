import { api } from '../api';
import { useLibrary } from '../store';
import { describeFilter, NO_MASTERS } from './filterChips';
import { DURATION_RANGES, toFilterState } from './query';
import type { AiTool, JsonSchemaProp, ToolSchema } from './ai/types';
import type { DurationBucket, SortKey, VideoQuery } from '../types';

/** ツール実行を UI(チャット内カード)へ通知するコールバック */
export type ToolNotify = (message: string) => void;

/**
 * 宣言と実行をまとめる小さなヘルパー(v1.43。SDK の `betaTool` の代わり)。
 *
 * `betaTool` は inputSchema から run の引数型を推論してくれたが、あれは Anthropic SDK
 * 固有の芸なので、**入力の型は呼び出し側が明示する**ことにした。AI が返す引数は
 * どのみち実行時に何が来るか分からないので、推論に頼りきらないほうが実態に合う
 */
function defineTool<T>(spec: {
  name: string;
  description: string;
  parameters: ToolSchema;
  run: (input: T) => Promise<string>;
}): AiTool {
  return {
    def: { name: spec.name, description: spec.description, parameters: spec.parameters },
    run: (input) => spec.run(input as T),
  };
}

/** Rust の order_clause() と types.ts の SortKey に合わせて手で同期する */
const SORT_ENUM = [
  'added_desc', 'added_asc', 'name_asc', 'name_desc',
  'size_desc', 'size_asc', 'duration_desc', 'duration_asc',
  'rating_desc', 'rating_asc', 'viewed_desc', 'viewed_asc',
  'views_desc', 'views_asc', 'res_desc', 'res_asc',
  'ext_asc', 'ext_desc', 'codec_asc', 'codec_desc', 'acodec_asc', 'acodec_desc',
  'folder_asc', 'folder_desc',
  'fmodified_desc', 'fmodified_asc', 'fcreated_desc', 'fcreated_asc',
  'fps_desc', 'fps_asc', 'bitrate_desc', 'bitrate_asc',
  'random', 'dup',
] as const;

/** search_videos と apply_filter で共通の筛选条件(スキーマがずれないよう 1 か所にまとめる) */
const FILTER_PROPS: Record<string, JsonSchemaProp> = {
  text: { type: 'string', description: '文件名·标题的部分匹配。以空格分隔，筛选包含所有词的内容' },
  searchPath: { type: 'boolean', description: '将文件夹路径也纳入 text 搜索范围' },
  dirPath: { type: 'string', description: '仅筛选此文件夹直接下级的视频(不含子文件夹)。以绝对路径指定' },
  tags: { type: 'array', items: { type: 'string' }, description: '按标签名（完全一致）筛选。同组标签之间为 OR，跨组则为 AND（例: ["奇幻","科幻","动画"] = (奇幻 或 科幻) 且 动画）。分组可通过 list_tags 确认' },
  series: { type: 'string', description: '系列名(完全匹配)' },
  searchComment: { type: 'boolean', description: '将备注也纳入 text 搜索范围' },
  dirPathRecursive: { type: 'boolean', description: '设为 true 时将 dirPath 按包含子文件夹解释' },
  minRating: { type: 'integer', minimum: 1, maximum: 5 },
  unrated: { type: 'boolean', description: '仅限未设置评分的视频。minRating 的 0 显示「无条件」故不同' },
  durationBucket: { type: 'string', enum: ['lt5', '5to20', '20to60', 'gt60'], description: '尺: 5分以下/5〜20分/20〜60分/60分以上' },
  minDurationSec: { type: 'integer', description: '时长下限(秒)。当需要比 durationBucket 更精细时' },
  maxDurationSec: { type: 'integer', description: '时长上限(秒)' },
  untagged: { type: 'boolean', description: '仅限未附任何标签的视频' },
  unwatched: { type: 'boolean', description: '仅限从未播放过的视频' },
  resumedOnly: { type: 'boolean', description: '仅限观看了一部分且未看完的视频(仅记录于应用内播放)' },
  minViewCount: { type: 'integer', description: '播放次数下限' },
  maxViewCount: { type: 'integer', description: '播放次数上限。0 显示仅未观看' },
  duplicatesOnly: { type: 'boolean', description: '仅限内容相同(大小与开头哈希一致)的视频。配合 sort=dup 时相同内容会相邻' },
  minSizeBytes: { type: 'integer', description: '文件大小下限(字节)' },
  maxSizeBytes: { type: 'integer', description: '文件大小上限(字节)' },
  extensions: { type: 'array', items: { type: 'string' }, description: '按扩展名筛选（例: ["mp4","mkv"]）' },
  minHeight: { type: 'integer', description: '纵向分辨率下限。1080 为 FHD 以上，2160 为 4K 以上' },
  maxHeight: { type: 'integer', description: '纵向分辨率上限。**低于该值**，故 720 显示「720p 以下」' },
  orientation: { type: 'string', enum: ['portrait', 'landscape'], description: '画面方向。portrait = 纵向、landscape = 横向（含正方形）' },
  videoCodecs: { type: 'array', items: { type: 'string' }, description: '按视频编码筛选（例: ["h264","hevc"]）' },
  addedAfter: { type: 'string', description: '加入媒体库日期下限(YYYY-MM-DD，含当天)' },
  addedBefore: { type: 'string', description: '加入媒体库日期上限(YYYY-MM-DD，含当天)' },
  addedWithinDays: { type: 'integer', description: '仅限过去 N 日内添加的(7 显示最近 1 周)' },
  modifiedAfter: { type: 'string', description: '文件更新日期下限(YYYY-MM-DD，含当天)' },
  modifiedBefore: { type: 'string', description: '文件更新日期上限(YYYY-MM-DD，含当天)' },
  modifiedWithinDays: { type: 'integer', description: '仅限过去 N 日内更新的' },
  sort: { type: 'string', enum: [...SORT_ENUM] },
};

/** FILTER_PROPS に対応する入力(betaTool が推論する型と同じ形) */
interface FilterInput {
  text?: string;
  searchPath?: boolean;
  searchComment?: boolean;
  dirPath?: string;
  dirPathRecursive?: boolean;
  tags?: string[];
  series?: string;
  minRating?: number;
  unrated?: boolean;
  durationBucket?: string;
  minDurationSec?: number;
  maxDurationSec?: number;
  untagged?: boolean;
  unwatched?: boolean;
  resumedOnly?: boolean;
  minViewCount?: number;
  maxViewCount?: number;
  duplicatesOnly?: boolean;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  extensions?: string[];
  minHeight?: number;
  maxHeight?: number;
  orientation?: string;
  videoCodecs?: string[];
  addedAfter?: string;
  addedBefore?: string;
  addedWithinDays?: number;
  modifiedAfter?: string;
  modifiedBefore?: string;
  modifiedWithinDays?: number;
  sort?: string;
  missingOnly?: boolean;
}

/** ツール入力を VideoQuery に変換する。标签·系列名は id へ解決する */
async function toQuery(input: FilterInput): Promise<VideoQuery> {
  const range = input.durationBucket
    ? DURATION_RANGES[input.durationBucket as DurationBucket]
    : undefined;
  const sec = (s: number | undefined) => (s === undefined ? undefined : s * 1000);
  return {
    text: input.text || undefined,
    sort: input.sort as SortKey | undefined,
    tagIds: input.tags?.length ? await resolveTagIds(input.tags) : undefined,
    seriesId: input.series ? await resolveSeriesId(input.series) : undefined,
    minRating: input.minRating,
    // 秒指定はプリセットより細かいので、両方来たら秒のほうを採る
    minDurationMs: sec(input.minDurationSec) ?? range?.min,
    maxDurationMs: sec(input.maxDurationSec) ?? range?.max,
    missing: input.missingOnly ? true : undefined,
    searchPath: input.searchPath || undefined,
    dirPath: input.dirPath || undefined,
    untagged: input.untagged || undefined,
    unwatched: input.unwatched || undefined,
    duplicatesOnly: input.duplicatesOnly || undefined,
    minHeight: input.minHeight || undefined,
    videoCodecs: input.videoCodecs?.length ? input.videoCodecs : undefined,
    addedAfter: input.addedAfter || undefined,
    addedBefore: input.addedBefore || undefined,
    // --- v1.35 ---
    searchComment: input.searchComment || undefined,
    dirPathRecursive: input.dirPathRecursive || undefined,
    unrated: input.unrated || undefined,
    resumedOnly: input.resumedOnly || undefined,
    minViewCount: input.minViewCount,
    maxViewCount: input.maxViewCount,
    minSizeBytes: input.minSizeBytes,
    maxSizeBytes: input.maxSizeBytes,
    extensions: input.extensions?.length ? input.extensions : undefined,
    maxHeight: input.maxHeight || undefined,
    orientation: (input.orientation as VideoQuery['orientation']) || undefined,
    addedWithinDays: input.addedWithinDays,
    modifiedAfter: input.modifiedAfter || undefined,
    modifiedBefore: input.modifiedBefore || undefined,
    modifiedWithinDays: input.modifiedWithinDays,
  };
}

/** 标签名を id に解決する。1 つでも見つからなければエラーにする(黙って無視すると条件が緩む) */
async function resolveTagIds(names: string[]): Promise<number[]> {
  const tags = await api.listTags();
  return names.map((name) => {
    const tag = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!tag) throw new Error(`标签「${name}」未找到`);
    return tag.id;
  });
}

async function resolveSeriesId(name: string): Promise<number> {
  const list = await api.listSeries();
  const s = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!s) throw new Error(`系列「${name}」未找到`);
  return s.id;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '不明';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分${s % 60}秒`;
}

/** AI 助手のツール一式を作る。notify はツール実行カードの表示用 */
export function buildTools(notify: ToolNotify): AiTool[] {
  const searchVideos = defineTool<FilterInput & { limit?: number }>({
    name: 'search_videos',
    description:
      '搜索视频库并以 JSON 返回结果(画面不变)。若要在画面显示结果，请使用 apply_filter。',
    parameters: {
      type: 'object',
      properties: {
        ...FILTER_PROPS,
        limit: { type: 'integer', description: '最大项数(默认 20)' },
      },
    },
    run: async (input) => {
      const query = await toQuery(input);
      const total = await api.countVideos(query);
      const rows = await api.queryVideos(query, Math.min(input.limit ?? 20, 100), 0);
      return JSON.stringify({
        total,
        returned: rows.length,
        videos: rows.map((v) => ({
          id: v.id,
          filename: v.filename,
          title: v.title,
          rating: v.rating,
          durationMs: v.durationMs,
          viewCount: v.viewCount,
          isMissing: v.isMissing,
        })),
      });
    },
  });

  const listTags = defineTool<Record<string, never>>({
    name: 'list_tags',
    description:
      '列出所有标签及各标签的视频数、所属群组(groupName)。群组是分类的轴(例:「类型」「媒体种类」)，搜索中同一群组的标签之间为 OR',
    parameters: { type: 'object', properties: {} },
    run: async () => JSON.stringify(await api.listTags()),
  });

  const listSeries = defineTool<Record<string, never>>({
    name: 'list_series',
    description: '列出所有系列及各系列的视频数',
    parameters: { type: 'object', properties: {} },
    run: async () => JSON.stringify(await api.listSeries()),
  });

  const applyFilter = defineTool<FilterInput>({
    name: 'apply_filter',
    description:
      '筛选应用的网格显示(向用户展示结果)。省略的条件会被解除。全部省略则取消筛选。',
    parameters: {
      type: 'object',
      properties: {
        ...FILTER_PROPS,
        missingOnly: { type: 'boolean', description: '仅限找不到文件的视频' },
      },
    },
    run: async (input) => {
      const query = await toQuery(input);
      // 画面に反映する条件は toQuery の結果から機械的に戻す(智能文件夹と同じ経路)。
      // ここで項目を並べ直すと、条件が増えたときに片方だけ落ちる
      useLibrary.getState().applyFilter(toFilterState(query));
      // 適用後の件数を返す(グリッドと同じクエリ条件)
      const count = await api.countVideos(query);
      notify(`已筛选网格（${count} 件)`);
      return `已应用筛选。符合 ${count} 件`;
    },
  });

  const tagVideos = defineTool<{ videoIds: number[]; tag: string }>({
    name: 'tag_videos',
    description: '给视频添加标签(若无标签则创建)',
    parameters: {
      type: 'object',
      properties: {
        videoIds: { type: 'array', items: { type: 'integer' } },
        tag: { type: 'string' },
      },
      required: ['videoIds', 'tag'],
    },
    run: async (input) => {
      await api.tagVideos(input.videoIds, input.tag, 'ai');
      useLibrary.getState().bumpVersion();
      notify(`${input.videoIds.length} 个添加标签「${input.tag}」已添加`);
      return `${input.videoIds.length} 个添加标签「${input.tag}」已添加`;
    },
  });

  const setRating = defineTool<{ videoIds: number[]; rating: number }>({
    name: 'set_rating',
    description: '设置视频评分(0 解除)',
    parameters: {
      type: 'object',
      properties: {
        videoIds: { type: 'array', items: { type: 'integer' } },
        rating: { type: 'integer', minimum: 0, maximum: 5 },
      },
      required: ['videoIds', 'rating'],
    },
    run: async (input) => {
      await api.setRating(input.videoIds, input.rating, 'ai');
      useLibrary.getState().bumpVersion();
      notify(`${input.videoIds.length} 个的评分设为 ★${input.rating} 已完成`);
      return `${input.videoIds.length} 个的评分设为 ${input.rating} 已完成`;
    },
  });

  const addToSeries = defineTool<{ videoIds: number[]; series: string }>({
    name: 'add_to_series',
    description: '将视频添加到系列(若无系列则创建)',
    parameters: {
      type: 'object',
      properties: {
        videoIds: { type: 'array', items: { type: 'integer' } },
        series: { type: 'string' },
      },
      required: ['videoIds', 'series'],
    },
    run: async (input) => {
      await api.addToSeries(input.videoIds, input.series, 'ai');
      useLibrary.getState().bumpVersion();
      notify(`${input.videoIds.length} 个添加到系列「${input.series}」已添加`);
      return `${input.videoIds.length} 个添加到系列「${input.series}」已添加`;
    },
  });

  return [searchVideos, listTags, listSeries, applyFilter, tagVideos, setRating, addToSeries];
}

/** 選択中の動画·現在のフィルタをコンテキストとして注入したシステムプロンプトを作る */
export async function buildSystemPrompt(): Promise<string> {
  const s = useLibrary.getState();
  let selectionBlock = '(无)';
  if (s.selection.length > 0) {
    const tags = await api.tagsForVideos(s.selection.map((v) => v.id)).catch(() => []);
    const lines = s.selection.slice(0, 20).map((v) => {
      const parts = [
        `id=${v.id}`,
        `文件名: ${v.filename}`,
        v.title && v.title !== v.filename ? `标题: ${v.title}` : null,
        `尺: ${fmtDuration(v.durationMs)}`,
        v.rating > 0 ? `★${v.rating}` : null,
        v.width && v.height ? `${v.width}×${v.height}` : null,
      ].filter(Boolean);
      return `- ${parts.join(' / ')}`;
    });
    selectionBlock = lines.join('\n');
    if (tags.length > 0) {
      selectionBlock += `\n共通标签: ${tags.map((t) => t.name).join(', ')}`;
    }
    if (s.selection.length > 20) {
      selectionBlock += `\n(另有 ${s.selection.length - 20} 个)`;
    }
  }
  /*
   * 効いている条件は**筛选帯と同じ describeFilter から組み立てる**(v1.35)。
   * 手書きで並べていた頃は条个足すたびにここも直す必要があり、
   * 忘れると「画面では絞れているのに AI は知らない」がすれ違いのまま残った。
   *
   * 名前を引くのにマスタが要るもの(标签·系列·文件夹)だけは
   * ここでは解決できない(この関数は同期で、tags を持っていない)ので従来どおり件数で出す
   */
  const NEEDS_MASTERS = ['folder', 'dirPath', 'series'];
  const filters: string[] = [];
  if (s.tagIds.length > 0) filters.push(`标签 ${s.tagIds.length} 件`);
  if (s.seriesId != null) filters.push('系列');
  if (s.folderId != null || s.dirPath != null) filters.push('文件夹');
  for (const t of describeFilter(s, NO_MASTERS)) {
    if (t.key.startsWith('tags:') || NEEDS_MASTERS.includes(t.key)) continue;
    // 箱の中は OR。帯の見た目と同じ読み方になるように繋ぐ
    filters.push(t.chips.map((c) => c.label).join('  或  '));
  }

  return `你是面向 Windows 的视频管理软件「DVM」的助手。帮助用户搜索、整理其视频媒体库（打标签、评分、系列管理）。

指南:
- 想向用户展示搜索结果时使用 apply_filter（网格会被筛选）。仅作为数据参考时使用 search_videos
- 标签建议应依据文件名·标题推测内容，优先提议已有标签（list_tags）。新增标签需在用户同意后再进行
- 标签有分组（分类轴）。不同轴的标签可以同时添加（例: 媒体类型「动画」与类型「奇幻」）。分组的创建·修改由用户负责，AI 不要执行
- 写入操作（tag_videos / set_rating / add_to_series）仅在用户意图明确时才执行。若含糊请先提议并确认
- 回答请用简洁的中文

当前用户选中的视频:
${selectionBlock}

当前网格筛选条件: ${filters.length > 0 ? filters.join('、') : '(无)'}`;
}
