import re, os, json

ROOT = 'src'
SKIP = {'node_modules', 'dist', 'target'}
KANA = r'[぀-んァ-ヶｦ-ﾟ]'

# JSX text node across newlines (no < > { } inside). DOTALL lets it span lines.
jsx_re = re.compile(r'>\s*([^<>{}]*?' + KANA + r'[^<>{}]*?)\s*<', re.DOTALL)
# plain string literal
str_re = re.compile(r'["\']([^"\']*' + KANA + r'[^"\']*)["\']')
# template literal (backtick) may contain ${...}
tmpl_re = re.compile(r'`([^`]*' + KANA + r'[^`]*)`')

inv = {}
for dp, _, fs in os.walk(ROOT):
    if any(s in SKIP for s in dp.split(os.sep)):
        continue
    for fn in fs:
        if not (fn.endswith('.ts') or fn.endswith('.tsx')):
            continue
        if '.test.' in fn:
            continue
        p = os.path.join(dp, fn)
        try:
            lines = open(p, encoding='utf-8').readlines()
        except Exception:
            continue
        for i, line in enumerate(lines, 1):
            s = line.strip()
            if s.startswith('//') or s.startswith('*') or s.startswith('/*') or '{/*' in line:
                continue
            code = line.split('//')[0]
            for m in jsx_re.finditer(code):
                t = m.group(1).strip()
                if t:
                    inv.setdefault(p, []).append({'line': i, 'kind': 'jsx', 'text': t})
            for m in str_re.finditer(code):
                inv.setdefault(p, []).append({'line': i, 'kind': 'str', 'text': m.group(1)})
            for m in tmpl_re.finditer(code):
                inv.setdefault(p, []).append({'line': i, 'kind': 'tmpl', 'text': m.group(1)})

os.makedirs('tools', exist_ok=True)
with open('tools/jp_residual.json', 'w', encoding='utf-8') as f:
    json.dump(inv, f, ensure_ascii=False, indent=1)

# unique (dedup, keep files)
uniq = {}
for f, items in inv.items():
    for it in items:
        uniq.setdefault(it['text'], []).append(f)
with open('tools/residual_unique.json', 'w', encoding='utf-8') as f:
    json.dump({k: uniq[k] for k in sorted(uniq)}, f, ensure_ascii=False, indent=1)

# report
with open('tools/residual_report.md', 'w', encoding='utf-8') as f:
    for p, items in sorted(inv.items()):
        f.write(f"## {p} ({len(items)})\n")
        for it in items:
            f.write(f"  L{it['line']} [{it['kind']}] {it['text']}\n")

print("residual files:", len(inv))
print("residual unique:", len(uniq))
