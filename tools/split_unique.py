import json, os

inv = json.load(open('tools/jp_ui_inventory.json', encoding='utf-8'))
uniq = set()
for items in inv.values():
    for it in items:
        uniq.add(it['text'])
items = sorted(uniq)
n = len(items)
per = (n + 3) // 4
os.makedirs('tools/parts', exist_ok=True)
for i in range(4):
    chunk = items[i * per:(i + 1) * per]
    with open(f'tools/parts/part{i}.txt', 'w', encoding='utf-8') as f:
        for t in chunk:
            f.write(t + '\n')
print('total', n, 'per', per)
for i in range(4):
    print(f'part{i}: {per} lines')
