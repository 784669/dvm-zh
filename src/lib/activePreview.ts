import { useSyncExternalStore } from 'react';

/**
 * いま画面で再生中のプレビュー(動画 id)。**同時に 1 枚しかプレビューは再生しない**
 * ルールのフロント側の掛け軸:
 * - 新しいカードで再生を始めたら setActivePreview(新しい id)
 * - ほかの id がアクティブになったカードは自らプレビューを止める
 *   (バックエンド側も前の転码を kill するが、映像側の停止はここで行う)
 */
let activeId = 0;
let version = 0;
const listeners = new Set<() => void>();

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

export function setActivePreview(id: number) {
  if (activeId === id) return;
  activeId = id;
  notify();
}

/** 自分で停止したとき(手動停止・右クリックメニューなど)にアクティブを外す */
export function clearActivePreview(id: number) {
  if (activeId !== id) return;
  activeId = 0;
  notify();
}

/** 現在アクティブな動画 id(0 = どのプレビューも再生していない) */
export function useActivePreview(): number {
  useSyncExternalStore(subscribe, () => version);
  return activeId;
}
