import { saveStoreFlag, useTextSetting } from '../../hooks/useSetting';
import { useLibrary } from '../../store';

/**
 * 一覧の見た目(v1.38 で「再生」起分けた)。
 *
 * カードの标签行 / 系列行は**カードの高さを変える**設定で、再生とは関係が無い。
 * 详细列表の列と 1 行おきの濃淡は**ここに置かない** —— 入口は列ヘッダの列ピッカーで、
 * あちらはリスト表示のときしか開けないぶん「設定が効く場所と操作する場所」が一致する
 * (DESIGN.md「详细列表」節)。
 *
 * カード幅·グリッド/リストの切り替え·详情面板の固定も置かない(入口はツールバー)。
 */
export function DisplaySection() {
  const previewOnHover = useLibrary((s) => s.previewOnHover);
  const setPreviewOnHover = useLibrary((s) => s.setPreviewOnHover);
  const previewQuality = useTextSetting('preview_quality', { defaultValue: '360p' });
  const cardTags = useLibrary((s) => s.cardTags);
  const setCardTags = useLibrary((s) => s.setCardTags);
  const cardSeries = useLibrary((s) => s.cardSeries);
  const setCardSeries = useLibrary((s) => s.setCardSeries);

  return (
    <div className="settings-section">
      <div className="settings-heading">显示</div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={cardTags}
          onChange={(e) => saveStoreFlag('card_tags', setCardTags, e.target.checked)}
        />
        在网格卡片上显示标签
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={cardSeries}
          onChange={(e) => saveStoreFlag('card_series', setCardSeries, e.target.checked)}
        />
        在网格卡片上显示系列
      </label>
      <div className="settings-note">
        详细列表显示的列与隔行底色，请在列表视图下从列标题的齿轮中选择
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={previewOnHover}
          onChange={(e) => saveStoreFlag('preview_on_hover', setPreviewOnHover, e.target.checked)}
        />
        在卡片上显示预览播放按钮（点击播放降码预览）
      </label>
      <div className="settings-note">
        点击按钮后，对该视频做一次降码转码（默认 360p）并播放，之后直接读取缓存；
        只有在「数据」设置中清理预览缓存时才会删除。左右移动鼠标仍可跳转场景
      </div>
      <label className="modal-label" style={{ marginTop: 12 }}>预览画质</label>
      <div className="modal-row">
        <select
          value={previewQuality.value}
          onChange={(e) => previewQuality.save(e.target.value)}
        >
          <option value="360p">360p · CRF32（最省资源）</option>
          <option value="480p">480p · CRF30（均衡）</option>
          <option value="720p">720p · CRF28（更清晰）</option>
        </select>
      </div>
      <div className="settings-note">
        降码预览的分辨率与码率。切换后旧画质的缓存会成为孤儿文件，
        在「数据」设置中清理预览缓存即可一并清除
      </div>
    </div>
  );
}
