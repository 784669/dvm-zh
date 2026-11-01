// 扫描源码中含日文(平假名/片假名/汉字)的字符串字面量，输出分布统计
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.argv[2] || '.';
const OUT = process.argv[3] || 'tools/ja-strings.json';

const EXT_WANT = new Set(['.ts', '.tsx', '.rs', '.json', '.toml']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', 'binaries', 'lib', 'icons']);

// 平假名、片假名、CJK 汉字(含扩展)
const RE_JP = /[぀-ヿ㐀-鿿豈-﫿]/;
const RE_KANA = /[぀-ヿ]/;
// 粗略排除纯英文/路径/URL/标识符
const RE_SKIP = /^(https?:\/\/|\\|\/|\.\.?[\/\\]|[A-Za-z0-9_./\\-]+$)/;

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(e)) walk(p);
    } else if (EXT_WANT.has(extname(p))) {
      files.push(p);
    }
  }
}
walk(ROOT);

// 匹配字符串字面量：双引号、单引号、反引号
const RE_STR = /(["'`])((?:\\.|(?!\1).)*)\1/g;

const results = [];
let kanaCount = 0;
let totalFilesWith = 0;
const perFile = {};
for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  let m;
  RE_STR.lastIndex = 0;
  // 逐行定位
  const lineStarts = [];
  let acc = 0;
  for (const ln of lines) { lineStarts.push(acc); acc += ln.length + 1; }
  while ((m = RE_STR.exec(content)) !== null) {
    const raw = m[0];
    const inner = m[2];
    if (!RE_JP.test(inner)) continue;
    if (RE_SKIP.test(inner.trim())) continue;
    // 定位行号
    const idx = m.index;
    let lineNo = 1;
    for (let i = 0; i < lineStarts.length; i++) {
      if (idx >= lineStarts[i] && (i + 1 >= lineStarts.length || idx < lineStarts[i + 1])) { lineNo = i + 1; break; }
    }
    const hasKana = RE_KANA.test(inner);
    if (hasKana) kanaCount++;
    results.push({ file: f, line: lineNo, kana: hasKana, text: inner });
  }
  const cnt = results.filter(r => r.file === f).length;
  if (cnt > 0) { perFile[f] = cnt; totalFilesWith++; }
}

// 唯一字符串(用于翻译去重)
const uniq = {};
for (const r of results) {
  const key = r.text;
  if (!uniq[key]) uniq[key] = { count: 0, kana: r.kana, files: new Set() };
  uniq[key].count++;
  uniq[key].files.add(r.file);
}
const uniqArr = Object.entries(uniq).map(([t, v]) => ({ text: t, count: v.count, kana: v.kana, files: [...v.files] }));
uniqArr.sort((a, b) => b.count - a.count);

const summary = {
  scannedFiles: files.length,
  filesWithJapanese: totalFilesWith,
  totalStringOccurrences: results.length,
  occurrencesWithKana: kanaCount,
  uniqueStrings: uniqArr.length,
  uniqueWithKana: uniqArr.filter(u => u.kana).length,
};

writeFileSync(OUT, JSON.stringify({ summary, perFile, uniq: uniqArr, all: results }, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log('\n--- 含日文最多的前 15 个文件 ---');
Object.entries(perFile).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([f,c])=>console.log(`${c}\t${f}`));
