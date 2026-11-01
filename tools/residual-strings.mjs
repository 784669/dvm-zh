// 仅统计真实源码(src + src-tauri)中剩余的日文"字符串字面量"，排除 dvm-mcp.rs / 测试 / tools
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.argv[2] || '.';
const RE_JP = /[぀-ヿ㐀-鿿豈-﫿]/;
const RE_KANA = /[぀-ヿ]/;
const RE_STR = /(["'`])((?:\\.|(?!\1).)*)\1/g;
const SKIP = new Set(['dvm-mcp.rs']);

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!['node_modules', 'dist', 'target', 'binaries', 'lib', 'icons', 'resources', '.git', 'tools'].includes(e)) walk(p);
    } else {
      const ext = extname(p);
      if (['.ts', '.tsx', '.rs', '.json'].includes(ext) && !e.endsWith('.test.ts') && !e.endsWith('.test.tsx') && !SKIP.has(e)) {
        files.push(p);
      }
    }
  }
}
walk(join(ROOT, 'src'));
walk(join(ROOT, 'src-tauri'));

const uniq = new Map();
let occ = 0;
for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  // .rs: 跳过日志行
  const lines = content.split('\n');
  const isRs = extname(f) === '.rs';
  RE_STR.lastIndex = 0;
  let m;
  while ((m = RE_STR.exec(content)) !== null) {
    const inner = m[2];
    if (!RE_JP.test(inner)) continue;
    const idx = m.index;
    const lineNo = content.slice(0, idx).split('\n').length;
    if (isRs && /(log::|eprintln|println!|println\(|dbg!|panic!|tracing::)/.test(lines[lineNo - 1])) continue;
    occ++;
    if (!uniq.has(inner)) uniq.set(inner, { count: 0, kana: RE_KANA.test(inner), files: new Set() });
    const u = uniq.get(inner);
    u.count++; u.files.add(f.replace(ROOT + '/', ''));
  }
}
const arr = [...uniq.entries()].map(([t, v]) => ({ text: t, count: v.count, kana: v.kana, files: [...v.files] }));
arr.sort((a, b) => b.count - a.count);
console.log(`剩余日文字符串字面量(真实源码): 唯一 ${arr.length}, 出现 ${occ}`);
console.log('--- 按出现次数排序（前 120）---');
for (const u of arr.slice(0, 120)) {
  console.log(`${String(u.count).padStart(3)} | ${u.text}`);
}
