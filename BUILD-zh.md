# DVM 中文增强版构建指南（Windows）

本项目是 GitHub 上的 **DVM (Demodemo Video Manager)** 的**非官方简体中文分支**（基于上游 v1.43.0）：
源码中所有面向用户的日文 UI 文本（菜单、按钮、对话框、提示、统计、设置等）已翻译为
简体中文；MCP / AI 接口描述与程序日志保持原文（便于排查）。本指南说明如何把它编译成
`DVM-zh_1.43.0_x64-setup.exe` 安装包。

- 技术栈：Tauri 2 + React 19 + TypeScript（前端 GUI） + Rust / cargo（后端） + SQLite +
  libmpv（应用内播放） + 同梱 FFmpeg / ffprobe（GPLv3 构建）。
- 许可证：**GPL-3.0-or-later**（因同梱 GPL 版 FFmpeg / libmpv）。

---

## 一、环境要求（缺一不可）

| 组件 | 说明 | 验证命令 |
|---|---|---|
| Node.js | 18+（含 npm） | `node -v` |
| Rust 工具链 | **MSVC 目标**：`stable-x86_64-pc-windows-msvc` | `cargo --version` |
| Visual Studio Build Tools 2022 | 工作负载“使用 C++ 的桌面开发”（含 MSVC v143） | 见下方 |
| Windows 10 / 11 SDK | 提供 Windows 导入库与头文件 | 见下方 |
| WebView2 运行时 | Win11 自带；Win10 若缺失，安装器会自动安装 | `winget list Microsoft.WebView2Runtime` |

> NSIS 由 Tauri 打包器在构建时**自动下载**预编译的 `makensis`，无需手动安装。

### 安装 Rust（MSVC）
```powershell
# 下载并运行 rustup-init，选择默认（MSVC）即可
# 或显式指定：
rustup toolchain install stable-x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
```

### 安装 VS Build Tools + Windows SDK
```powershell
# 下载引导器后用 --quiet 静默安装；务必包含 C++ 工作负载与 Windows SDK
vs_BuildTools.exe --wait --quiet --norestart `
  --add Microsoft.VisualStudio.Workload.VCTools `
  --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  --add Microsoft.VisualStudio.Component.Windows11SDK.22621 `
  --includeRecommended
```
图形界面安装：启动 Visual Studio Installer → “使用 C++ 的桌面开发” → 右侧勾选“Windows 11 SDK”。

---

## 二、⚠️ 已知坑：代理环境变量导致 VS 安装器 / 部分 .NET 工具崩溃（退出码 5002）

**现象**：运行 VS 安装器后立即退出，日志出现
`Error 0x80070057: Couldn't launch setup process ... 字典中的关键字:"http_proxy" 所添加的关键字:"HTTP_PROXY"`。

**原因**：不少沙箱 / 企业网络会**同时**写入小写 `http_proxy` 与大写 `HTTP_PROXY`。
Windows 的环境变量名大小写不敏感，.NET 的 `ProcessStartInfo.EnvironmentVariables` 在合并时
遇到重复键直接抛异常。

**修复**（在安装 / 构建前执行一次，仅清小写版，大写代理保留、网络不受影响）：
```powershell
foreach ($v in @('http_proxy','https_proxy','all_proxy','ftp_proxy','no_proxy')) {
  [System.Environment]::SetEnvironmentVariable($v, $null, 'Process')
}
```
本仓库的 `tools/build-zh.ps1` 已内置该修复，无需手动操作。

---

## 三、构建方式

### 方式 A：一键脚本（推荐）
```powershell
powershell -ExecutionPolicy Bypass -File tools/build-zh.ps1
```

### 方式 B：手动分步（便于定位问题）
```powershell
# 0. 清代理重复键（见第二节），并把 cargo 加入 PATH
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# 1. 前端依赖
npm install

# 2. 同梱 FFmpeg / ffprobe -> src-tauri/binaries/
powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg.ps1

# 3. 同梱 libmpv -> src-tauri/lib/
npx tauri-plugin-libmpv-api setup-lib

# 4. 构建并打包（beforeBuildCommand 会自动先构建 MCP 服务端 dvm-mcp.exe，再 vite 构建）
npm run tauri build
```

### 构建顺序说明
`npm run tauri build` 会先执行 `beforeBuildCommand = "npm run build:mcp && npm run build"`：
1. `build:mcp` → `cargo build --bin dvm-mcp --release` → 产出 `src-tauri/binaries/dvm-mcp.exe`；
2. `build` → `tsc && vite build` → 产出 `dist/`；
3. cargo 编译主程序（MSVC 链接）；
4. 打包器校验 `bundle.resources`（ffmpeg.exe / ffprobe.exe / dvm-mcp.exe / lib/** / resources/*）
   并生成 NSIS 安装包。

---

## 四、构建产物

```
src-tauri/target/release/bundle/nsis/DVM-zh_1.43.0_x64-setup.exe
src-tauri/target/release/bundle/msi/DVM-zh_1.43.0_x64_zh-CN.msi
```

安装包元数据已中文化（`tauri.conf.json` 的 `shortDescription` / `longDescription`），
安装语言固定为简体中文（NSIS / WiX 均只保留 SimpChinese / zh-CN）。
产品名是 `DVM-zh`、identifier 是 `jp.demo2.dvm.zh`，与官方版是**两个独立应用**，可以并装。

---

## 五、安装与运行

- 双击 `DVM-zh_1.43.0_x64-setup.exe` 安装。
- 若出现 **“Windows 已保护你的电脑”**（SmartScreen，因无代码签名证书）：
  点击 **“详细信息” → “仍要运行”** 继续。可用 Releases 页附带的 SHA-256 校验完整性：
  ```powershell
  Get-FileHash .\DVM-zh_1.43.0_x64-setup.exe
  ```
- 数据（数据库 / 缩略图）默认保存在
  `%APPDATA%\jp.demo2.dvm.zh\libraries\我的媒体库`，视频文件本身不会被移动或复制。
- 首次启动若检测到官方版的数据目录 `%APPDATA%\jp.demo2.dvm`，会复制库索引并改写路径
  （`core/datadir.rs`），原目录保留不动。迁移只做一次，之后两个应用各管各的索引。
- **不要用两个版本同时打开同一个库文件夹**：SQLite 会加锁，标签与评分也会各改各的。

---

## 六、翻译范围与质量

- **已翻译**：所有用户可见 UI 文本（组件 `.tsx`、Rust 后端面向用户的提示与统计文案），
  约 570 处、覆盖 54 个文件，词表 491 条。
- **未翻译（刻意保留）**：`dvm-mcp.rs` 的 MCP 接口描述与协议文本、程序日志
  （`log::` / `eprintln!` / `println!` / `tracing::`）、样本数据（如 `C:\動画`、`旅行` 等示例
  库路径）、字体名、文件路径、代码注释。
- **验证**：前端纯函数测试 `npm run test` 全部通过（564 项）；`cargo test` 覆盖核心逻辑
  与迁移逻辑。占位符（`${...}`、`\n`）、引号与 JSX 结构在回写时已逐条校验未被破坏。

> 如需调整某条译文，编辑 `tools/dict.mjs` / `tools/dict2.mjs` 后重跑
> `node tools/apply-translate.mjs` 即可重新回写。
