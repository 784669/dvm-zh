import { ask, open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, FolderPlus, FolderX, HardDriveDownload, Library, RefreshCw, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { LibraryEntry, LibraryState, LibraryStatus } from '../types';

/**
 * 媒体库を開けなかったときの画面(v1.27)。
 *
 * このとき DVM は**空の placeholder DB** で起動している。動画は 1 件も無く、
 * ここで监视文件夹を足したり已添加标签りできてしまうと、
 * ユーザーは「媒体库が消えた」と誤解して作り直しにかかる。
 * だから通常の UI ごと覆い隠して、復旧の道だけを出す。
 *
 * **「開けないから代わりに別の媒体库を打开」は絶対にしない。**
 * 普通に起動したように見えてしまい、違う媒体库に标签を付ける事故になる
 */
const HEADING: Record<LibraryStatus, { title: string; icon: typeof Library }> = {
  ok: { title: '', icon: Library },
  offline: { title: '无法连接到驱动器', icon: Unplug },
  missing: { title: '找不到媒体库', icon: FolderX },
  broken: { title: '无法读取媒体库', icon: FolderX },
  none: { title: '请选择媒体库', icon: Library },
};

export function LibraryUnavailable({ state }: { state: LibraryState }) {
  const [libraries, setLibraries] = useState<LibraryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const head = HEADING[state.status];
  const current = state.current;

  const reload = () => api.listLibraries().then(setLibraries);
  useEffect(() => {
    void reload();
  }, []);

  /** 切り替え(= 再起動)。**成功するとこの Promise は解決しない** */
  const switchTo = async (lib: LibraryEntry) => {
    setBusy(true);
    try {
      await api.switchLibrary(lib.id);
    } catch {
      setBusy(false); // 戻ってくるのは開けなかったときだけ(トーストは call() が出す)
    }
  };

  const createLibrary = async () => {
    const name = window.prompt('新媒体库名称');
    if (name === null || name.trim() === '') return;
    const parent = await open({
      directory: true,
      defaultPath: await api.defaultLibraryDir(),
      title: '选择存放媒体库的文件夹',
    });
    if (typeof parent !== 'string') return;
    await switchTo(await api.createLibrary(name.trim(), parent));
  };

  const addExisting = async () => {
    const root = await open({ directory: true, title: '选择媒体库文件夹' });
    if (typeof root !== 'string') return;
    await switchTo(await api.addExistingLibrary(root));
  };

  /** 从列表移除。ここでだけ「開こうとしていたもの」も外せる(外せないと詰む) */
  const forget = async (lib: LibraryEntry) => {
    const yes = await ask(
      `要将「${lib.name}」从列表中移除吗？\n\n`
        + '文件夹与文件不会被删除。\n'
        + `${lib.root} 会原样保留，之后可通过「打开现有媒体库」恢复。`,
      { title: '从列表移除' },
    );
    if (!yes) return;
    await api.forgetLibrary(lib.id);
    await reload();
  };

  return (
    <div className="library-unavailable">
      <div className="lu-card">
        <head.icon className="lu-icon" />
        <h1>{head.title}</h1>
        {state.message && <p className="lu-message">{state.message}</p>}
        {current && (
          <p className="lu-path" title={current.root}>
            {current.name} — {current.root}
          </p>
        )}

        {current && (
          <div className="lu-actions">
            <button disabled={busy} onClick={() => void switchTo(current)}>
              <RefreshCw />
              重新打开
            </button>
            <button disabled={busy} onClick={() => void forget(current)}>
              <FolderX />
              从列表移除
            </button>
          </div>
        )}

        {libraries.filter((l) => l.id !== current?.id).length > 0 && (
          <>
            <div className="lu-sep">打开其他媒体库</div>
            <ul className="lu-list">
              {libraries
                .filter((l) => l.id !== current?.id)
                .map((lib) => (
                  <li key={lib.id}>
                    <button
                      className="lu-lib"
                      disabled={busy || !lib.online}
                      title={lib.online ? lib.root : `${lib.root} 无法连接到`}
                      onClick={() => void switchTo(lib)}
                    >
                      {lib.online ? <Library /> : <Unplug />}
                      <span className="lu-lib-name">{lib.name}</span>
                      <span className="lu-lib-root">{lib.root}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}

        <div className="lu-actions">
          <button disabled={busy} onClick={() => void createLibrary()}>
            <FolderPlus />
            新建媒体库...
          </button>
          <button disabled={busy} onClick={() => void addExisting()}>
            <FolderOpen />
            打开现有媒体库...
          </button>
        </div>

        {state.status === 'broken' && current && (
          <p className="lu-note">
            <HardDriveDownload />
            从备份还原时，请从 {current.root}\backups 中选择
            并替换 library.db。
          </p>
        )}
      </div>
    </div>
  );
}
