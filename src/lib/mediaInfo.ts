import type { MediaInfo, MediaStream, MediaTag } from '../types';
import { fmtSize, fmtTime } from './format';

/**
 * 详情面板の「媒体信息」を組み立てる純関数(v1.15)。
 *
 * 画面表示とテキスト复制は**同じ InfoSection[] から作る**。
 * 整形コードが 2 つあると「表示中の内容を复制」がいずれズレるため。
 *
 * 方針: ffprobe の識別子(h264 / yuv420p / bt709 / 5.1(side))は訳さず生のまま出す。
 * 変換テーブルは陳腐化するし、この情報を使う場面(ffmpeg のコマンド組み立て、
 * フォーラムでの質問)では生値のほうが役に立つ。
 * 変換するのは単位·時間·言語コード·真偽値と、生では意味が読めない数値だけ
 */

export interface InfoRow {
  label: string;
  value: string;
}

export interface InfoSection {
  title: string;
  rows: InfoRow[];
}

/** 値が無い行は作らない(null / 空文字を落とす) */
function push(rows: InfoRow[], label: string, value: string | null | undefined): void {
  if (value != null && value !== '') rows.push({ label, value });
}

export function fmtBitrate(bps: number): string {
  return bps >= 1_000_000
    ? `${(bps / 1_000_000).toFixed(2)} Mbps`
    : `${Math.round(bps / 1000)} kbps`;
}

export function fmtSampleRate(hz: number): string {
  return `${(hz / 1000).toFixed(1)} kHz`;
}

/**
 * codec によって基準が違う level の生値を読める形にする。
 * H.264 は 40 が L4.0、HEVC は 120 が L4.0。知らない codec は生値のまま出す(嘘を書かない)
 */
export function fmtLevel(codec: string | null, level: number): string {
  const c = (codec ?? '').toLowerCase();
  if (c === 'h264' || c === 'avc' || c === 'vp9') return `L${(level / 10).toFixed(1)}`;
  if (c === 'hevc' || c === 'h265') return `L${(level / 30).toFixed(1)}`;
  return `L${level}`;
}

const LANGUAGES: Record<string, string> = {
  jpn: '日本語', ja: '日本語',
  eng: '英語', en: '英語',
  chi: '中国語', zho: '中国語', zh: '中国語',
  kor: '韓国語', ko: '韓国語',
  fra: '法语', fre: '法语',
  deu: '德语', ger: '德语',
  spa: '西班牙语', ita: '意大利语', rus: '俄语', por: '葡萄牙语',
};

/**
 * ISO 639 の 3 文字コードは一般には読めないので日本語名を添える。生値も必ず残す。
 * "und"(未定義)はほぼ全ての mp4 に入っていて情報量がゼロなので行ごと出さない
 */
export function fmtLanguage(code: string | null): string | null {
  if (!code) return null;
  const key = code.toLowerCase();
  if (key === 'und') return null;
  const name = LANGUAGES[key];
  return name ? `${name} (${code})` : code;
}

/** tv / pc は生では読めないので補う */
function fmtColorRange(range: string): string {
  if (range === 'tv') return '制限 (tv)';
  if (range === 'pc') return '满 (pc)';
  return range;
}

function fmtFieldOrder(order: string): string {
  return order === 'progressive' ? '逐行扫描' : `隔行扫描（${order})`;
}

function fmtFrameRate(s: MediaStream): string | null {
  if (s.avgFrameRate == null) return null;
  const avg = `${s.avgFrameRate.toFixed(3)} fps`;
  // avg と r がズレるのは可変帧率。判断材料として書き添える
  const vfr = s.rFrameRate != null && Math.abs(s.rFrameRate - s.avgFrameRate) > 0.01;
  return vfr ? `${avg}(可変)` : avg;
}

/**
 * 別行で出している値と、中身の無いお決まりの标签を落とす。
 * mkv は "BPS-eng" のように言語サフィックスが付くので剥がしてから判定する
 */
const HIDDEN_TAGS = new Set([
  // 専用の行で出しているもの
  'language', 'title', 'duration', 'bps', 'number_of_frames', 'number_of_bytes', 'rotate',
  // 中身が常に同じで何も分からないもの
  'handler_name', 'vendor_id', 'minor_version', 'source_id',
]);

