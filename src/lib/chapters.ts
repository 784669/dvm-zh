/**
 * 章节（v1.29)。mpv の `chapter-list` を UI 用に整形し、
 * 「今どの章节か」「次/前のジャンプ先はどこか」を計算する純関数を置く。
 *
 * **ffprobe は使わない**。再生中の文件は mpv がすでに開いているので、
 * chapter-list を購読すれば追加の文件 I/O がゼロで済む(外付け HDD / NAS 対策)。
 * 代償として WebView2 フォールバック経路では章节が出ない
 */

/** 表示·ジャンプに必要な最小限。mpv の生の並びからここへ落とす */
export interface Chapter {
  /** 開始位置(秒) */
  time: number;
  /** 表示名。mpv が标题を持たないときは「章节 N」で埋める */
  label: string;
}

/**
 * 「次の章节」を探すときの余裕(秒)。
 * time-pos は 29.999 のように区切りのわずか手前を指すことがあり、素直に
 * `time > currentTime` で探すと**今いる区切りへ飛び直して**進まなくなる
 */
const NEXT_EPS = 0.1;

/**
 * mpv が「名前の無い章节」に入れてくる値(実測)。**空文字では来ない**ので、
 * これを弾かないと一覧に「(unnamed)」が並ぶ。名前無しの mkv は珍しくない
 */
const MPV_UNNAMED = '(unnamed)';

/**
 * mpv の chapter-list(node)を Chapter[] にする。
 * 時刻が数値でない要素は捨てる(壊れた文件で NaN の目盛りが出るのを防ぐ)。
 * 排序は mpv が保証しているが、番号付けが崩れると致命的なので自前でも排列る
 */
export function toChapters(data: unknown): Chapter[] {
  if (!Array.isArray(data)) return [];
  const times = data
    .map((c) => {
      const o = c as { time?: unknown; title?: unknown } | null;
      const time = typeof o?.time === 'number' ? o.time : NaN;
      const raw = typeof o?.title === 'string' ? o.title.trim() : '';
      return { time, title: raw === MPV_UNNAMED ? '' : raw };
    })
    .filter((c) => Number.isFinite(c.time) && c.time >= 0)
    .sort((a, b) => a.time - b.time);
  // 「章节 N」の N は排列たあとの順番。详情面板の媒体信息と同じ規則
  return times.map((c, i) => ({ time: c.time, label: c.title || `章节 ${i + 1}` }));
}

/**
 * 章节の UI を出してよいか。
 * **1 つだけの章节は飛び先が無い**ので、マーカーもボタンもキーも出さない
 * (音轨が 1 本なら選ばせない、としているのと同じ判断)
 */
export function hasChapters(chapters: Chapter[]): boolean {
  return chapters.length >= 2;
}

/**
 * その秒数がどの章节に入っているか(0 始まり)。
 * 最初の章节が 0:00 から始まらない文件もあるので、
 * どこにも入らないときは -1 を返す(名前を出さない)
 */
export function chapterIndexAt(chapters: Chapter[], time: number): number {
  let found = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].time <= time) found = i;
    else break;
  }
  return found;
}

/** その秒数の章节名(シークバーのホバー表示用)。無ければ null */
export function chapterLabelAt(chapters: Chapter[], time: number): string | null {
  const i = chapterIndexAt(chapters, time);
  return i < 0 ? null : chapters[i].label;
}

/**
 * 次/前の章节の開始位置(秒)。**端では null を返す**(何もしない)。
 *
 * 端の判定を mpv 任せ(`add chapter 1`)にしないのは、最後の章节でさらに
 * 進めると終端へ到達してしまい、連続再生が発動して次の動画が始まるため。
 * 動画の移動は N / P と ⏮ ⏭ の役割
 */
export function chapterJumpTarget(
  chapters: Chapter[],
  currentTime: number,
  dir: 1 | -1,
): number | null {
  if (!hasChapters(chapters)) return null;
  if (dir === 1) {
    const next = chapters.find((c) => c.time > currentTime + NEXT_EPS);
    return next ? next.time : null;
  }
  // 前へは素直に 1 つ前の頭へ(mpv 標準)。今の章节の頭に戻す方式は採らない
  const i = chapterIndexAt(chapters, currentTime);
  return i > 0 ? chapters[i - 1].time : null;
}
