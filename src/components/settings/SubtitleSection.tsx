import { useLibrary } from '../../store';
import { SubtitleStyleEditor } from '../SubtitleStyleEditor';

/**
 * 字幕样式(v1.24)。
 *
 * 中身は再生画面の字幕パネルと**同じコンポーネント**(`SubtitleStyleEditor` は状態を
 * 持たない)。store を直にバインドし、DB への書き込みだけ App.tsx が 400ms
 * デバウンスしてまとめる —— スライダーのドラッグ中に set_setting を毎フレーム叩くと
 * 取り込みワーカーとロックを取り合うため。
 */
export function SubtitleSection() {
  const subStyle = useLibrary((s) => s.subStyle);
  const setSubStyle = useLibrary((s) => s.setSubStyle);
  const resetSubStyle = useLibrary((s) => s.resetSubStyle);

  return (
    <div className="settings-section">
      <div className="settings-heading">字幕样式(应用内播放)</div>
      <div className="settings-note">
        播放中可通过控制栏的字幕按钮，一边看画面一边调整相同设置。
        对于需要转换后播放的格式（会转换为 mp4 的），字幕本身不会显示
      </div>
      <SubtitleStyleEditor value={subStyle} onChange={setSubStyle} onReset={resetSubStyle} />
    </div>
  );
}
