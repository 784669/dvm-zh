"""Replace leftover kanji-only Japanese UI terms with Chinese.

Only regions outside comments are touched. Terms are applied longest-first so a
compound is finished before its parts are considered.
"""
import os, re, json

SKIP = {'node_modules', 'dist', 'target', '.git'}

TERMS = {
    '合計再生時間': '总播放时长',
    '保存先': '保存位置',
    '一時停止': '暂停',
    '拡張子': '扩展名',
    '時間帯': '时段',
    '並び順': '排序',
    '絞り込み': '筛选',
    '全画面': '全屏',
    '初期化': '初始化',
    '未満': '以下',
    '昇順': '升序',
    '降順': '降序',
    '件数': '项数',
    '設定': '设置',
    '表示': '显示',
    '再生': '播放',
    '連携': '联动',
    '検索': '搜索',
    '追加': '添加',
    '削除': '删除',
    '編集': '编辑',
    '移動': '移动',
    '名前': '名称',
    '評価': '评分',
    '視聴': '观看',
    '履歴': '历史',
    '一覧': '列表',
    '詳細': '详细',
    '選択': '选择',
    '変更': '更改',
    '実行': '执行',
    '対象': '对象',
    '期間': '期间',
    '集計': '统计',
    '合計': '合计',
    '除外': '排除',
    '監視': '监视',
    '登録': '登记',
    '既定': '默认',
    '書出': '导出',
    '読込': '读取',
    '縦': '纵向',
    '横': '横向',
    '高さ': '高度',
    '画像': '图片',
    '音声': '音频',
    '画質': '画质',
    '品質': '质量',
    '場所': '位置',
    '項目': '项目',
    '状態': '状态',
    '確認': '确认',
    '開始': '开始',
    '終了': '结束',
    '現在': '当前',
    '日付': '日期',
    '時刻': '时刻',
    '出力': '输出',
    '入力': '输入',
    '機能': '功能',
    '環境': '环境',
    '情報': '信息',
    '変換': '转换',
    '復元': '还原',
    '反映': '生效',
    '適用': '应用',
    '標準': '标准',
    '自動': '自动',
    '手動': '手动',
    '等倍': '1:1',
    '曜日': '星期',
}
# 幅 is only safe as a standalone unit noun (宽度); apply last
ORDER = sorted(TERMS, key=len, reverse=True)


def mask_comments_only(src):
    n = len(src)
    out = list(src)
    i = 0
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = ' '
            i = j
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, j):
                if src[k] != '\n':
                    out[k] = ' '
            i = j
        elif c in ("'", '"', '`'):
            # skip over string literals so a "//" inside them is not read as a comment
            q = c
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == q:
                    break
                j += 1
            i = j + 1
        else:
            i += 1
    return ''.join(out)


def main():
    stats = {}
    files = 0
    for dp, dns, fns in os.walk('src'):
        dns[:] = [d for d in dns if d not in SKIP]
        for fn in fns:
            if not fn.endswith(('.ts', '.tsx')) or '.test.' in fn:
                continue
            p = os.path.join(dp, fn)
            src = open(p, encoding='utf-8').read()
            masked = mask_comments_only(src)
            if not any(t in masked for t in ORDER):
                continue
            chars = list(src)
            hit = 0
            # longest-first, each pass rewrites chars in place using current state
            for t in ORDER:
                cur = ''.join(chars)
                m = mask_comments_only(cur)
                start = 0
                while True:
                    idx = m.find(t, start)
                    if idx < 0:
                        break
                    z = TERMS[t]
                    chars[idx:idx + len(t)] = list(z)
                    # rebuild mask cheaply: recompute once after all replacements of this term
                    m = mask_comments_only(''.join(chars))
                    start = idx + len(z)
                    hit += 1
                    stats[t] = stats.get(t, 0) + 1
            new = ''.join(chars)
            if new != src:
                open(p, 'w', encoding='utf-8').write(new)
                files += 1
    print('files changed:', files)
    for t, c in sorted(stats.items(), key=lambda kv: -kv[1]):
        print(f'{c:4d}  {t} -> {TERMS[t]}')


if __name__ == '__main__':
    main()
