import json, os, glob, re

ROOT = 'src'
SKIP = {'node_modules', 'dist', 'target'}

d = {}
for fp in sorted(glob.glob('tools/zh_dict*.json')):
    part = json.load(open(fp, encoding='utf-8'))
    d.update(part)
    print(f'{fp}: {len(part)}')

# KEY FIX: longest keys first, so long sentences are replaced before short prefixes
keys = sorted(d.keys(), key=len, reverse=True)
print('dict entries:', len(d))

repl = 0
files_changed = 0
for dp, _, fs in os.walk(ROOT):
    if any(s in SKIP for s in dp.split(os.sep)):
        continue
    for fn in fs:
        if not (fn.endswith('.ts') or fn.endswith('.tsx')):
            continue
        if '.test.' in fn:
            continue
        p = os.path.join(dp, fn)
        txt = open(p, encoding='utf-8').read()
        new = txt
        for jp in keys:
            zh = d[jp]
            if not jp:
                continue
            if jp in new:
                cnt = new.count(jp)
                new = new.replace(jp, zh)
                repl += cnt
        if new != txt:
            open(p, 'w', encoding='utf-8').write(new)
            files_changed += 1

print('replacements:', repl)
print('files changed:', files_changed)

# scan residual kana in non-comment code lines
KANA = r'[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9f]'
left = []
for dp, _, fs in os.walk(ROOT):
    if any(s in SKIP for s in dp.split(os.sep)):
        continue
    for fn in fs:
        if not (fn.endswith('.ts') or fn.endswith('.tsx')):
            continue
        if '.test.' in fn:
            continue
        p = os.path.join(dp, fn)
        for i, line in enumerate(open(p, encoding='utf-8').readlines(), 1):
            s = line.strip()
            if s.startswith('//') or s.startswith('*') or s.startswith('/*') or s.startswith('{/*'):
                continue
            if re.search(KANA, line):
                left.append(f"{p}:{i}: {s}")
print('remaining non-comment kana lines:', len(left))
for x in left[:200]:
    print(x)
