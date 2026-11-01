import re, os, json

ROOT = 'src'
SKIP_DIRS = {'.git', 'node_modules', 'dist', 'target', 'target_tmp'}
KANA = r'[぀-んァ-ヶｦ-ﾟ]'
jsx_re = re.compile(r'>([^<>{}]*' + KANA + r'[^<>{}]*)<')
str_re = re.compile(r'["\'`]([^"\'`]*' + KANA + r'[^"\'`]*)["\'`]')

inventory = {}  # file -> [ {line,kind,text} ]
for dp, _, fs in os.walk(ROOT):
    parts = dp.split(os.sep)
    if any(s in SKIP_DIRS for s in parts):
        continue
    for fn in fs:
        if not (fn.endswith('.ts') or fn.endswith('.tsx')):
            continue
        if '.test.' in fn:
            continue
        p = os.path.join(dp, fn)
        try:
            with open(p, encoding='utf-8') as fh:
                lines = fh.readlines()
        except Exception:
            continue
        for i, line in enumerate(lines, 1):
            s = line.strip()
            # skip pure comment lines
            if s.startswith('//') or s.startswith('*') or s.startswith('/*') or '{/*' in line:
                continue
            # crude: drop trailing line comment so we don't catch quoted text inside a comment
            code = line.split('//')[0]
            for m in jsx_re.finditer(code):
                inventory.setdefault(p, []).append({'line': i, 'kind': 'jsx', 'text': m.group(1)})
            for m in str_re.finditer(code):
                inventory.setdefault(p, []).append({'line': i, 'kind': 'str', 'text': m.group(1)})

os.makedirs('tools', exist_ok=True)
with open('tools/jp_ui_inventory.json', 'w', encoding='utf-8') as f:
    json.dump(inventory, f, ensure_ascii=False, indent=1)

report = []
total = 0
for p, items in sorted(inventory.items()):
    total += len(items)
    report.append(f"## {p}  ({len(items)} 处)")
    for it in items:
        report.append(f"  L{it['line']} [{it['kind']}] {it['text']}")
with open('tools/jp_ui_report.md', 'w', encoding='utf-8') as f:
    f.write('\n'.join(report))

print("文件数:", len(inventory))
print("总条数:", total)
