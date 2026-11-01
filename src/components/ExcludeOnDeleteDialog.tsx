import { useEffect, useState } from 'react';
import { EyeOff, FolderMinus, ListX, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { collateralCount, excludeTargets, type ExcludeTargets } from '../lib/excludeOnDelete';
import type { VideoRow } from '../types';

/** 何をしてから删除か */
export type ExcludeChoice = 'none' | 'files' | 'folders';

/** 文件夹の件数をいくつまで数えに行くか。多いと count_videos を叩く回数が増える */
const COUNT_LIMIT = 8;

/**
 * 监视文件夹配下の動画を删除ときに出す確認(v1.33)。
 *
 * **消しても次のスキャンで再登録される**のはこの場面だけなので、ここでだけ尋ねる。
 * 個別登録の動画しか選んでいなければ、呼び出し側がこのダイアログを出さない。
 *
 * 単位はその場で選ばせる。文件夹ごとは一発で済む代わりに、その文件夹に
 * 今後入る動画まで取り込まれなくなるので、**巻き込む本数を数えて添える**
 */
export function ExcludeOnDeleteDialog({
  selection, onChoose, onClose,
}: {
  selection: VideoRow[];
  onChoose: (choice: ExcludeChoice, targets: ExcludeTargets) => void;
  onClose: () => void;
}) {
  const targets = excludeTargets(selection);
  /** 親文件夹直下の登録数。数え終わるまでは null(「巻き込み 0 件」と誤読させない) */
  const [collateral, setCollateral] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    if (targets.folders.length > COUNT_LIMIT) {
      return;
    }
    Promise.all(
      targets.folders.map(async (dir) => [dir.toLowerCase(), await api.countVideos({ dirPath: dir })] as const),
    )
      .then((pairs) => {
        if (alive) setCollateral(collateralCount(targets, Object.fromEntries(pairs)));
      })
      .catch(() => {
        // 数えられなくても選択肢は出す(文言側で「不明」と伝える)
      });
    return () => { alive = false; };
    // targets は selection から毎回作り直されるので、依存はパスの並びで見る
  }, [targets.folders.join('|')]);

  const folderLabel =
    targets.folders.length === 1
      ? targets.folders[0]
      : `${targets.folders.length} 个文件夹`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal delete-modal exclude-on-delete-modal" onClick={(e) => e.stopPropagation()}>
        {/* このダイアログ自体が削除の確認も兼ねる(呼び出し側で二重に尋ねない) */}
        <div className="modal-title">
          <EyeOff size={18} /> 从媒体库删除 {selection.length.toLocaleString()} 个
        </div>
        <div className="settings-note">
          其中 {targets.files.length.toLocaleString()} 个位于监视文件夹内，
          若直接删除<strong>将在下次扫描中重新注册</strong>。
          加入监视排除后就不会再次被导入。
          <strong>无论选择哪个，视频文件都不会被删除。</strong>
        </div>

        <div className="delete-choices">
          <button className="delete-choice" onClick={() => onChoose('files', targets)}>
            <ListX />
            <span>
              <span className="delete-choice-title">仅排除所选文件并删除</span>
              <span className="delete-choice-note">
                仅将这 {targets.files.length.toLocaleString()} 个登记为监视排除。
                不影响同一文件夹中的其他视频
              </span>
            </span>
          </button>

          <button className="delete-choice" onClick={() => onChoose('folders', targets)}>
            <FolderMinus />
            <span>
              <span className="delete-choice-title">连同父文件夹一并排除并删除</span>
              <span className="delete-choice-note">
                将 {folderLabel} 登记为监视排除。
                {collateral === null
                  ? '今后放入该文件夹的视频也不会被导入'
                  : collateral > 0
                    ? `未选择的 ${collateral.toLocaleString()} 项，以及今后放入的视频也不会被导入`
                    : '今后放入该文件夹的视频也不会被导入'}
              </span>
            </span>
          </button>

          <button className="delete-choice" onClick={() => onChoose('none', targets)}>
            <RotateCcw />
            <span>
              <span className="delete-choice-title">不排除直接删除</span>
              <span className="delete-choice-note">
                将在下次扫描中重新注册（仅想暂时隐藏时）
              </span>
            </span>
          </button>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
