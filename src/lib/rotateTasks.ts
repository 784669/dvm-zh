import { useSyncExternalStore } from 'react';
import { api } from '../api';
import { useLibrary } from '../store';

/**
 * 「源文件写入旋转」的任务状态。后端持有任务本体,这里只做镜像:
 * - 卡片被虚拟化回收再滚回来,也能从这份全局状态恢复进度显示
 * - 完成与否的 toast 在轮询层统一发(卡片卸载了也不会漏报)
 */
export interface RotateTaskState {
  id: number;
  dir: 'cw' | 'ccw';
  /** 0〜100 */
  progress: number;
  state: 'running' | 'done' | 'error';
  message?: string;
  /** 完成后的绝对角(顺时针 0/90/180/270) */
  rotation?: number;
}

const tasks = new Map<number, RotateTaskState>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const POLL_MS = 400;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getVersion() {
  return version;
}

function dirLabel(dir: RotateTaskState['dir']) {
  return dir === 'cw' ? '顺时针' : '逆时针';
}

async function poll() {
  let list: RotateTaskState[];
  try {
    list = await api.rotateStatus();
  } catch {
    return; // 后端忙时下一轮再取
  }
  const prev = new Map(tasks);
  tasks.clear();
  for (const t of list) tasks.set(t.id, t);
  for (const t of list) {
    const before = prev.get(t.id);
    const finished = !before || before.state === 'running';
    if (t.state === 'done' && finished) {
      useLibrary
        .getState()
        .pushToast(`已写入源文件：${dirLabel(t.dir)} ${t.rotation ?? 0}°`, 'info');
    } else if (t.state === 'error' && finished) {
      useLibrary.getState().pushToast(t.message || '写入旋转信息失败，文件未改动');
    }
  }
  notify();
  if (!list.some((t) => t.state === 'running') && timer) {
    clearInterval(timer);
    timer = null;
  }
}

function ensurePolling() {
  if (!timer) {
    timer = setInterval(poll, POLL_MS);
    void poll();
  }
}

/** 启动一次源文件旋转。进度与结果通过 useRotateTask 订阅 */
export function startRotate(id: number, dir: 'cw' | 'ccw') {
  tasks.set(id, { id, dir, progress: 0, state: 'running' });
  notify();
  ensurePolling();
  api.rotateVideo(id, dir).catch((e) => {
    // 命令本身没发出去(极少):把本地任务标记为失败,别让转圈挂死
    tasks.set(id, {
      id,
      dir,
      progress: 0,
      state: 'error',
      message: e instanceof Error ? e.message : String(e),
    });
    notify();
  });
}

/**
 * 订阅某个视频的旋转任务。用 version 号做快照:
 * 任何任务变动都会让订阅的卡片重渲染(可见卡片只有几十枚,代价可忽略)
 */
export function useRotateTask(id: number): RotateTaskState | undefined {
  useSyncExternalStore(subscribe, getVersion);
  return tasks.get(id);
}
