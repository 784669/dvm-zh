import { useLayoutEffect, useRef, useState } from 'react';
import { fmtTime } from '../lib/format';

const RATES = [1, 2, 4, 8];

type Props = {
  /** 播放源：缓存没做好时是原文件，做好之后换成降码缓存 */
  src: string;
  /** 媒体库记录的总时长（分片 mp4 未写完时 video.duration 不可信） */
  durationMs?: number | null;
  /** 后台转码进度 0..1；null = 已完成或未知（此时进度条改为显示已缓冲） */
  progress?: number | null;
};

/**
 * 卡片上的降码预览（点播放按钮后出现）。
 *
 * 为什么不是直接把「正在生成的缓存文件」交给 <video>：
 * 那个文件在被 ffmpeg 逐段追加，浏览器读到的长度随时在变，很容易一进去就
 * 解析失败，于是一直转圈、最后什么都播不出来（这正是首点必然失败的根因）。
 * 所以这里拆成两步：
 *   1. 立刻播**原文件**——稳定、可跳转、点开就有画面
 *   2. 后端转码完成后（ready）父组件把 src 换成降码缓存，这里保留播放位置与倍速
 *      无缝接上去，之后才真正省 CPU / 磁盘
 *
 * 交互：
 * - 固定进度条：亮色=播放位置，浅色=缓存进度（转码中）或已缓冲
 * - 只支持点击跳转，不支持拖动
 * - X1→X2→X4→X8→回X1 倍速，静音播放直接改 playbackRate
 */
export function HoverPreview({ src, durationMs, progress = null }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const rateRef = useRef(1);
  const [rate, setRate] = useState(1);
  const [started, setStarted] = useState(false);
  const [stalled, setStalled] = useState(true);
  const [mediaError, setMediaError] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);

  const knownDur = (durationMs ?? 0) / 1000;

  /**
   * src 变化（原文件 → 降码缓存）时手动换源。
   * JSX 里**不写 src 属性**，否则 React 一改属性浏览器就先把旧源卸掉，
   * 想记住的播放位置就没了。这里先读数再赋值，等 metadata 到了跳回去
   */
  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const keepTime = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    const keepRate = rateRef.current;
    setStarted(false);
    setStalled(true);
    setMediaError(false);
    setBuffered(0);
    setDur(0);

    el.src = src;
    el.load();
    el.playbackRate = keepRate;

    const onMeta = () => {
      if (keepTime > 0.15) {
        try {
          el.currentTime = keepTime;
        } catch {
          // 尺より先を指していた等。先頭から流せばよい
        }
      }
      void el.play().catch(() => {});
    };
    el.addEventListener('loadedmetadata', onMeta, { once: true });
    void el.play().catch(() => {});
    return () => el.removeEventListener('loadedmetadata', onMeta);
  }, [src]);

  // <video> 自己报的时长（转码完成后才准）优先，否则用媒体库记录兜底
  const effDur = dur > 0 && Number.isFinite(dur) ? dur : knownDur;
  const playedPct = effDur > 0 ? Math.min(Math.max(cur / effDur, 0), 1) * 100 : 0;
  // 转码中显示缓存进度（这才是用户要看的「加载到哪了」），完成后显示已缓冲
  const building = progress != null && progress < 1;
  const loadedPct = building
    ? Math.min(Math.max(progress ?? 0, 0), 1) * 100
    : effDur > 0
      ? Math.min(Math.max(buffered / effDur, 0), 1) * 100
      : 0;

  const readBuffered = (el: HTMLVideoElement) => {
    try {
      if (el.buffered.length > 0) setBuffered(el.buffered.end(el.buffered.length - 1));
    } catch {
      // buffered 在极少数时序下会抛错，忽略即可
    }
  };

  // 只做点击跳转。跳过去时如果该处缓存还没做好，原文件本身总是可跳的
  const seekTo = (clientX: number) => {
    const el = videoRef.current;
    const bar = barRef.current;
    if (!el || !bar || effDur <= 0) return;
    const r = bar.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    try {
      el.currentTime = ratio * effDur;
    } catch {
      // 元数据还没到时跳不了，忽略
    }
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    rateRef.current = next;
    const el = videoRef.current;
    if (el) el.playbackRate = next;
  };

  return (
    <>
      <video
        ref={videoRef}
        className="hover-preview"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onPlaying={() => {
          setStarted(true);
          setStalled(false);
        }}
        onWaiting={() => setStalled(true)}
        onCanPlay={() => setStalled(false)}
        onError={() => {
          // 原文件可能就是浏览器不支持的编码（HEVC 等）。这时不消失、不重试，
          // 只把「转码中 xx%」摆出来，等父组件把 src 换成降码缓存
          setMediaError(true);
          setStalled(false);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
          setMediaError(false);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setCur(el.currentTime);
          readBuffered(el);
        }}
        onProgress={(e) => readBuffered(e.currentTarget)}
        onEnded={(e) => {
          // 转码未完时 duration 不明，浏览器可能不会自动 loop，手动兜一下
          const el = e.currentTarget;
          if (effDur > 0) {
            el.currentTime = 0;
            void el.play().catch(() => {});
          }
        }}
      />
      {mediaError && !building ? (
        <div className="hover-buffering">
          <span className="hover-note">该素材浏览器无法直接解码</span>
        </div>
      ) : (
        (!started || stalled) && (
          <div className="hover-buffering">
            <span className="preview-spinner" />
            {building && (
              <span className="hover-note">生成缓存 {Math.round((progress ?? 0) * 100)}%</span>
            )}
          </div>
        )
      )}
      <div className="hover-bar-row">
        <span className="hover-time">{fmtTime(cur)}</span>
        <div
          ref={barRef}
          className="hover-bar"
          title={
            building
              ? `点击跳转 · 降码缓存 ${Math.round((progress ?? 0) * 100)}%`
              : '点击跳转'
          }
          onClick={(e) => seekTo(e.clientX)}
        >
          <div className="hover-bar-loaded" style={{ width: `${loadedPct}%` }} />
          <div className="hover-bar-played" style={{ width: `${playedPct}%` }} />
        </div>
        <button type="button" className="hover-rate" title="播放速度" onClick={cycleRate}>
          X{rate}
        </button>
        <span className="hover-time">{effDur > 0 ? fmtTime(effDur) : '--:--'}</span>
      </div>
    </>
  );
}
