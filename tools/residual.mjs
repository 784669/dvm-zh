// 残差扫描：列出仍含日文的源码行（非测试文件），便于人工补译/核对
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.argv[2] || '.';
const RE_JP = /[぀-ヿ㐀-鿿豈-﫿]/;

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!['node_modules', 'dist', 'target', 'binaries', 'lib', 'icons', 'resources', '.git'].includes(e)) walk(p);
    } else {
      const ext = extname(p);
      if (['.ts', '.tsx', '.rs', '.json'].includes(ext) && !e.endsWith('.test.ts') && !e.endsWith('.test.tsx') && e !== 'dvm-mcp.rs') {
        files.push(p);
      }
    }
  }
}
walk(join(ROOT, 'src'));
walk(join(ROOT, 'src-tauri'));

let total = 0;
for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (RE_JP.test(ln)) {
      // 提取日文片段
      const m = ln.match(/[぀-ヿ㐀-鿿豈-﫿][぀-ヿ㐀-鿿豈-﫿\s、。！？：()，．（）「」…ー]*[぀-ヿ㐀-鿿豈-﫿]?/);
      const frag = m ? m[0] : '(见原行)';
      console.log(`${f.replace(ROOT + '/', '')}:${i + 1}\t${frag}`);
      total++;
    }
  }
}
console.error(`\n残存日文行(非测试, 不含 dvm-mcp): ${total}`);
