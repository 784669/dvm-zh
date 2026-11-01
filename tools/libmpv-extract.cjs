// 离线解压 libmpv 归档（不依赖网络）。
// 前提：src-tauri/lib/temp/ 下已放入两个归档文件（由 PowerShell 经代理下载）。
// 本脚本调用项目自带的 7z-wasm 解压，并把 libmpv-wrapper.dll 与 libmpv-2.dll 归位到 src-tauri/lib/。
const fs = require('fs');
const path = require('path');
const SevenZip = require('7z-wasm');

const TARGET_DIR = path.join(process.cwd(), 'src-tauri', 'lib');
const TEMP_DIR = path.join(TARGET_DIR, 'temp');

function findArchives(dir) {
  const res = [];
  if (!fs.existsSync(dir)) return res;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.')) continue;
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) continue;
    if (/\.(7z|zip|tar|tar\.gz|tgz|gz|xz)$/i.test(f)) res.push(fp);
  }
  return res;
}

async function extract(archivePath, extractDir) {
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  const archiveName = path.basename(archivePath);
  const archiveDir = path.dirname(archivePath);
  const sevenZip = await SevenZip({ print: () => {}, printErr: () => {} });
  const mountSrc = '/archive_source';
  const mountDest = '/archive_dest';
  sevenZip.FS.mkdir(mountSrc);
  sevenZip.FS.mkdir(mountDest);
  sevenZip.FS.mount(sevenZip.NODEFS, { root: archiveDir }, mountSrc);
  sevenZip.FS.mount(sevenZip.NODEFS, { root: extractDir }, mountDest);
  const vArchivePath = `${mountSrc}/${archiveName}`;
  try {
    sevenZip.callMain(['x', vArchivePath, `-o${mountDest}`, '-y']);
  } finally {
    try { sevenZip.FS.unmount(mountSrc); sevenZip.FS.unmount(mountDest); } catch (e) {}
  }
}

function findAndMove(searchDir, fileName, destDir) {
  function search(dir) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('.')) continue;
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (st.isDirectory()) { const r = search(full); if (r) return r; }
      else if (f === fileName) return full;
    }
    return null;
  }
  const found = search(searchDir);
  if (!found) throw new Error(`${fileName} not found in extracted files`);
  fs.renameSync(found, path.join(destDir, fileName));
  console.log(`  -> ${fileName} installed successfully.`);
}

(async () => {
  if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true });
  const archives = findArchives(TEMP_DIR);
  if (archives.length === 0) {
    console.error('No archives found in', TEMP_DIR);
    process.exit(1);
  }
  console.log('Archives to extract:', archives.map(a => path.basename(a)));
  for (const a of archives) {
    const exDir = path.join(TEMP_DIR, 'extract_' + path.basename(a, path.extname(a)));
    console.log('Extracting', path.basename(a) + '...');
    await extract(a, exDir);
  }
  console.log('Locating DLLs...');
  findAndMove(TEMP_DIR, 'libmpv-wrapper.dll', TARGET_DIR);
  findAndMove(TEMP_DIR, 'libmpv-2.dll', TARGET_DIR);
  console.log('Cleaning up temp...');
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (e) {}
  console.log('SUCCESS! Libraries are set up in src-tauri/lib');
})().catch(e => { console.error('Error:', e); process.exit(1); });
