import { ListX, Trash2 } from 'lucide-react';

/**
 * Delete キーの削除先を選ばせるダイアログ(v1.14)。
 *
 * キーを押した時点では「登録だけ消したい」のか「文件ごと捨てたい」のかが
 * 分からないので、**押した直後に必ずここで一度止める**。
 * 右键菜单はどちらの削除かを指定して選ぶので、こちらは通らない
 */
export function DeleteDialog({
  count, onLibrary, onTrash, onClose,
}: {
  count: number;
  onLibrary: () => void;
  onTrash: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal delete-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">删除 {count} 个</div>
        <div className="settings-note">要执行哪种删除?</div>

        <div className="delete-choices">
          <button className="delete-choice" onClick={onLibrary}>
            <ListX />
            <span>
              <span className="delete-choice-title">从媒体库删除</span>
              <span className="delete-choice-note">
                将删除注册信息与标签、评分。文件本身保留
              </span>
            </span>
          </button>

          <button className="delete-choice danger" onClick={onTrash}>
            <Trash2 />
            <span>
              <span className="delete-choice-title">将文件送入回收站</span>
              <span className="delete-choice-note">
                将文件送入回收站，并删除媒体库注册（执行前可查看列表）
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
