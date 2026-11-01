import { useEffect, useRef, useState } from 'react';
import { ListOrdered, ListVideo } from 'lucide-react';
import { api } from '../api';
import { useShallow } from 'zustand/react/shallow';
import { pickState, useLibrary } from '../store';
import type { Series, Tag, TagCount, TagGroup } from '../types';
import { MediaInfoSection } from './MediaInfoSection';
import { QueuePanel } from './queue/QueuePanel';

/** 未分類标签をまとめる擬似群组 id(実群组の id は 1 以上) */
const UNGROUPED = 0;

/**
 * 選択中の動画の詳細と标签·系列·评分編集を行う右パネル。
 *
 * 文件操作(名前の変更·移動·削除)は置かない(v1.14) —
 * 一覧の右键菜单と Delete キーに一本化した。
 * 同じ操作の入口が 2 か所にあると、片方だけ直して挙動がずれる
 */
export function Inspector() {
  const {
    selection, version, bumpVersion, clearSelection, patchSelection,
    inspectorPinned, inspectorWidth, queueTabOpen, setQueueTabOpen,
  } = useLibrary(useShallow(pickState(
    'selection', 'version', 'bumpVersion', 'clearSelection', 'patchSelection',
    'inspectorPinned', 'inspectorWidth', 'queueTabOpen', 'setQueueTabOpen',
  )));
  const queueCount = useLibrary((s) => s.queue.items.length);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [paletteFilter, setPaletteFilter] = useState('');
  const [commonSeries, setCommonSeries] = useState<Series[]>([]);
  const [allSeries, setAllSeries] = useState<Series[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [seriesInput, setSeriesInput] = useState('');
  const [rating, setRatingLocal] = useState(0);
  const [titleDraft, setTitleDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  /** 保存済みの値。draft と比べて「変わったときだけ保存」を判定する(描画には使わない) */
  const savedInfo = useRef({ title: '', comment: '' });
  const [infoSaved, setInfoSaved] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  const ids = selection.map((v) => v.id);
  const idsKey = ids.join(',');
  const singleId = selection.length === 1 ? selection[0].id : null;

  // 标题·メモは 1 件選択のときだけ編集する。メモは一覧クエリに載せていないので
  // ここで別途引く(選択が変わったときだけ。version では読み直さない —
  // 編集中に再取得が走ると入力中の文字が消えるため)
  useEffect(() => {
    if (singleId == null) return;
    let alive = true;
    api
      .getVideoInfo(singleId)
      .then((info) => {
        // 選択を素早く切り替えたとき、古い応答が新しい選択の欄に入るのを防ぐ
        if (!alive) return;
        savedInfo.current = { title: info?.title ?? '', comment: info?.comment ?? '' };
        setTitleDraft(savedInfo.current.title);
        setCommentDraft(savedInfo.current.comment);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [singleId]);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  useEffect(() => {
    if (ids.length === 0) return;
    // 全選択で同じ评分ならそれを、バラバラなら 0 显示(これは手元の値なので即時)
    const ratings = new Set(selection.map((v) => v.rating));
    setRatingLocal(ratings.size === 1 ? selection[0].rating : 0);
    /*
     * 标签·系列の引き直しは 5 本の IPC になるので、
     * - 少し待ってから投げる(矢印キーの押しっぱなしで 1 選択ごとに 5 本飛ばさない)
     * - 古い応答は捨てる(getVideoInfo と同じ。遅れて届いた前の選択の結果が
     *   今の選択の表示を上書きして、**別の動画の标签が出る**のを防ぐ)
     */
    let alive = true;
    const timer = window.setTimeout(() => {
      api.tagCountsForVideos(ids).then((v) => alive && setTagCounts(v));
      api.listTags().then((v) => alive && setAllTags(v));
      api.listTagGroups().then((v) => alive && setTagGroups(v));
      api.seriesForVideos(ids).then((v) => alive && setCommonSeries(v));
      api.listSeries().then((v) => alive && setAllSeries(v));
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, version]);

  // 幅はドラッグで変えられる。min-width も同じ値にして、flex に縮められないようにする
  const style = { width: inspectorWidth, minWidth: inspectorWidth };

  /*
   * タブ(v1.40)。**队列を見ている間は标签付けの UI が見えない**が、
   * 队列を組み立てる作業と标签付けは別の作業なので許容している。
   * 队列タブを開いている間は選択が空でもペインを出す(判定は App.tsx)
   */
  const tabs = (
    <div className="inspector-tabs">
      <button
        className={queueTabOpen ? '' : 'active'}
        onClick={() => setQueueTabOpen(false)}
      >
        详细
      </button>
      <button
        className={queueTabOpen ? 'active' : ''}
        onClick={() => setQueueTabOpen(true)}
        title="播放队列（选中后按 Q 添加）"
        // カードをこのタブに落としても队列に入る(v1.41、C-5)。
        // パネルを開いていない状態からのドラッグの受け皿
        data-queue-dropzone
      >
        <ListVideo />
        队列
        {queueCount > 0 && <span className="tab-badge">{queueCount}</span>}
      </button>
    </div>
  );

  if (queueTabOpen) {
    return (
      <aside className="inspector" style={style}>
        {tabs}
        <QueuePanel />
      </aside>
    );
  }

  if (selection.length === 0) {
    // 固定表示していないときは従来どおり畳む
    if (!inspectorPinned) return null;
    // 固定中は枠だけ残す。评分や标签は選択が無いと操作できないので出さない
    return (
      <aside className="inspector" style={style}>
        {tabs}
        <div className="inspector-empty">选择视频后，详情会显示在此处</div>
      </aside>
    );
  }

  const single = selection.length === 1 ? selection[0] : undefined;

  const addTag = async () => {
    const name = tagInput.trim();
    if (!name) return;
    await api.tagVideos(ids, name);
    setTagInput('');
    bumpVersion();
  };

  // 選択中の動画のうち何个その标签が付いているか。0 = なし / ids.length = 全部 / 途中 = 一部
  const counts = new Map(tagCounts.map((c) => [c.tagId, c.count]));
  const commonTags = allTags.filter((t) => counts.get(t.id) === ids.length);

  /** パレットの点击。全部に付いていれば全部外し、そうでなければ全部に付ける */
  const togglePaletteTag = async (tag: Tag, count: number) => {
    try {
      if (count === ids.length) await api.untagVideos(ids, tag.id);
      else await api.tagVideos(ids, tag.name);
      bumpVersion();
    } catch {
      // call() がトーストを出す
    }
  };

  // 筛选後の标签を群组ごとに仕分ける。消えた群组を指す标签は未分類に落とす
  const needle = paletteFilter.trim().toLowerCase();
  const visibleTags = needle
    ? allTags.filter((t) => t.name.toLowerCase().includes(needle))
    : allTags;
  const knownGroups = new Set(tagGroups.map((g) => g.id));
  const byGroup = new Map<number, Tag[]>();
  for (const t of visibleTags) {
    const key = t.groupId != null && knownGroups.has(t.groupId) ? t.groupId : UNGROUPED;
    const list = byGroup.get(key) ?? [];
    list.push(t);
    byGroup.set(key, list);
  }

  const renderPaletteGroup = (key: number, label: string) => {
    const list = byGroup.get(key) ?? [];
    if (list.length === 0) return null;
    return (
      <div key={key} className="tag-palette-group">
        <div className="tag-palette-label">{label}</div>
        <div className="chip-list">
          {list.map((t) => {
            const count = counts.get(t.id) ?? 0;
            const state = count === 0 ? '' : count === ids.length ? 'on' : 'partial';
            return (
              <button
                key={t.id}
                className={`chip pick ${state}`}
                // 色付き标签は枠と文字色で示す(塗り潰すと文字が読みにくい色が出るため)。
                // 付いている状態は青で塗るので、そのときは色を上書きしない
                style={t.color && state === '' ? { borderColor: t.color, color: t.color } : undefined}
                title={
                  count === 0
                    ? `为 ${ids.length} 个添加「${t.name}」`
                    : count === ids.length
                      ? `移除「${t.name}」`
                      : `${count}/${ids.length} 个已添加（点击可全部添加）`
                }
                onClick={() => togglePaletteTag(t, count)}
              >
                {t.name}
                {state === 'partial' && <span className="chip-partial">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const addSeries = async () => {
    const name = seriesInput.trim();
    if (!name) return;
    await api.addToSeries(ids, name);
    setSeriesInput('');
    bumpVersion();
  };

  /**
   * 入力欄から離れたときの保存(v1.34)。値が変わっていなければ何もしない。
   * Rust 側も trim して空なら NULL にするので、比較する値もここで揃えておく
   */
  const saveInfo = async (field: 'title' | 'comment', draft: string) => {
    if (singleId == null) return;
    const value = draft.trim();
    if (value === savedInfo.current[field]) return;
    try {
      await api.setVideoInfo(singleId, { [field]: value });
    } catch {
      // call() がトーストを出す。savedInfo を進めないので、次に欄を離れたとき再送される
      return;
    }
    savedInfo.current = { ...savedInfo.current, [field]: value };
    if (field === 'title') {
      setTitleDraft(value);
      // 一覧やプレイヤーに出る名前も即差し替える(再取得を待たない)
      patchSelection({ title: value || null });
      bumpVersion();
    } else {
      setCommentDraft(value);
      // メモは一覧に出ないので再取得は要らない
    }
    setInfoSaved(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setInfoSaved(false), 1500);
  };

  const applyRating = async (value: number) => {
    const next = value === rating ? 0 : value;
    setRatingLocal(next);
    await api.setRating(ids, next);
    // 選択中の行データにも即時反映(再取得までの間に古い値へ戻るのを防ぐ)
    patchSelection({ rating: next });
    bumpVersion();
  };

  return (
    <aside className="inspector" style={style}>
      {tabs}
      <div className="inspector-head">
        <span>{single ? '详细' : `${selection.length} 件选择中`}</span>
        <button className="close" title="选择解除 (Esc)" onClick={clearSelection}>×</button>
      </div>

      {single && (
        <div className="inspector-info">
          <div className="info-name" title={single.path}>{single.title ?? single.filename}</div>
          <div className="info-path" title={single.path}>{single.path}</div>
          {single.width && single.height ? (
            <div className="info-sub">{single.width}×{single.height}</div>
          ) : null}
          <div className="info-sub">
            观看 {single.viewCount} 回
            {single.lastViewedAt ? `(最近: ${single.lastViewedAt})` : ''}
          </div>
          <div className="info-sub">添加日: {single.addedAt}</div>
        </div>
      )}

      {/*
        标题·メモ(v1.34)。入力欄から離れた時点で自動保存する。
        複数選択では出さない — 同じ标题を何个も一斉に付ける操作に意味が無いため
      */}
      {single && (
        <>
          <div className="side-section">
            标题·备注
            {infoSaved && <span className="side-note">已保存</span>}
          </div>
          <div className="info-edit">
            <input
              className="info-title-input"
              placeholder={single.filename}
              title="视频显示名称。留空则恢复为文件名"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => saveInfo('title', titleDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                else if (e.key === 'Escape') {
                  // 入力欄の Esc は「編集の取り消し」。選択解除(App.tsx)まで届かせない
                  e.stopPropagation();
                  setTitleDraft(savedInfo.current.title);
                }
              }}
            />
            <textarea
              className="info-comment-input"
              placeholder="备注（自由填写）"
              rows={3}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onBlur={() => saveInfo('comment', commentDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setCommentDraft(savedInfo.current.comment);
                }
              }}
            />
          </div>
        </>
      )}

      <div className="side-section">评分</div>
      <div className="stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`star ${n <= rating ? 'on' : ''}`}
            title={`★${n}（再次点击同一星级可取消）`}
            onClick={() => applyRating(n)}
          >
            {n <= rating ? '★' : '☆'}
          </button>
        ))}
      </div>

      <div className="side-section">标签</div>
      <div className="chip-list">
        {commonTags.map((t) => (
          <span
            key={t.id}
            className="chip"
            // 色付き标签は枠と文字色で示す(塗り潰すと文字が読みにくい色が出るため)
            style={t.color ? { borderColor: t.color, color: t.color } : undefined}
          >
            {t.name}
            <button onClick={() => api.untagVideos(ids, t.id).then(bumpVersion)} title="移除这个标签">×</button>
          </span>
        ))}
        {commonTags.length === 0 && <span className="chip-empty">无标签</span>}
      </div>

      {/*
        标签パレット(v1.19)。既存标签を群组別に並べ、点击で選択中の動画にまとめて付ける。
        标签名を覚えていなくても押すだけで付けられるのが狙い。
        标签が増えても縦に伸び続けないよう、高さ上限を付けて中だけスクロールさせている
      */}
      {allTags.length > 0 && (
        <div className="tag-palette">
          <input
            className="tag-palette-filter"
            placeholder="筛选标签"
            value={paletteFilter}
            onChange={(e) => setPaletteFilter(e.target.value)}
          />
          <div className="tag-palette-body">
            {tagGroups.map((g) => renderPaletteGroup(g.id, g.name))}
            {renderPaletteGroup(UNGROUPED, '未分類')}
            {visibleTags.length === 0 && (
              <span className="chip-empty">没有与「{paletteFilter}」匹配的标签</span>
            )}
          </div>
        </div>
      )}

      <div className="tag-add">
        <input
          list="all-tags"
          placeholder="添加标签后按 Enter"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTag();
          }}
        />
        <datalist id="all-tags">
          {allTags.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </div>

      <div className="side-section">系列</div>
      <div className="chip-list">
        {commonSeries.map((s) => (
          <span key={s.id} className="chip">
            <ListOrdered size={13} />
            {s.name}
            <button
              onClick={() => api.removeFromSeries(ids, s.id).then(bumpVersion)}
              title="从该系列中移除"
            >
              ×
            </button>
          </span>
        ))}
        {commonSeries.length === 0 && <span className="chip-empty">无系列</span>}
      </div>
      <div className="tag-add">
        <input
          list="all-series"
          placeholder="添加到系列后按 Enter"
          value={seriesInput}
          onChange={(e) => setSeriesInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addSeries();
          }}
        />
        <datalist id="all-series">
          {allSeries.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
      </div>

      {/*
        展開すると縦に長くなるので一番下に置く(评分·标签の位置がずれない)。
        複数選択では出さない — ffprobe を選択数だけ起動することになるため
      */}
      {single && <MediaInfoSection video={single} />}

      {!single && (
        <div className="inspector-note">修改将应用于所选的全部视频</div>
      )}
    </aside>
  );
}
