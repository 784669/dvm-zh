import { parentDir } from './paths';
import type { VideoRow } from '../types';

/** 削除しようとしている動画のうち、监视文件夹由来のもの(= 消しても再登録されるもの) */
export interface ExcludeTargets {
  /** 监视文件夹由来の動画のパス。これが文件単位で除外する対象 */
  files: string[];
  /** その動画たちの親文件夹(重複なし·昇順) */
  folders: string[];
}

/**
 * 削除の前に監視除外を勧めるかどうかを決める(v1.33)。
 *
 * **监视文件夹由来のものだけを対象にする**。個別登録(`watchedFolderId === null`)は
 * 消しても再登録されないので、勧めても意味が無く、問いかけが騒がしくなるだけ。
 *
 * 親文件夹は `lib/paths.ts` の `parentDir` で出す —— 文件夹ツリーや
 * `VideoQuery.dirPath` と同じ表記でないと、件数を数えるときに突き合わせられない
 */
export function excludeTargets(selection: VideoRow[]): ExcludeTargets {
  const watched = selection.filter((v) => v.watchedFolderId !== null);
  const dirs = watched
    .map((v) => parentDir(v.path))
    .filter((d): d is string => d !== null);
  const folders = [...new Set(dirs)].sort((a, b) => a.localeCompare(b));
  return { files: watched.map((v) => v.path), folders };
}

/**
 * 「親文件夹ごと」を選んだときに、選択していない動画を何件巻き込むか。
 *
 * `folderCounts` はその文件夹直下にある登録数(小文字のパスをキーにする)。
 * 分からない文件夹は 0 として扱うので、**数え終わる前に 0 を「巻き込み無し」と
 * 見せないこと** —— 呼び出し側は数え終わるまで件数を出さない
 */
export function collateralCount(
  targets: ExcludeTargets,
  folderCounts: Record<string, number>,
): number {
  const selectedPerFolder = new Map<string, number>();
  for (const f of targets.files) {
    const dir = parentDir(f);
    if (dir === null) continue;
    selectedPerFolder.set(dir, (selectedPerFolder.get(dir) ?? 0) + 1);
  }
  let total = 0;
  for (const dir of targets.folders) {
    const inFolder = folderCounts[dir.toLowerCase()] ?? 0;
    total += Math.max(0, inFolder - (selectedPerFolder.get(dir) ?? 0));
  }
  return total;
}
