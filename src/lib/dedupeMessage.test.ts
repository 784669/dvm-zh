import { describe, expect, it } from 'vitest';
import { dedupeMessage } from './dedupeMessage';

describe('dedupeMessage', () => {
  it('登録を外しただけならファイルが残ることを書く', () => {
    expect(dedupeMessage({ removed: 2666, trashed: 0, failed: 0 }, false))
      .toBe('2,666 项已从媒体库移除（文件仍保留）');
  });

  it('ごみ箱へ送ったときは送った件数を書く', () => {
    expect(dedupeMessage({ removed: 10, trashed: 10, failed: 0 }, true))
      .toBe('10 个已送入回收站');
  });

  it('送れなかったぶんは登録も残したことを書く', () => {
    expect(dedupeMessage({ removed: 8, trashed: 8, failed: 2 }, true))
      .toBe('8 个已送入回收站。2 个未能送入回收站，注册信息也保留');
  });

  it('対象が無ければそう言う', () => {
    expect(dedupeMessage({ removed: 0, trashed: 0, failed: 0 }, false))
      .toBe('没有可消除的重复');
    expect(dedupeMessage({ removed: 0, trashed: 0, failed: 0 }, true))
      .toBe('没有可消除的重复');
  });

  it('1 件も送れなかったときも結果を報告する(無反応にしない)', () => {
    expect(dedupeMessage({ removed: 0, trashed: 0, failed: 3 }, true))
      .toBe('0 个已送入回收站。3 个未能送入回收站，注册信息也保留');
  });
});
