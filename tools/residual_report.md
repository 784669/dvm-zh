## src\components\DedupeDialog.tsx (3)
  L78 [jsx] 媒体库から外す
  L82 [jsx] 残る本数(1 群组 1 本)
  L111 [jsx] 外す動画のある文件夹ー
## src\components\DeleteDialog.tsx (2)
  L28 [jsx] 媒体库から削除
  L38 [jsx] 文件をごみ箱へ
## src\components\ExcludeDialog.tsx (1)
  L41 [jsx] 文件は削除しません。
## src\components\ExcludeOnDeleteDialog.tsx (3)
  L74 [jsx] 選んだ文件だけ除外して削除
  L85 [jsx] 親文件夹ーごと除外して削除
  L100 [jsx] 除外せずに删除
## src\components\FilterBar.tsx (1)
  L128 [jsx] 筛选なし
## src\components\Inspector.tsx (2)
  L366 [jsx] 标签なし
  L423 [jsx] 系列なし
## src\components\LibraryUnavailable.tsx (1)
  L105 [jsx] 他の媒体库を打开
## src\components\StatsModal.tsx (1)
  L264 [jsx] 标签なし
## src\components\settings\DataSection.tsx (4)
  L104 [jsx] 缩略图キャッシュ
  L116 [jsx] 媒体库文件夹を打开
  L126 [jsx] 今の使用量(全部の媒体库の合計)
  L160 [jsx] 备份文件夹を打开
## src\components\settings\LibrarySection.tsx (2)
  L145 [jsx] 動画文件は削除しません。
  L167 [jsx] 文件夹を選んで追加...
## src\components\settings\SubtitleSection.tsx (1)
  L19 [jsx] 字幕样式(アプリ内再生)