export function visibleTags(tags: MediaTag[]): MediaTag[] {
  return tags.filter((t) => {
    const key = t.key.toLowerCase().replace(/-[a-z]{2,3}$/, '');
    return !key.startsWith('_statistics') && !HIDDEN_TAGS.has(key);
  });
}

function pushTags(rows: InfoRow[], tags: MediaTag[]): void {
  for (const t of visibleTags(tags)) push(rows, t.key, t.value);
}

/** 「言語 / 标题 / 标志 / 标签」は映像·音声·字幕で共通 */
function pushCommonRows(rows: InfoRow[], s: MediaStream, containerMs: number | null): void {
  // 尺は普通容器全体と同じなので、ズレているときだけ出す(音声だけ短い等の発見用)
  if (s.durationMs != null && (containerMs == null || Math.abs(s.durationMs - containerMs) > 1000)) {
    push(rows, '时长', fmtTime(s.durationMs / 1000));
  }
  push(rows, '语言', fmtLanguage(s.language));
  push(rows, '标题', s.title);
  const flags = [s.isDefault ? '默认' : null, s.isForced ? '强制' : null].filter(Boolean);
  push(rows, '标志', flags.join(' / '));
  pushTags(rows, s.tags);
}

/** "h264 (High) @ L4.0" を組み立てる */
function codecLine(s: MediaStream): string | null {
  if (!s.codecName) return null;
  let line = s.codecName;
  if (s.profile) line += ` (${s.profile})`;
  if (s.level != null) line += ` @ ${fmtLevel(s.codecName, s.level)}`;
  return line;
}

function videoRows(s: MediaStream, containerMs: number | null): InfoRow[] {
  const rows: InfoRow[] = [];
  push(rows, '编解码器', codecLine(s));
  push(rows, '详细', s.codecLongName);
  if (s.width && s.height) push(rows, '分辨率', `${s.width}×${s.height}`);
  push(rows, '宽高比', s.displayAspectRatio);
  // 正方形ピクセルなら書く意味が無い
  if (s.sampleAspectRatio && s.sampleAspectRatio !== '1:1') {
    push(rows, '像素比', s.sampleAspectRatio);
  }
  push(rows, '帧率', fmtFrameRate(s));
  push(rows, '像素格式', s.pixFmt);
  if (s.bitDepth != null) push(rows, '位深度', `${s.bitDepth} bit`);
  push(rows, 'HDR', s.hdr);
  push(rows, '色彩空间', s.colorSpace);
  push(rows, '色域', s.colorPrimaries);
  push(rows, '传输特性', s.colorTransfer);
  if (s.colorRange) push(rows, '色域范围', fmtColorRange(s.colorRange));
  if (s.fieldOrder) push(rows, '扫描方式', fmtFieldOrder(s.fieldOrder));
  if (s.rotation != null && s.rotation !== 0) push(rows, '旋转', `${s.rotation}°`);
  if (s.bitrate != null) push(rows, '比特率', fmtBitrate(s.bitrate));
  if (s.frameCount != null) push(rows, '帧数', s.frameCount.toLocaleString('ja-JP'));
  push(rows, '编解码器标签', s.codecTag);
  pushCommonRows(rows, s, containerMs);
  return rows;
}

function audioRows(s: MediaStream, containerMs: number | null): InfoRow[] {
  const rows: InfoRow[] = [];
  push(rows, '编解码器', codecLine(s));
  push(rows, '详细', s.codecLongName);
  if (s.channels != null) {
    push(rows, '声道', s.channelLayout ? `${s.channels} ch (${s.channelLayout})` : `${s.channels} ch`);
  }
  if (s.sampleRate != null) push(rows, '采样率', fmtSampleRate(s.sampleRate));
  push(rows, '采样格式', s.sampleFmt);
  if (s.bitDepth != null) push(rows, '位深度', `${s.bitDepth} bit`);
  if (s.bitrate != null) push(rows, '比特率', fmtBitrate(s.bitrate));
  push(rows, '编解码器标签', s.codecTag);
  pushCommonRows(rows, s, containerMs);
  return rows;
}

function subtitleRows(s: MediaStream, containerMs: number | null): InfoRow[] {
  const rows: InfoRow[] = [];
  push(rows, '编解码器', s.codecName);
  push(rows, '详细', s.codecLongName);
  pushCommonRows(rows, s, containerMs);
  return rows;
}

