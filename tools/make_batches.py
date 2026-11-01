import json, glob, os

have = {}
for fp in sorted(glob.glob('tools/zh_dict[0-3].json')):
    for k, v in json.load(open(fp, encoding='utf-8')).items():
        have[k.strip()] = v

from jp_scan import collect
per_file = collect('src')

stripped = {}
for p, us in per_file.items():
    for u in us:
        s = u.strip()
        if s:
            stripped.setdefault(s, set()).add(p)

missing = sorted(k for k in stripped if k not in have)

order = {}
for k in missing:
    p = sorted(stripped[k])[0]
    order.setdefault(p, []).append(k)

rows = []
for p in sorted(order):
    for k in sorted(order[p], key=len, reverse=True):
        rows.append((p, k))

keys = [k for _, k in rows]
json.dump(keys, open('tools/missing_keys.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

N = 4
per = (len(rows) + N - 1) // N
os.makedirs('tools/batches', exist_ok=True)
for i in range(N):
    chunk_idx = range(i * per, min((i + 1) * per, len(rows)))
    with open(f'tools/batches/b{i}.txt', 'w', encoding='utf-8') as f:
        cur = None
        for idx in chunk_idx:
            p, k = rows[idx]
            if p != cur:
                f.write(f'\n### {p}\n')
                cur = p
            f.write(f'[{idx}] ' + k.replace('\n', '\\n') + '\n')
    print(f'b{i}: {len(list(chunk_idx))} entries  (idx {i*per}..{min((i+1)*per,len(rows))-1})')

print('total missing:', len(rows))
