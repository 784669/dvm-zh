import json

inv = json.load(open('tools/jp_ui_inventory.json', encoding='utf-8'))
uniq = {}  # text -> [files]
for f, items in inv.items():
    for it in items:
        t = it['text']
        uniq.setdefault(t, []).append(f)

with open('tools/zh_unique.json', 'w', encoding='utf-8') as f:
    json.dump({k: uniq[k] for k in sorted(uniq)}, f, ensure_ascii=False, indent=1)

ai = [k for k, v in uniq.items() if any('lib/ai' in x or x.endswith('lib/aiTools.ts') for x in v)]
print("unique 总数:", len(uniq))
print("AI 相关 unique:", len(ai))
print("非 AI unique:", len(uniq) - len(ai))
