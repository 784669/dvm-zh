// 生成待翻译候选：排除"仅出现在 dvm-mcp.rs(MCP/AI 接口)"的字符串
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('tools/ja-strings.json', 'utf8'));
const MCP = 'src-tauri/src/bin/dvm-mcp.rs';

const cand = [];
for (const u of data.uniq) {
  const onlyMcp = u.files.length > 0 && u.files.every(f => f === MCP);
  if (onlyMcp) continue;
  cand.push(u);
}
cand.sort((a, b) => b.count - a.count);

// 输出便于人工翻译的纯文本清单（每行：出现次数 | 原文）
const lines = cand.map(u => `${String(u.count).padStart(3)} | ${u.text}`);
writeFileSync('tools/candidates.txt', lines.join('\n'), 'utf8');
writeFileSync('tools/candidates.json', JSON.stringify(cand, null, 2), 'utf8');
console.log(`候选唯一字符串: ${cand.length} (已排除 MCP-only: ${data.uniq.length - cand.length})`);
console.log(`候选总出现次数: ${cand.reduce((s,u)=>s+u.count,0)}`);
console.log('前 40 条预览:');
console.log(lines.slice(0, 40).join('\n'));
