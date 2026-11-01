import { ask, message, open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useLibrary } from '../../store';
import type { AppInfo, ExcludedPath, LibraryEntry } from '../../types';

/**
 * 媒体库の管理(v1.27)と、监视文件夹の中で取り込まない場所(v1.33)。
 *
 * どちらも「媒体库に何が入るか」の管理で、どちらも**文件は消さない**ことを
 * 文言で言い切る必要がある操作なので、同じカテゴリに置いている。
 *
 * ここが持つのは**名前の変更と一覧からの削除**だけ。切り替えの入口は侧边栏の
 * 上部に固定する(同じ操作の入口を 2 か所に置かない)。
 */
export function LibrarySection({ info }: { info: AppInfo | null }) {
  const [libraries, setLibraries] = useState<LibraryEntry[]>([]);
  const [excluded, setExcluded] = useState<ExcludedPath[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listLibraries().then(setLibraries).catch(() => {});
    api.listExcludedPaths().then(setExcluded).catch(() => {});
  }, []);

  /** 名前を変える。文件夹名は変えない(開いている最中に動かせないため) */
  const renameLibrary = async (lib: LibraryEntry) => {
    const name = window.prompt('新媒体库名称', lib.name);
    if (name === null || name.trim() === '' || name.trim() === lib.name) return;
    await api.renameLibrary(lib.id, name.trim());
    setLibraries(await api.listLibraries());
    // 侧边栏のボタンの表示を追従させる
    useLibrary.getState().bumpVersion();
  };

  /** 从列表移除。**文件は消さない**ことを文言で必ず言い切る */
  const forgetLibrary = async (lib: LibraryEntry) => {
    const yes = await ask(
      `要将「${lib.name}」从列表中移除吗？\n\n`
        + '文件夹与文件不会被删除。\n'
        + `${lib.root} 会原样保留，之后可通过「打开现有媒体库」恢复。`,
      { title: '从列表移除' },
    );
    if (!yes) return;
    await api.forgetLibrary(lib.id);
    setLibraries(await api.listLibraries());
    useLibrary.getState().bumpVersion();
  };

  /**
   * 监控排除文件夹を足す。监视文件夹の中の文件夹を選ぶのが本来の使い方なので、
   * ここでは监视文件夹かどうかの検査はしない(外を選んでも害は無い)
   */
  const addExclude = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择监视排除文件夹',
    });
    if (typeof selected !== 'string') return;
    const alsoRemove = await ask(
      `${selected} 的下级将不再从后续扫描中导入。\n\n` +
        '是否同时移除当前已在媒体库中的其下视频？\n' +
        '选择「否」则保留在列表中，但今后不再新增。\n\n' +
        '无论选择哪一项，都不会删除视频文件。',
      { title: '注册到监控排除文件夹' },
    );
    setBusy(true);
    try {
      const removed = await api.addExcludedPaths([selected], alsoRemove);
      setExcluded(await api.listExcludedPaths());
      useLibrary.getState().bumpVersion();
      if (removed > 0) {
        await message(`${removed.toLocaleString()} 项已从媒体库移除（文件仍保留）`, {
          title: '注册到监控排除文件夹',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  /** 取消监视排除する。該当文件は次のスキャンで取り込まれる */
  const removeExclude = async (id: number, path: string) => {
    const yes = await ask(
      `要将 ${path} 从监视排除中取消吗？\n\n下次扫描时相关视频将重新登记到媒体库。`,
      { title: '取消监视排除' },
    );
    if (!yes) return;
    await api.removeExcludedPath(id);
    setExcluded(await api.listExcludedPaths());
  };

  return (
    <>
      <div className="settings-section">
        <div className="settings-heading">媒体库</div>
        <div className="settings-note">
          每个媒体库分别管理视频·标签·系列·监视文件夹。
          外观与 API 密钥等设置不会随切换而改变。
          请通过侧边栏上方的媒体库名进行切换
        </div>
        <ul className="library-list">
          {libraries.map((lib) => {
            const isCurrent = lib.id === info?.libraryId;
            return (
              <li key={lib.id} className={isCurrent ? 'current' : ''}>
                <div className="library-list-main">
                  <span className="library-list-name">
                    {lib.name}
                    {isCurrent && <span className="library-badge">已打开</span>}
                    {!lib.online && <span className="library-badge warn">未接続</span>}
                  </span>
                  <span className="library-list-root" title={lib.root}>{lib.root}</span>
                </div>
                <div className="library-list-actions">
                  <button onClick={() => renameLibrary(lib)}>重命名...</button>
                  <button onClick={() => api.openLibraryDir(lib.id)} disabled={!lib.online}>
                    打开文件夹
                  </button>
                  <button
                    onClick={() => forgetLibrary(lib)}
                    disabled={isCurrent}
                    title={
                      isCurrent
                        ? '无法移除当前打开的媒体库（请先切换到其他媒体库）'
                        : '文件夹与文件不会被删除'
                    }
                  >
                    从列表移除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="settings-section">
        <div className="settings-heading">监控排除文件夹</div>
        <div className="settings-note">
          即使在监视文件夹内，此处添加的文件夹及其下级也不会被扫描导入。
          可用于按代备份、临时导出目录等不想出现在媒体库中的位置。
          删除视频时登记的单个文件行也会列在这里。
          <strong>不会删除视频文件。</strong>
        </div>
        {excluded.length > 0 && (
          <ul className="excluded-list">
            {excluded.map((e) => (
              <li key={e.id}>
                <span className="excluded-path" title={e.path}>{e.path}</span>
                {/* 消し残しがあるときだけ件数を出す(0 を並べても意味が無い) */}
                {e.videoCount > 0 && (
                  <span
                    className="excluded-count"
                    title="排除后仍留在列表中的注册数量。即排除时未移除的部分"
                  >
                    列表中还剩 {e.videoCount.toLocaleString()} 项
                  </span>
                )}
                <button onClick={() => removeExclude(e.id, e.path)}>解除</button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-row">
          <button onClick={addExclude} disabled={busy}>选择文件夹并添加...</button>
        </div>
        <div className="settings-note">
          也可右键侧边栏的文件夹树添加
        </div>
      </div>
    </>
  );
}
