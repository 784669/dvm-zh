// 应用翻译字典：对源码做"整串精确匹配"替换（保留占位符、引号、代码结构）
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pairs as p1 } from './dict.mjs';
import { pairs2 as p2 } from './dict2.mjs';

// 合并字典（后者覆盖前者；同键取后者）
const map = new Map();
for (const [k, v] of [...p1, ...p2]) {
  if (map.has(k) && map.get(k) !== v) {
    // 冲突提示
    console.warn(`⚠ 字典键冲突: ${JSON.stringify(k)} -> ${map.get(k)} / ${v}`);
  }
  map.set(k, v);
}
console.log(`字典条目: ${map.size}`);

// 字符串字面量正则（双/单/反引号）
const RE_STR = /(["'`])((?:\\.|(?!\1)[^])*?)\1/g;

// Rust 日志/调试行特征（这些行内的日文保留原文）
const RS_LOG = /\b(log::|eprintln|println!|println\(|dbg!|panic!|tracing::)/;

const ROOT = process.argv[2] || '.';
const SKIP_FILES = new Set(['dvm-mcp.rs']);

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!['node_modules', 'dist', 'target', 'binaries', 'lib', 'icons', 'resources', '.git'].includes(e)) walk(p);
    } else {
      const ext = extname(p);
      if (['.ts', '.tsx', '.rs', '.json'].includes(ext)) files.push(p);
    }
  }
}
walk(join(ROOT, 'src'));
walk(join(ROOT, 'src-tauri'));

let changedFiles = 0;
let totalReplacements = 0;
const log = [];

function replaceInText(text) {
  let n = 0;
  const out = text.replace(RE_STR, (m, q, inner) => {
    if (map.has(inner)) { n++; return q + map.get(inner) + q; }
    return m;
  });
  totalReplacements += n;
  return [out, n];
}

for (const f of files) {
  const base = f.split(/[\\/]/).pop();
  if (SKIP_FILES.has(base)) continue;
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }

  let out, n;
  if (extname(f) === '.rs') {
    // 逐行处理，跳过日志行
    const lines = content.split('\n');
    let cnt = 0;
    for (let i = 0; i < lines.length; i++) {
      if (RS_LOG.test(lines[i])) continue;
      const [nl, c] = replaceInText(lines[i]);
      lines[i] = nl; cnt += c;
    }
    out = lines.join('\n'); n = cnt;
  } else {
    [out, n] = replaceInText(content);
  }

  if (n > 0) {
    writeFileSync(f, out, 'utf8');
    changedFiles++;
    log.push(`${n}\t${f}`);
  }
}

console.log(`改动文件数: ${changedFiles}, 替换处: ${totalReplacements}`);
console.log('--- 各文件替换数 ---');
console.log(log.join('\n'));
