"""Find kanji-only Japanese UI strings (no kana, so the kana scanner missed them)."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from jp_scan import mask_comments, KANA

CJK = re.compile(r'[\u4e00-\u9fff]')
SKIP = {'node_modules', 'dist', 'target', '.git'}

# Japanese-only / Japan-usage terms that differ from Chinese UI wording
JP_TERMS = [
    '設定', '表示', '再生', '連携', '検索', '追加', '削除', '編集', '移動', '名前',
    '評価', '視聴', '履歴', '一覧', '詳細', '選択', '変更', '実行', '対象', '期間',
    '集計', '合計', '平均', '解除', '除外', '監視', '登録', '初期化', '既定', '書出',
    '読込', '縦', '横', '幅', '高さ', '文字', '画像', '音声', '画質', '品質', '容量',
    '場所', '項目', '条件', '範囲', '状態', '通知', '確認', '中止', '停止', '開始',
    '終了', '現在', '最新', '以前', '以後', '以上', '以下', '未満', '日付', '時刻',
    '本数', '再生中', '保存先', '出力', '入力', '指定', '操作', '機能', '環境', '情報',
    '最大', '最小', '件数', '枚数', '順', '色', '背景', '透明度', '生成', '変換', '同期',
    '更新', '復元', '退避', '整理', '抽出', '参照', '適用', '反映', '取消', '解除',
    '開始位置', '終了位置', '固定', '常時', '全画面', '通常', '標準', '自動', '手動',
    '詳細表示', '縮小', '拡大', '等倍', '位置', '時間帯', '曜日', '月別', '年度',
]


def units_from_file(path):
    src = open(path, encoding='utf-8').read()
    masked, literals = mask_comments(src)
    out = []
    for content in literals:
        if '\\' in content:
            continue
        out.append(content)
    for m in re.finditer(r'>([^<>]*)<', masked, re.S):
        out.append(m.group(1))
    return out


def looks_japanese(s):
    if KANA.search(s):
        return False
    if not CJK.search(s):
        return False
    if not any(t in s for t in JP_TERMS):
        return False
    return True


def main(root='src'):
    per = {}
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP]
        for fn in fns:
            if not fn.endswith(('.ts', '.tsx')) or '.test.' in fn:
                continue
            p = os.path.join(dp, fn)
            for u in units_from_file(p):
                s = u.strip()
                if s and looks_japanese(s):
                    per.setdefault(p, set()).add(s)
    allu = {}
    for p, us in per.items():
        for u in us:
            allu.setdefault(u, []).append(p)
    items = sorted(allu.items(), key=lambda kv: len(kv[0]), reverse=True)
    print('files:', len(per), 'unique kanji-only units:', len(items))
    json.dump({k: v for k, v in items}, open('tools/kanji_units.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    for k, v in items[:120]:
        print(f'{len(v):2d}x  {k}')
    print('...')
    for k, v in items[-60:]:
        print(f'{len(v):2d}x  {k}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'src')
