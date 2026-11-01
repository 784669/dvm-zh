import json, re, glob, sys, os

keys = json.load(open('tools/missing_keys.json', encoding='utf-8'))
KANA = re.compile(r'[\u3040-\u309f\u30a0-\u30fa\u30fc-\u30ff\uff66-\uff9f]')
BRACE = re.compile(r'\$\{[^}]*\}|\{[^{}]*\}')

tr = {}
for fp in sorted(glob.glob('tools/tr_b*.json')):
    for k, v in json.load(open(fp, encoding='utf-8')).items():
        tr[int(k)] = v

print('keys:', len(keys), 'translations:', len(tr))
missing = [i for i in range(len(keys)) if i not in tr]
if missing:
    print('MISSING IDX:', missing)

out = {}
problems = []
for i, key in enumerate(keys):
    if i not in tr:
        continue
    val = tr[i]
    groups = BRACE.findall(key)
    # expand @@n@@
    def sub(m):
        n = int(m.group(1))
        if 1 <= n <= len(groups):
            return groups[n - 1]
        problems.append((i, f'bad placeholder @@{n}@@ max {len(groups)}'))
        return m.group(0)
    val2 = re.sub(r'@@(\d+)@@', sub, val)
    # normalise Japanese middle dot to the Chinese-friendly one
    val2 = val2.replace('\u30fb', '\u00b7')

    # validate: brace groups must match exactly
    got = BRACE.findall(val2)
    if sorted(got) != sorted(groups):
        problems.append((i, f'brace mismatch key={groups} val={got}'))
        continue
    if KANA.search(val2):
        problems.append((i, f'kana left: {val2[:60]}'))
    out[key] = val2

json.dump(out, open('tools/zh_dict5.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('written entries:', len(out))
if problems:
    print('--- PROBLEMS', len(problems), '---')
    for i, msg in problems[:40]:
        print(i, msg)
else:
    print('no problems')