## src\lib\aiTools.ts (24)
  L45 [str] 文件名・标题の部分一致。空白区切りで複数語全部を含むものに絞る
  L48 [str] 标签名(完全一致)で絞る。同じ群组の标签同士は OR、群组をまたぐと AND になる(例: [
  L48 [str] ] = (ファンタジー 或 SF) 并且 动画)。群组は list_tags で確認できる
  L53 [str] 评分を付けていない動画だけ。minRating の 0 は「無条件」なので別物
  L57 [str] 标签が 1 つも付いていない動画だけ
  L62 [str] 内容が同一(大小と先頭ハッシュが一致)の動画だけ。sort=dup と併せると同じものが隣り合う
  L63 [str] 文件大小の下限(バイト)
  L64 [str] 文件大小の上限(バイト)
  L68 [str] 画面の方向。portrait = 縦長、landscape = 横長(正方形を含む)
  L69 [str] 映像编解码器で絞る(例: [
  L70 [str] 媒体库追加日の下限(YYYY-MM-DD。その日を含む)
  L71 [str] 媒体库追加日の上限(YYYY-MM-DD。その日を含む)
  L73 [str] 文件更新日の下限(YYYY-MM-DD。その日を含む)
  L74 [str] 文件更新日の上限(YYYY-MM-DD。その日を含む)
  L165 [tmpl] 标签「${name}」が未找到
  L173 [tmpl] 系列「${name}」が未找到
  L189 [str] 動画媒体库を検索して結果を JSON で返す(画面は変わらない)。結果を画面に表示したいときは apply_filter を使うこと。
  L220 [str] 全标签と各标签の動画数、所属群组(groupName)を一覧する。群组は分類の軸(例:「ジャンル」「メディア種別」)で、検索では同じ群组の标签同士が OR になる
  L227 [str] 全系列と各系列の動画数を一覧する
  L240 [str] 文件が找不到動画だけ
  L251 [tmpl] 筛选を適用しました。該当 ${count} 件
  L257 [str] 動画に标签を付ける(标签が無ければ作成される)
  L276 [str] 動画の评分を設定する(0 で解除)
  L295 [str] 動画を系列に追加する(系列が無ければ作成される)
## src\lib\ai\config.ts (1)
  L105 [str] 基础 URL が未設定です。設定 > AI 連携 で入力してください
## src\lib\contextMenu.ts (50)
  L64 [str] 文件が未找到
  L97 [str] 队列の末尾に足します
  L109 [str] 今の队列を捨てて、選んだ動画だけで再生を始めます
  L128 [str] 実体を触れる文件がありません
  L189 [str] 右点击した 1 件を表示します
  L197 [str] 右点击した動画の文件夹ーで筛选ます
  L201 [str] フル复制路径
  L221 [str] 缩略图を作り直す
  L233 [str] 文件自体は削除されません
  L241 [str] 文件をごみ箱へ送り、媒体库からも削除します
  L310 [str] 筛选から外す
  L310 [str] 筛选に追加
  L323 [str] 他に筛选中の标签がありません
  L324 [str] 他の标签の筛选を外してこれだけにします
  L339 [str] 标签群组がまだありません
  L345 [str] 标签を削除
  L368 [str] 标签がまだありません
  L370 [str] 未分類は排列られません
  L383 [str] 标签を表示
  L383 [str] 标签を隠す
  L391 [str] 群组に属さない标签を作成...
  L394 [str] 群组を作成...
  L420 [str] 群组を削除
  L446 [str] 全部畳む
  L489 [str] 文件夹ー自体は削除されません
  L507 [str] 筛选中は排列られません
  L518 [str] 队列に読み込んで再生
  L520 [str] 条件に合う動画で今の队列を置き換えます(先頭 500 件まで)
  L572 [str] 筛选中は排列られません
  L576 [str] 队列に読み込んで再生
  L579 [str] 今の队列を置き換えます
  L583 [str] 筛选を解除
  L635 [str] 筛选を解除
  L638 [str] 系列内は登録順で並べます
  L645 [str] 系列を削除
  L694 [str] 監視文件夹に追加
  L706 [str] 同じ内容の動画を 1 本だけ残します(文件は消しません)
  L710 [str] 監視除外文件夹に登録
  L712 [str] 次のスキャンから配下を無視します(文件は消しません)
  L737 [str] 媒体库を新規作成...
  L738 [str] 既存の媒体库を打开...
  L765 [str] 文件夹ーで絞り込んでいるときに使えます
  L776 [str] 表示中の没有视频
  L783 [str] 選択中の没有视频
  L789 [str] 表示中の一覧を队列に読み込んで再生
  L793 [str] 表示中の没有视频
  L794 [str] 筛选結果で今の队列を置き換えます(先頭 500 件まで)
  L820 [str] 上の文件夹ーへ
  L837 [str] 筛选を全部解除
  L884 [str] フル复制路径
## src\lib\filterChips.ts (2)
  L221 [str] の配下全部
  L263 [str] 标签なし
## src\lib\hdrInfo.ts (1)
  L64 [tmpl] ${info.full} 的画面。已转换为 SDR 显示(HDR パススルー: オフ)
## src\lib\listColumns.ts (11)
  L338 [str] 大小(小さい順)
  L339 [str] 大小(大きい順)
  L340 [str] 时长(短い順)
  L341 [str] 时长(長い順)
  L342 [str] 评分(低い順)
  L358 [str] 文件更新日(古い順)
  L359 [str] 文件更新日(新しい順)
  L360 [str] 文件作成日(古い順)
  L361 [str] 文件作成日(新しい順)
  L364 [str] 比特率(低い順)
  L365 [str] 比特率(高い順)
## src\lib\queueLoad.ts (3)
  L31 [tmpl] 保存していない队列(${s.queue.items.length} 件)を捨てて、\n${opts.label}を読み込みますか?
  L32 [str] 队列の置き換え
  L46 [tmpl] 队列の上限は ${QUEUE_LIMIT} 件のため、先頭 ${QUEUE_LIMIT} 件だけを読み込みました
## src\lib\shortcuts.ts (17)
  L91 [str] 缩略图表示・详细列表表示のとき
  L99 [str] 選択を再生队列に追加
  L99 [str] 右点击の「队列」からは「次に再生」も選べます
  L100 [str] 媒体库からか、ごみ箱かをダイアログで選びます
  L102 [str] 筛选を 戻す / 進む
  L113 [str] 前 / 次の章节へ
  L114 [str] 前 / 次の章节へ
  L119 [str] 連続再生・再生队列で開いたときだけ
  L120 [str] 再生队列を打开 / 关闭
  L120 [str] 再生中でも排列・削除ができます
  L123 [str] 表示大小 等倍 ⇄ フィット
  L131 [str] 右点击メニュー
  L144 [str] 标题・メモ・标签・系列・AI 助手の入力欄
  L146 [str] AI 助手では送信
  L147 [str] AI 助手で改行
  L148 [str] 标题・メモ・标签名の変更
  L179 [str] 開いているモーダル・メニューを关闭
## src\lib\subtitleStyle.ts (1)
  L161 [str] 动画などで制作者が付けた色・位置・タイミング演出は失われます
## src\lib\toolbarItems.ts (3)
  L77 [str] 筛选を戻す
  L78 [str] 筛选を進める
  L83 [str] 缩略图の大きさ
