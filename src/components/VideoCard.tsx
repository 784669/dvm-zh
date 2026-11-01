import { convertFileSrc } from '@tauri-apps/api/core';
import { ListOrdered, TriangleAlert, Play, Pause, RotateCw, RotateCcw } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { fmtSize, fmtTime } from '../lib/format';
import { chipBudget } from '../lib/grid';
import { thumbSrc } from '../lib/thumbs';
import { startRotate, useRotateTask } from '../lib/rotateTasks';
import { clearActivePreview, setActivePreview, useActivePreview } from '../lib/activePreview';
import { api } from '../api';
import { useLibrary } from '../store';
import { HoverPreview } from './HoverPreview';
import type { VideoRowProps } from './rowProps';

// プレビューの再生ボタンで開始する(ホバー自動再生は廃止)
//
// 回転ボタンは**源文件の表示方向を書き換える**(MP4/MOV の display matrix のみ・再エンコードなし)。
// 表示側で角度を持たないので、以前のバージョンが残した localStorage の角度は使わない。
// 源文件を書き換えたあとは、その残骸を消して「次回プレビューで二重に回る」のを防ぐ
const rotateKey = (id: number) => `dvm.preview.rotate.${id}`;

// 进度圆环的周长(r=20)
const RING_LEN = 2 * Math.PI * 20;

function clearSavedRotate(id: number) {
  try {
    localStorage.removeItem(rotateKey(id));
  } catch {
    // localStorage が使えない環境では何もしない
  }
}

/**
 * memo 化(A-4): 可視カードは数十枚あるので、スキャン中の status 更新や
 * 選択移動のたびに全カードを描き直さない。コールバック(onPick / onPlay /
 * onContextMenu)は VideoGrid 側が useCallback で安定させている前提
 */
