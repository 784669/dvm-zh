# DVM 中文版 · Windows 一键构建脚本
# ============================================================
# 前置条件（需本机已安装）：
#   1. Rust 工具链（stable-x86_64-pc-windows-msvc）
#   2. Visual Studio Build Tools 2022 + “使用 C++ 的桌面开发” 工作负载
#   3. Windows 10/11 SDK
#   4. WebView2 运行时（Win11 自带；Win10 若缺失安装器会自动处理）
#   —— NSIS 由 Tauri 打包器自动下载，无需手动安装。
#
# 用法（在 PowerShell 中执行）：
#   powershell -ExecutionPolicy Bypass -File tools/build-zh.ps1
#
# 说明：本脚本已对源码完成日文 UI 文本 -> 简体中文的翻译（见 tools/dict*.mjs）。
#       运行后会产出 NSIS 安装包 DVM_1.43.0_x64-setup.exe。

$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root
Write-Host "构建根目录: $root"

# ---------------------------------------------------------------
# 防御性处理：清除“小写”代理环境变量。
# 沙箱/企业网络中常同时写入 http_proxy 与 HTTP_PROXY（大小写重复），
# 会导致 .NET 系工具（如 VS 安装器）在拼环境变量时崩溃（错误 0x80070057 / 退出码 5002）。
# 仅清除小写版，大写版 HTTP_PROXY / HTTPS_PROXY 保留，代理仍生效。
# ---------------------------------------------------------------
foreach ($v in @('http_proxy', 'https_proxy', 'all_proxy', 'ftp_proxy', 'no_proxy')) {
  [System.Environment]::SetEnvironmentVariable($v, $null, [System.EnvironmentVariableTarget]::Process)
}

# 把 cargo 加入当前进程 PATH
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }

function Step($msg) {
  Write-Host "`n========== $msg ==========" -ForegroundColor Cyan
}

Step '1/4  npm install（安装前端与 Tauri 依赖）'
npm install
if ($LASTEXITCODE -ne 0) { Write-Error 'npm install 失败'; exit 1 }

Step '2/4  下载同梱 FFmpeg / ffprobe（scripts/fetch-ffmpeg.ps1）'
powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg.ps1
if ($LASTEXITCODE -ne 0) { Write-Error 'fetch-ffmpeg 失败'; exit 1 }

Step '3/4  下载同梱 libmpv（tauri-plugin-libmpv-api setup-lib）'
npx tauri-plugin-libmpv-api setup-lib
if ($LASTEXITCODE -ne 0) { Write-Error 'setup-lib 失败'; exit 1 }

Step '4/4  构建前端 + Rust，并打包 NSIS 安装包（npm run tauri build）'
npm run tauri build
if ($LASTEXITCODE -ne 0) { Write-Error 'tauri build 失败'; exit 1 }

Step '构建完成 ✅'
$nsisDir = Join-Path $root 'src-tauri\target\release\bundle\nsis'
Write-Host "安装包目录: $nsisDir"
Get-ChildItem $nsisDir -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host ("  -> " + $_.FullName)
}
