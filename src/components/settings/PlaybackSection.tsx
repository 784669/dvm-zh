import { open } from '@tauri-apps/plugin-dialog';
import { saveStoreFlag, useTextSetting } from '../../hooks/useSetting';
import { useLibrary } from '../../store';

/**
 * 再生まわり(v1.38 でカードの表示設定を「表示」へ移した)。
 *
 * シークバーのコマ出しはカードのホバープレビューとは**別設定**にしてある ——
 * こちらは再生中に同じ動画をもう 1 本デコードするので、外付け HDD の大きい文件で
 * 本編がカクつくなら単独で切りたい(DESIGN.md 参照)。
 */
export function PlaybackSection() {
  const storePlayerPath = useLibrary((s) => s.playerPath);
  const setStorePlayerPath = useLibrary((s) => s.setPlayerPath);
  const seekPreview = useLibrary((s) => s.seekPreview);
  const setSeekPreview = useLibrary((s) => s.setSeekPreview);
  const autoplayNext = useLibrary((s) => s.autoplayNext);
  const setAutoplayNext = useLibrary((s) => s.setAutoplayNext);
  const hdrPassthrough = useLibrary((s) => s.hdrPassthrough);
  const setHdrPassthrough = useLibrary((s) => s.setHdrPassthrough);

  /**
   * 外部プレイヤーのパス。テキストなので打っている途中では書かず、フォーカスが
   * 外れたとき(と閉じたとき)に DB と store の両方へ入れる。
   * store は起動時に App.tsx が読んでいるので、初期値はそこからもらって読み直さない
   */
  const playerPath = useTextSetting('player_path', {
    initial: storePlayerPath,
    onCommit: setStorePlayerPath,
  });

  const browsePlayer = async () => {
    const selected = await open({
      multiple: false,
      title: '选择外部播放器的可执行文件',
      filters: [{ name: '可执行文件', extensions: ['exe'] }],
    });
    // ダイアログで選んだ値は確定済みなので、blur を待たずに書く
    if (typeof selected === 'string') playerPath.save(selected);
  };

  return (
    <div className="settings-section">
      <div className="settings-heading">播放</div>
      <label className="modal-label">
        外部播放器（留空则用 Windows 默认播放器打开）
      </label>
      <div className="modal-row">
        <input
          value={playerPath.value}
          placeholder="例: C:\\Program Files\\mpv\\mpv.exe"
          onChange={(e) => playerPath.edit(e.target.value)}
          onBlur={playerPath.commit}
        />
        <button onClick={browsePlayer}>浏览...</button>
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={seekPreview}
          onChange={(e) => saveStoreFlag('seek_preview', setSeekPreview, e.target.checked)}
        />
        播放中将光标移到进度条上时显示该位置的画面（较重视频出现卡顿时请关闭）
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={autoplayNext}
          onChange={(e) => saveStoreFlag('autoplay_next', setAutoplayNext, e.target.checked)}
        />
        播完后进入下一个视频（按列表顺序。也可用 ⏭ / N 键）
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={hdrPassthrough}
          /* store に入れた瞬間 useMpvPlayer が setProperty で押し込む(再生中でも切り替わる) */
          onChange={(e) => saveStoreFlag('hdr_passthrough', setHdrPassthrough, e.target.checked)}
        />
        启用 HDR 直通
      </label>
      <div className="settings-note">
        HDR 直通仅在 HDR 显示器且已开启 Windows HDR 时生效。
        关闭时会照旧转换为 SDR 显示（仅应用内播放）。
        切换后若无变化，请重启应用
      </div>
    </div>
  );
}
