"""Apply translations using ONLY keys that are complete UI units.

Fragment keys (e.g. bare words extracted by the earlier weak extractor) caused
half-Japanese/half-Chinese hybrids, so they are discarded: every UI unit now has
a full-sentence translation, and replacing longest-first leaves no residue.
"""
import json, glob, os, re
from jp_scan import collect

ROOT = 'src'
SKIP = {'node_modules', 'dist', 'target', '.git'}

# 1) unit set from pristine source
per_file = collect(ROOT)
units = set()
for us in per_file.values():
    for u in us:
        s = u.strip()
        if s:
            units.add(s)
print('units:', len(units))

# 2) merge dictionaries, strip keys, keep only whole-unit keys
d = {}
dropped = []
for fp in sorted(glob.glob('tools/zh_dict[0-9]*.json')):
    for k, v in json.load(open(fp, encoding='utf-8')).items():
        ks = k.strip()
        if not ks:
            continue
        if ks in units:
            # prefer the longest-source / last definition; values are consistent
            d.setdefault(ks, v)
        else:
            dropped.append(ks)
print('kept entries:', len(d), 'dropped fragment keys:', len(dropped))
print('units without translation:', len(units - set(d)))
for u in sorted(units - set(d))[:20]:
    print('  NOTR:', u.replace('\n', '\\n')[:80])

# 3) apply longest-first
keys = sorted(d.keys(), key=len, reverse=True)
repl = 0
files_changed = 0
for dp, _, fs in os.walk(ROOT):
    if any(s in SKIP for s in dp.split(os.sep)):
        continue
    for fn in fs:
        if not (fn.endswith('.ts') or fn.endswith('.tsx')) or '.test.' in fn:
            continue
        p = os.path.join(dp, fn)
        txt = open(p, encoding='utf-8').read()
        new = txt
        for jp in keys:
            if jp in new:
                repl += new.count(jp)
                new = new.replace(jp, d[jp])
        if new != txt:
            open(p, 'w', encoding='utf-8').write(new)
            files_changed += 1
print('replacements:', repl, 'files changed:', files_changed)
