# DVM 中文增强版（DVM-zh）

[![CI](https://github.com/784669/dvm-zh/actions/workflows/ci.yml/badge.svg)](https://github.com/784669/dvm-zh/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/784669/dvm-zh?label=release)](https://github.com/784669/dvm-zh/releases/latest)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-lightgrey)](#下载与安装)

> **这是非官方分支。** 本项目基于 [demodemo / DVM (Demodemo Video Manager)](https://github.com/demodemo0818/dvm)
> v1.43.0 修改而来，原始著作权归原作者 **demodemo** 所有，继续遵循 **GPL-3.0-or-later**。
> 本仓库与上游官方项目没有隶属关系，也不代表原作者的意见或背书。
> 修改内容与日期见下文「[本分支的改动](#本分支的改动)」及 [CHANGELOG-zh.md](CHANGELOG-zh.md)。

DVM 是一款 Windows 上的视频管理软件：**不复制、不移动视频文件**，片子留在原来的位置，
用缩略图、标签、系列、评分在 SQLite 里建立索引。外接硬盘和 NAS 上的几万个视频也能直接管理。

![主界面](docs/images/main.png)

> 截图取自上游版本，界面文本在本分支中已全部汉化为简体中文。

- 缩略图网格（虚拟化，几万条也不卡）
- 标签 / 标签组 / 系列 / 评分 / 智能文件夹 / 播放列表
- 应用内播放（libmpv）、悬停预览、观看历史与断点续播
- 重复检测、丢失文件检测与重新链接
- 内置 MCP 服务器，可用 Claude Desktop / Claude Code 等 AI 客户端检索与整理库

## 本分支的改动

| 项目 | 官方 DVM | DVM-zh |
|---|---|---|
| 界面语言 | 日文 | **简体中文**（约 570 处、54 个文件全量汉化）|
| 悬停预览 | 悬停即自动播放 | **点播放按钮才播**，滚动列表不再白白转码 |
| 预览画质 | 单一档位 | **三档可调**，持久缓存，可手动清理 |
| 预览控制 | 只有播放 | 固定进度条（加载 / 播放双层）、点击跳转、**倍速 X1→X2→X4→X8** |
| 预览并发 | — | **同时只转码一个**，点新的自动停旧的 |
| 预览旋转 | — | **顺时针 / 逆时针 90° 写回源文件**，带圆环进度；MKV 等不支持的容器会拒绝并提示 |
| 应用标识 | `jp.demo2.dvm` | `jp.demo2.dvm.zh`（**可与官方版并存**）|
| 数据目录 | `%APPDATA%\jp.demo2.dvm` | `%APPDATA%\jp.demo2.dvm.zh`（首次启动自动迁移）|

旋转采用**改写容器 display matrix、不重新编码**的方式，几秒完成且不掉画质；代价是只对
MP4 / MOV 一类容器有效，MKV、AVI、WMV 会直接提示「无法同步修改源文件」而不是硬转。

## 下载与安装

到 [Releases](../../releases/latest) 下载最新的 `DVM-zh_x.y.z_x64-setup.exe` 运行即可。
FFmpeg 与 MCP 服务器都已同捆，不需要另外准备。

> **提示「Windows 已保护你的电脑」**：因为没有购买代码签名证书，SmartScreen 会拦截。
> 点「更多信息」→「仍要运行」。可用 Release 页附带的 SHA-256 校验安装包完整性：
>
> ```powershell
> Get-FileHash .\DVM-zh_1.43.0_x64-setup.exe
> ```

系统要求：Windows 10 / 11 64 位；WebView2 运行时（Windows 11 自带，缺失时安装器会自动装）。

## 首次启动与旧数据迁移

如果你之前装过官方版 DVM，第一次启动 DVM-zh 时会自动执行一次迁移：

1. 把 `%APPDATA%\jp.demo2.dvm` 下的 `app.db` 与 `libraries\` 复制到 `%APPDATA%\jp.demo2.dvm.zh`
2. 改写库记录里的绝对路径，指向新目录
3. 原目录**保持不动**，官方版可以继续用

迁移只在「新目录还没有 app.db」时发生一次。之后两个版本的库索引各自独立演进。

> 如果迁移失败，程序会照常启动并显示空库，日志里会打印原因；此时可以用侧边栏的
> 「打开已有库」手动指向原来的库文件夹。

## 与官方版共存

两个版本的库索引互相独立，但**指向的是同一批视频文件**。DVM 对视频文件只读（旋转功能
是唯一的例外，且只在你主动点击时才会写），所以同时安装不会破坏素材。

需要注意：**不要用两个版本同时打开同一个库文件夹**。SQLite 会加锁，而且两边的标签、
评分会各改各的。要用官方版的库，就让 DVM-zh 用迁移出来的副本。

## 从源码构建

完整步骤见 [BUILD-zh.md](BUILD-zh.md)。简版：

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg.ps1   # 取 FFmpeg / ffprobe
npx tauri-plugin-libmpv-api setup-lib                                # 取 libmpv
npm run build:mcp                                                    # 构建 MCP 服务器
npm run tauri build                                                  # 出安装包
```

要求 Node 18+、Rust（MSVC 工具链）、Visual Studio Build Tools 2022（C++ 桌面开发工作负载）
与 Windows SDK。中文路径下构建可能遇到 MSVC 环境探测问题，`BUILD-zh.md` 里有说明。

| 命令 | 作用 |
|---|---|
| `npm run tauri dev` | 开发模式（前端热更新 + Rust 自动重编译）|
| `npm run tauri build` | 出安装包（自动先构建 MCP 服务器）|
| `npm run test` | 前端纯函数测试（vitest）|
| `cd src-tauri && cargo test` | 后端与核心逻辑测试 |

## 汉化是怎么做的

`tools/` 里保留了完整的汉化工具链，可复现，不是一次性手工替换：

| 脚本 | 作用 |
|---|---|
| `jp_scan.py` / `extract_jp.py` | 扫描 `.tsx` / `.rs` 里的日文字符串，导出清单 |
| `kanji_scan.py` | 按汉字出现率识别残留日文 |
| `dict.mjs` / `zh_dict5.json` | 日→中词条映射（491 条）|
| `apply_zh.py` / `apply-translate.mjs` | 按清单回写译文，保留占位符与 JSX 结构 |
| `residual_strings.mjs` | 复查残留日文并出报告（`*_report.md`）|

未翻译的部分是刻意保留的：MCP 接口描述与协议文本、日志输出、代码注释、字体名与示例路径。
它们不影响界面观感，翻成中文反而会让排查问题和对接 AI 客户端变难。

## 已知限制

- 只提供 Windows x64 构建，macOS / Linux 未经测试
- 旋转仅支持能写入 display matrix 的容器（MP4 / MOV），其它容器会明确拒绝
- 安装包未做代码签名，首次运行会被 SmartScreen 拦截
- 与上游的界面结构保持一致，未做布局改动，方便日后合并上游更新

## 许可与致谢

- 本分支：**GPL-3.0-or-later**，见 [LICENSE](LICENSE)
- 原始项目：Copyright (C) 2026 **demodemo** — <https://github.com/demodemo0818/dvm>
- 同捆的 FFmpeg（GPL 构建）与 libmpv（动态链接）版权归各自权利人，
  版本与源码获取方式见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
- 上游日文 README 原件保留在 [README.upstream.ja.md](README.upstream.ja.md)

本项目**完全没有担保**。整理视频库属于会改动文件的操作，重要素材请先自行备份。
