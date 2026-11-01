"""Lexer-assisted extractor for user-visible Japanese UI text.

Strategy:
 1. Walk the file char-by-char, masking out // and /* */ comments (never UI text).
 2. Capture string literal contents ('...', "...", `...`) containing kana.
 3. Capture JSX text nodes from masked text (">text<"), including multi-line nodes.
 4. Keep {expr} / ${expr} interpolations INSIDE the unit so the translation can be
    written as natural Chinese with the same placeholders. Only complex JSX-brace
    content forces a split (then fragments with <2 kana are dropped).
"""
import json, os, re, sys

KANA = re.compile(r'[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9f]')
KANAISH = re.compile(r'[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uff66-\uff9f]')

SKIP_DIRS = {'node_modules', 'dist', 'target', '.git'}
EXTS = ('.ts', '.tsx')

# a "simple" interpolation: identifiers, member access, calls, literals, ternaries
SIMPLE_EXPR = re.compile(r'^[\sA-Za-z0-9_$.\'\"\[\]()?:!+\-*/<>=,%|&]*$')


def mask_comments(src):
    n = len(src)
    out = list(src)
    literals = []
    i = 0
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            if j == -1:
                j = n
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
            quote = c
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == quote:
                    break
                j += 1
            literals.append(src[i + 1:j])
            for k in range(i, min(j + 1, n)):
                if out[k] != '\n':
                    out[k] = ' '
            i = j + 1
        else:
            i += 1
    return ''.join(out), literals


BRACE = re.compile(r'\$\{[^}]*\}|\{[^{}]*\}')


def braces_simple(text):
    for m in BRACE.finditer(text):
        inner = m.group(0)[1:-1]
        if not SIMPLE_EXPR.match(inner):
            return False
    return True


def kana_count(s):
    return len(KANAISH.findall(s))


def split_chunks(text):
    """Split on braces, keep chunks with >=2 japanese chars."""
    res = []
    buf = []
    depth = 0
    i = 0
    while i < len(text):
        c = text[i]
        if c == '{' and i + 1 < len(text) and text[i + 1] == '$' or c == '{':
            # consume to matching }
            depth = 1
            j = i + 1
            while j < len(text) and depth:
                if text[j] == '{':
                    depth += 1
                elif text[j] == '}':
                    depth -= 1
                j += 1
            buf.append(text[i:j])
            i = j
            continue
        buf.append(c)
        i += 1
    joined = ''.join(buf)
    for part in re.split(r'(\$\{[^}]*\}|\{[^{}]*\})', joined):
        if part and not BRACE.fullmatch(part):
            if kana_count(part) >= 2:
                res.append(part)
    return res


def has_visible(unit):
    s = unit.strip()
    if not s or not KANA.search(s):
        return False
    if kana_count(s) < 2:
        return False
    bad = ['=>', '===', '!==', '&&', '||', 'function ', 'return ', 'import ',
           'console.', 'useState', 'className=', 'props.']
    for b in bad:
        if b in s:
            return False
    return True


def scan_file(path):
    src = open(path, encoding='utf-8').read()
    masked, literals = mask_comments(src)
    units = []

    for content in literals:
        if not content or not KANA.search(content):
            continue
        if '\\' in content:
            continue  # escaped sequences handled in a manual pass
        if braces_simple(content):
            if has_visible(content):
                units.append(content)
        else:
            units.extend(x for x in split_chunks(content) if has_visible(x))

    for m in re.finditer(r'>([^<>]*)<', masked, re.S):
        text = m.group(1)
        if not KANA.search(text):
            continue
        if braces_simple(text):
            if has_visible(text):
                units.append(text)
        else:
            units.extend(x for x in split_chunks(text) if has_visible(x))

    return units


def collect(root='src'):
    per_file = {}
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if not fn.endswith(EXTS) or '.test.' in fn:
                continue
            p = os.path.join(dp, fn)
            u = scan_file(p)
            if u:
                per_file[p] = u
    return per_file


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else 'src'
    per_file = collect(root)
    all_units = [u for us in per_file.values() for u in us]
    counter = {}
    for u in all_units:
        counter[u] = counter.get(u, 0) + 1
    uniq = sorted(counter.items(), key=lambda kv: len(kv[0]), reverse=True)
    print('files with kana UI text:', len(per_file))
    print('units total:', len(all_units), 'unique:', len(uniq))
    json.dump({k: v for k, v in uniq}, open('tools/jp_units.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    with open('tools/jp_units_report.md', 'w', encoding='utf-8') as f:
        for p in sorted(per_file):
            f.write(f'\n## {p} ({len(set(per_file[p]))})\n')
            for u in sorted(set(per_file[p]), key=len, reverse=True):
                f.write('- ' + u.replace('\n', '\\n') + '\n')
    print('wrote tools/jp_units.json / tools/jp_units_report.md')
