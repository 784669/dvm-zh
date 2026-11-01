import type { DedupeResult } from '../types';

/**
 * 重複解消のあとに出すトースト文言(v1.33)。
 *
 * 入口が 2 つ(筛选帯と文件夹ツリー)あるので、文言はここに 1 つだけ置く。
 * **文件がどうなったかを必ず書く** —— 「登録を外した」のか「送入回收站送った」のかが
 * 分からないと、ユーザーは文件が無事か確かめに行くことになる
 */
export function dedupeMessage(result: DedupeResult, trashed: boolean): string {
  if (result.removed === 0 && result.failed === 0) {
    return '没有可消除的重复';
  }
  if (!trashed) {
    return `${result.removed.toLocaleString()} 项已从媒体库移除（文件仍保留）`;
  }
  const head = `${result.trashed.toLocaleString()} 个已送入回收站`;
  // 送れなかったぶんは登録も残してある(文件があるのに一覧から消えると行方が分からなくなる)
  return result.failed > 0
    ? `${head}。${result.failed.toLocaleString()} 个未能送入回收站，注册信息也保留`
    : head;
}