export const VideoCard = memo(function VideoCard({
  video, labels, index, selected, focused, onPick, onPlay, onContextMenu, cardW,
}: VideoRowProps & { cardW: number }) {
  const previewOnHover = useLibrary((s) => s.previewOnHover);
  const cardTags = useLibrary((s) => s.cardTags);
  const cardSeries = useLibrary((s) => s.cardSeries);
  const menuOpen = useLibrary((s) => s.contextMenuOpen);
  const thumbVersion = useLibrary((s) => s.thumbVersion);
  const [showPreview, setShowPreview] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // 降码缓存的生成进度(null = 已用上完整缓存，不再轮询)。正在生成时先把原文件播起来
  const [buildPct, setBuildPct] = useState<number | null>(null);
  const usingOriginal = useRef(false);
  // 旋转任务的全局镜像(后端持有本体)。钩子必须在 video 判空之前调用
  const rotateTask = useRotateTask(video?.id ?? 0);
  const rotating = rotateTask?.state === 'running';
  const rotatePct = rotateTask?.progress ?? 0;
  // 全画面で再生中のプレビューは 1 枚だけ。ほかのカードがアクティブになったら自ら止まる
  const activePreview = useActivePreview();

  // 仮想化で同じカードが別の動画に使い回されたときにプレビューを引きずらない
  useEffect(() => {
    setShowPreview(false);
    setPreviewSrc(null);
    setPreviewLoading(false);
    setBuildPct(null);
    usingOriginal.current = false;
  }, [video?.id]);

  // 降码缓存还在生成中：轮询后端进度，生成完就把播放源换成缓存（保留播放位置）
  useEffect(() => {
    if (!showPreview || !previewSrc || buildPct === null) return;
    const id = video?.id;
    if (!id) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      void api
        .previewStatus(id)
        .then((st) => {
          if (disposed) return;
          if (st.ready) {
            usingOriginal.current = false;
            setBuildPct(null);
            setPreviewSrc(convertFileSrc(st.path));
          } else {
            setBuildPct(st.progress);
          }
        })
        .catch(() => {
          // 瞬时失败无所谓，下一拍再问
        });
    }, 800);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [showPreview, previewSrc, buildPct === null, video?.id]);

  // ほかの動画のプレビューが始まったら自分のを止める。
  // previewSrc も捨てる:バックエンドが旧転码を kill して部分的なキャッシュを
  // 削除している可能性が高く、古いパスを再利用すると壊れた映像をつかむ
  useEffect(() => {
    if (activePreview && video && activePreview !== video.id) {
      setShowPreview(false);
      setPreviewSrc(null);
      setBuildPct(null);
      usingOriginal.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreview, video?.id]);

  // 旋转完成后停掉当前预览:文件已换新,旧降码片也已被后端作废
  useEffect(() => {
    if (rotateTask && rotateTask.state !== 'running') {
      setShowPreview(false);
      setPreviewSrc(null);
      setBuildPct(null);
      usingOriginal.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotateTask?.state, video?.id]);

  // 右键菜单を開いたらプレビューを止める。
  // メニューの裏で動画が鳴り続けるのを防ぐ(v1.14)
  useEffect(() => {
    if (menuOpen && video) {
      setShowPreview(false);
      clearActivePreview(video.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  if (!video) return <div className="card card-loading" />;

  const openable = !video.isMissing && !video.isOffline;

  // プレビュー再生ボタン。
  // キャッシュが**既に完成**していればそれを直接再生（秒開・省 CPU）。
  // まだ生成中なら**元ファイルで即座に再生を始め**、進捗バーに生成％を出しながら
  // 完成を待ち、完成したら同じ位置のまま降码キャッシュへ切り替える
  const togglePreview = async () => {
    if (showPreview) {
      // 手動停止。転码はバックグラウンドで完走させてキャッシュを作る
      setShowPreview(false);
      clearActivePreview(video.id);
      return;
    }
    if (previewSrc) {
      // 一度開いたものをもう一度開く。原ファイルで流していたなら完成を確認する
      if (usingOriginal.current) {
        void api
          .previewStatus(video.id)
          .then((st) => {
            if (st.ready) {
              usingOriginal.current = false;
              setBuildPct(null);
              setPreviewSrc(convertFileSrc(st.path));
            } else {
              setBuildPct(st.progress);
            }
          })
          .catch(() => {});
      }
      setShowPreview(true);
      setActivePreview(video.id);
      return;
    }
    setPreviewLoading(true);
    try {
      const st = await api.preparePreview(video.id);
      if (st.ready) {
        usingOriginal.current = false;
        setBuildPct(null);
        setPreviewSrc(convertFileSrc(st.path));
      } else {
        // 生成中：先播原文件（稳定、可跳转、点开就有画面），别把还在长大的
        // 缓存文件塞给 <video>——那正是「一直转圈、最后什么都没有」的原因
        usingOriginal.current = true;
        setBuildPct(st.progress);
        setPreviewSrc(convertFileSrc(video.path));
      }
    } catch {
      // 后端不可用（ffmpeg 缺失等）时退回原文件
      usingOriginal.current = false;
      setBuildPct(null);
      setPreviewSrc(convertFileSrc(video.path));
    } finally {
      setPreviewLoading(false);
      // ここでバックエンドが前の動画の転码を kill しているので、
      // アクティブ枠を奪ってほかのカードに停止を伝える
      setActivePreview(video.id);
      setShowPreview(true);
    }
  };

  // 源文件の表示方向を 90 度回す(MP4/MOV のみ・再エンコードなし)。
  // 実処理はバックグラウンドタスク。成功/失敗のトーストは rotateTasks の
  // ポーリング層で出すので、ここでは起動だけ。成功したらプレビューは
  // 上の effect が止め、次に再生したとき新しい向きで作り直す
  const rotateSource = (d: 'cw' | 'ccw') => {
    if (rotating) return;
    // 旧バージョンが表示角度を localStorage に置いていたので掃除しておく
    clearSavedRotate(video.id);
    startRotate(video.id, d);
  };

  return (
    <div
      className={`card ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}`}
      title={video.path}
      // 队列パネルへの D&D の掴み先(v1.41、C-5)。VideoGrid が委譲で拾う
      data-grid-index={index}
      onClick={(e) => onPick(video, index, e)}
      onDoubleClick={() => onPlay(video, index)}
      onContextMenu={(e) => onContextMenu(video, index, e)}
    >
      <div className="thumb">
        {/*
          一覧クエリでは缩略图の実在確認をしていない(I/O 削減)。
          読めなかった img は onError で隠し、下の `.thumb` の地色を見せる。

          **読み込み待ちの「…」は出さない**(v1.32) —— img は lazy 読み込みなので、
          スクロールするたび画面じゅうのカードで「…」が一瞬出ては消えて目障りだった。
          地色のままでも「まだ出ていない」ことは分かる。
          生成に失敗したものだけは地色と区別が付かないので警告アイコンを残す
        */}
        {video.thumbState === 2 && (
          <div className="thumb-placeholder">
            <TriangleAlert size={22} />
          </div>
        )}
        {video.thumbPath && (
          <img
            key={video.id}
            src={thumbSrc(convertFileSrc(video.thumbPath), thumbVersion)}
            loading="lazy"
            alt=""
            draggable={false}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
            // 再生成に成功して読めるようになったら戻す(onError で隠しっぱなしにしない)
            onLoad={(e) => {
              e.currentTarget.style.display = '';
            }}
          />
        )}
        {previewOnHover && openable && !rotating && (
          <>
            {/*
              预览中把按钮挪到右上角：底部要留给固定进度条(时间 + 进度 + 倍速)，
              卡片宽度最小到 140px 时三个按钮会横跨整条底边，必定压住进度条
            */}
            <button
              type="button"
              className={`preview-toggle preview-rotate-ccw${showPreview ? ' on-top' : ''}`}
              title="逆时针旋转 90°（写入源文件，仅支持 MP4/MOV）"
              onClick={() => rotateSource('ccw')}
            >
              <RotateCcw size={17} />
            </button>
            <button
              type="button"
              className={`preview-toggle preview-rotate${showPreview ? ' on-top' : ''}`}
              title="顺时针旋转 90°（写入源文件，仅支持 MP4/MOV）"
              onClick={() => rotateSource('cw')}
            >
              <RotateCw size={17} />
            </button>
            <button
              type="button"
              className={`preview-toggle${showPreview ? ' on-top' : ''}`}
              title={showPreview ? '停止预览' : '播放降码预览'}
              onClick={togglePreview}
              disabled={previewLoading}
            >
              {previewLoading ? (
                <span className="preview-spinner" />
              ) : showPreview ? (
                <Pause size={18} />
              ) : (
                <Play size={18} />
              )}
            </button>
          </>
        )}
        {previewOnHover && openable && rotating && (
          <button
            type="button"
            className="preview-toggle"
            disabled
            title={`正在写入旋转信息 ${Math.round(rotatePct)}%`}
          >
            <span className="preview-spinner" />
          </button>
        )}
        {rotating && (
          <div className="rotate-progress" title={`正在写入旋转信息 ${Math.round(rotatePct)}%`}>
            <div className="rotate-progress-box">
              <svg viewBox="0 0 48 48" width="52" height="52">
                <circle className="ring-bg" cx="24" cy="24" r="20" />
                <circle
                  className="ring-fg"
                  cx="24"
                  cy="24"
                  r="20"
                  strokeDasharray={RING_LEN}
                  strokeDashoffset={RING_LEN * (1 - Math.min(Math.max(rotatePct, 0), 100) / 100)}
                />
              </svg>
              <span className="pct">{Math.round(rotatePct)}%</span>
            </div>
          </div>
        )}
        {showPreview && previewSrc && (
          <HoverPreview
            key={video.id}
            src={previewSrc}
            durationMs={video.durationMs}
            progress={buildPct}
          />
        )}
        {/* プレビュー中は「現在位置 / 尺」を出すので、尺だけのバッジは隠す */}
        {!showPreview && video.durationMs != null && (
          <span className="badge duration">{fmtTime(video.durationMs / 1000)}</span>
        )}
        {/* プレビュー中は再生位置バーが出るので、レジューム位置のバーは隠す */}
        {!showPreview && video.resumeMs > 0 && video.durationMs ? (
          <div className="resume-bar">
            <div style={{ width: `${Math.min((video.resumeMs / video.durationMs) * 100, 100)}%` }} />
          </div>
        ) : null}
        {video.isOffline && <span className="badge offline">离线</span>}
        {video.isMissing && !video.isOffline && (
          <span className="badge missing">未找到</span>
        )}
      </div>
      <div className="card-name">{video.title ?? video.filename}</div>
      <div className="card-sub">
        {fmtSize(video.size)}
        {video.width && video.height ? ` · ${video.width}×${video.height}` : ''}
      </div>
      {/*
        标签行·系列行(v1.23)。設定が ON なら**中身が空でも必ず描く** —
        付いている動画だけ背が高くなると、行単位で 1 つの高さしか持てない仮想化が破綻する
        (高さは lib/grid.ts の CARD_CHIP_ROW_H と対)
      */}
      {cardTags && (
        <div className="card-chips">
          {chips(
            (labels?.tags ?? []).map((t) => (
              <span
                key={t.id}
                className="chip mini"
                style={t.color ? { borderColor: t.color, color: t.color } : undefined}
              >
                {t.name}
              </span>
            )),
            cardW,
          )}
        </div>
      )}
      {cardSeries && (
        <div className="card-chips">
          {chips(
            (labels?.series ?? []).map((s) => (
              <span key={s.id} className="chip mini series">
                <ListOrdered size={11} />
                {s.name}
              </span>
            )),
            cardW,
          )}
        </div>
      )}
    </div>
  );
});

/**
 * 1 行に収まるぶんだけ出し、余りは `+N` にまとめる。
 * カードは 140〜400px と幅が変わるので、入る個数は幅から決める(DOM は測らない)
 */
function chips(items: React.ReactNode[], cardW: number): React.ReactNode {
  const budget = chipBudget(cardW);
  if (items.length <= budget) return items;
  return [
    ...items.slice(0, budget),
    <span key="more" className="chip mini more">
      +{items.length - budget}
    </span>,
  ];
}
