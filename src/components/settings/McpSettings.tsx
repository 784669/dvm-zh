import { useState } from 'react';
import { copyText } from '../../lib/clipboard';
import {
  CLAUDE_DESKTOP_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  VSCODE_MCP_CONFIG,
  claudeCodeCommand,
  codexConfigToml,
  mcpServersJson,
  vscodeMcpJson,
} from '../../lib/mcpConfig';

type Client = 'desktop' | 'code' | 'codex' | 'gemini' | 'vscode' | 'other';

const CLIENTS: { key: Client; label: string }[] = [
  { key: 'desktop', label: 'Claude Desktop' },
  { key: 'code', label: 'Claude Code' },
  { key: 'codex', label: 'Codex CLI' },
  { key: 'gemini', label: 'Gemini CLI' },
  { key: 'vscode', label: 'VS Code' },
  { key: 'other', label: '其他应用' },
];

const HOWTO: Record<Client, string> = {
  desktop:
    `在 Claude Desktop 的 设置 → 开发者 → 「编辑配置」中 ${CLAUDE_DESKTOP_CONFIG} ，然后` +
    '请粘贴上面的内容并重启 Claude Desktop。' +
    '若已有 mcpServers，只需将 "dvm": { ... } 部分添加到其中',
  code:
    '请粘贴到 PowerShell 或命令提示符中执行。' +
    '之后运行 claude mcp list，若出现「dvm ... Connected」即成功',
  codex:
    `${CODEX_CONFIG} ，粘贴到末尾（文件不存在则新建）。` +
    '之后重新启动 codex 即可使用',
  gemini:
    `${GEMINI_CLI_CONFIG} ，粘贴进去（文件不存在则新建）。` +
    '之后重新启动 gemini，在 /mcp 中看到「dvm」即成功',
  vscode:
    `${VSCODE_MCP_CONFIG} ，粘贴进去` +
    '（也可通过命令面板的「MCP: Open User Configuration」打开）。' +
    '只有 VS Code 用的是 servers 格式而非 mcpServers，且需要指定 type',
  other:
    'Cursor·Cline·Windsurf 等支持 mcpServers 格式的 MCP 客户端可以使用相同设置。' +
    '请粘贴到各自的设置文件中并重启应用',
};

/**
 * JSON を貼り付けるクライアント共通の注意。
 * 中身が空でない設定文个継ぎ足すとき、直前の行のカンマを忘れるのが定番の事故で、
 * JSON が壊れると設定を読めずにアプリ自体が起動しなくなる(実際に踏んだので明記する)
 */
const JSON_CAVEAT =
  '若设置文件中已有内容，粘贴位置前一行末尾需要加逗号。' +
  '缺少逗号会破坏 JSON，导致 AI 应用启动时报错';

/** TOML はカンマの問題が無い代わりに、セクションの入れ子で事故る */
const TOML_CAVEAT =
  '若设置文件中已有 [mcp_servers.○○]，请把上面的段落原样添加到末尾。' +
  '若放入已有的段落内，会被当作其他服务器的配置读取';

export function McpSettings({
  exePath,
  allowWrite,
  onAllowWriteChange,
  libraryName,
}: {
  /** undefined は取得中。null は同梱されていない(この 2 つで出す文言が変わる) */
  exePath: string | null | undefined;
  allowWrite: boolean;
  onAllowWriteChange: (v: boolean) => void;
  /** いま開いている媒体库(v1.27)。設定を貼り直す必要が無いことを説明するために出す */
  libraryName?: string;
}) {
  const [client, setClient] = useState<Client>('desktop');
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  };

  const snippet = !exePath
    ? ''
    : client === 'code'
      ? claudeCodeCommand({ exePath, allowWrite })
      : client === 'codex'
        ? codexConfigToml({ exePath, allowWrite })
        : client === 'vscode'
          ? vscodeMcpJson({ exePath, allowWrite })
          : // Claude Desktop / Gemini CLI / 其他 は同じ mcpServers 形式
            mcpServersJson({ exePath, allowWrite });

  return (
    <div className="settings-section">
      <div className="settings-heading">MCP 联动(由外部 AI 操作)</div>
      <div className="settings-note">
        让 Claude Desktop 等 AI 应用直接搜索·整理媒体库。
        只需像「显示 20 个没有标签的视频」「给这个系列打分」这样对话即可。
        即使未启动 DVM 也能工作
      </div>
      <div className="settings-note">
        AI 看到的是<b>当前在 DVM 中打开的媒体库</b>
        {libraryName ? `（当前:「${libraryName}」）` : ''}。
        切换到其他媒体库时 AI 侧也会自动跟随，无需重新粘贴设置
      </div>

      {exePath === undefined ? null : !exePath ? (
        <div className="settings-note">
          找不到 MCP 服务器（dvm-mcp.exe）。若在开发环境中运行
          <code> npm run build:mcp </code>
          ，即会自动部署
        </div>
      ) : (
        <>
          <label className="modal-label">服务器位置</label>
          <div className="modal-row">
            <input readOnly value={exePath} title={exePath} />
            <button onClick={() => copy('path', exePath)}>
              {copied === 'path' ? '已复制' : '复制'}
            </button>
          </div>

          <label className="settings-check">
            <input
              type="checkbox"
              checked={allowWrite}
              onChange={(e) => onAllowWriteChange(e.target.checked)}
            />
            允许 AI 进行修改（标签·评分·系列的编辑）
          </label>
          <div className="settings-note">
            保持关闭时以只读方式打开数据库，AI 完全无法修改媒体库。
            即使开启，将文件送入回收站的操作也一定会先显示对象列表供确认
          </div>

          <label className="modal-label">要粘贴的设置</label>
          <div className="mcp-tabs">
            {CLIENTS.map((c) => (
              <button
                key={c.key}
                className={client === c.key ? 'mcp-tab active' : 'mcp-tab'}
                onClick={() => setClient(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <pre className="mcp-snippet">{snippet}</pre>
          <div className="modal-row">
            <button onClick={() => copy('snippet', snippet)}>
              {copied === 'snippet' ? '已复制' : '复制'}
            </button>
          </div>
          <div className="settings-note">{HOWTO[client]}</div>
          {client === 'codex' ? (
            <div className="settings-note warn">{TOML_CAVEAT}</div>
          ) : (
            client !== 'code' && <div className="settings-note warn">{JSON_CAVEAT}</div>
          )}
        </>
      )}
    </div>
  );
}