const KIND_LABEL: Record<string, string> = {
  video: '视频',
  audio: '音频',
  subtitle: '字幕',
  cover: '封面图',
};

/**
 * 同じ種別が 1 本だけなら番号を振らない(「映像」)。
 * 複数あるときだけ「音声 #1 / 音声 #2」にする
 */
function sectionTitle(kind: string, ordinal: number, total: number): string {
  const label = KIND_LABEL[kind] ?? kind;
  return total > 1 ? `${label} #${ordinal}` : label;
}

export function buildMediaSections(info: MediaInfo): InfoSection[] {
  const { format, streams, chapters } = info;
  const byKind = (kind: string) => streams.filter((s) => s.kind === kind);
  // 埋め込みの封面图は codec_type が video だが本編ではない。
  // 一緒に数えると YouTube 由来の mp4 が「映像 2」に見えてしまう
  const videos = byKind('video').filter((s) => !s.isAttachedPic);
  const covers = byKind('video').filter((s) => s.isAttachedPic);
  const audios = byKind('audio');
  const subtitles = byKind('subtitle');
  // 添付(mkv の字体は 20 本入ることがある)とデータは 1 行にまとめる。
  // 1 本ずつブロックにすると详情面板が埋まって肝心の映像·音声が見えなくなる
  const attachments = streams.filter((s) => s.kind === 'attachment');
  const others = streams.filter(
    (s) => !['video', 'audio', 'subtitle', 'attachment'].includes(s.kind),
  );

  const general: InfoRow[] = [];
  push(
    general,
    '容器',
    format.formatLongName && format.formatName
      ? `${format.formatLongName} (${format.formatName})`
      : (format.formatLongName ?? format.formatName),
  );
  if (format.durationMs != null) push(general, '播放时长', fmtTime(format.durationMs / 1000));
  if (format.size != null) push(general, '文件大小', fmtSize(format.size));
  if (format.bitrate != null) push(general, '总比特率', fmtBitrate(format.bitrate));
  const counts = [
    videos.length ? `视频 ${videos.length}` : null,
    audios.length ? `音频 ${audios.length}` : null,
    subtitles.length ? `字幕 ${subtitles.length}` : null,
    others.length ? `其他 ${others.length}` : null,
  ].filter(Boolean);
  push(general, '流', counts.join(' / '));
  if (attachments.length) push(general, '附件', `${attachments.length} 个`);
  if (covers.length) push(general, '封面图', `${covers.length} 个`);
  pushTags(general, format.tags);

  const sections: InfoSection[] = [{ title: '常规', rows: general }];

  videos.forEach((s, i) => {
    sections.push({
      title: sectionTitle('video', i + 1, videos.length),
      rows: videoRows(s, format.durationMs),
    });
  });
  audios.forEach((s, i) => {
    sections.push({
      title: sectionTitle('audio', i + 1, audios.length),
      rows: audioRows(s, format.durationMs),
    });
  });
  subtitles.forEach((s, i) => {
    sections.push({
      title: sectionTitle('subtitle', i + 1, subtitles.length),
      rows: subtitleRows(s, format.durationMs),
    });
  });
  // 封面图は本編の後ろ。尺も帧率も無いので映像用の行をそのまま使う
  covers.forEach((s, i) => {
    sections.push({
      title: sectionTitle('cover', i + 1, covers.length),
      rows: videoRows(s, format.durationMs),
    });
  });

  if (chapters.length) {
    sections.push({
      title: '章节',
      rows: chapters.map((c, i) => ({
        label: fmtTime(c.startMs / 1000),
        value: c.title ?? `章节 ${i + 1}`,
      })),
    });
  }

  // 中身が 1 行も無いセクションは出さない(壊れた文件で空の枠だけ並ぶのを防ぐ)
  return sections.filter((s) => s.rows.length > 0);
}

/** 表示中のセクションをそのままテキストにする(复制ボタン) */
export function mediaSectionsToText(header: string, sections: InfoSection[]): string {
  const body = sections
    .map((s) => [`[${s.title}]`, ...s.rows.map((r) => `${r.label}: ${r.value}`)].join('\n'))
    .join('\n\n');
  return `${header}\n\n${body}\n`;
}
