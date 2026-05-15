# WebKit Memory Leak Mitigation

作成日: 2026-05-15
ブランチ: `codex/webkit-memory-leak-mitigation`

このドキュメントは、iPadOS Safari / WebKit で `pdf-lib` を使った PDF の
再生成・再表示を何度も繰り返すとメモリが増え続ける問題について、調査内容、
参考リンク、ライブラリ側の修正方針、実装済み作業を長期的に管理するための
作業メモです。

## 目的

対象のアプリでは、PDF を生成して `Blob` 化し、`URL.createObjectURL()` で
作った URL を `iframe` などに差し替えてプレビューしています。この再描画を
30 回程度繰り返すと iPad Safari が落ちることがあります。

`pdf-lib` だけで WebKit 内部の PDF viewer や `blob:` URL の保持を強制解放
することはできません。ただし、ライブラリ側で巨大な内部参照を早く切る、
ワンショット生成向けの明示的な破棄 API を用意する、Safari/iPadOS 向けの
安全な使い方を documented path にする、といった対策は可能です。

## 問題点

現時点の仮説は、主に次の複合問題です。

- WebKit が `Document`、画像/PDF viewer、`blob:` URL に紐づく表示リソース
  をアプリ側の期待より長く保持することがある。
- `URL.revokeObjectURL()` を呼んでも、WebKit 側の viewer resource が即時に
  解放される保証はない。
- `pdf-lib` は `save()` 後も同じ `PDFDocument` を編集し続けられる設計のため、
  `PDFContext`、ページキャッシュ、フォームキャッシュ、埋め込みフォント、
  画像、ページ、添付ファイルなどを保持し続ける。
- iPadOS Safari ではブラウザ/WebView のメモリ上限が厳しく、WebKit 側の保持
  と JavaScript heap 側の保持が同時に積み上がるとクラッシュしやすい。

典型的な高リスクコード:

```js
const pdfBytes = await pdfDoc.save();
const blob = new Blob([pdfBytes], { type: 'application/pdf' });
const url = URL.createObjectURL(blob);
iframe.src = url;
```

特に危険なパターン:

- 同一ページ上で同じ `iframe` に新しい PDF `blob:` URL を何度も代入する。
- 古い object URL を revoke していない、または revoke しても WebKit が内部
  リソースを保持し続ける。
- アプリ側が古い `PDFDocument`、元 PDF bytes、生成済み `Uint8Array`、Blob、
  object URL を参照し続けている。
- PDF 生成をメインスレッドで行い、WebKit の表示処理と JS 側のピークメモリが
  同時に上がる。

## 参考になるリンク

- [Qiita: 10 年前からある Safari のメモリリーク問題が結構やばい](https://qiita.com/RepublicOfKorokke/items/90c9f49d8b8697ae0427)
  - Safari/WebKit で画像表示更新を繰り返すとメモリが増える問題の調査まとめ。
- [WebKit bug 31253: Unbounded memory growth when adding and removing images](https://bugs.webkit.org/show_bug.cgi?id=31253)
  - 画像ノードを追加・削除しても Document 側の resource が保持される可能性に
    関する長期の WebKit 議論。
- [WebKit bug 236692: Webapp fails in iOS when using revokeObjectURL](https://bugs.webkit.org/show_bug.cgi?id=236692)
  - buffer を `null` にし、object URL を revoke しても iOS/WKWebView で
    繰り返し表示が失敗するという報告。
- [WebKit bug 211234: iOS object URL revoke timing breaks download](https://bugs.webkit.org/show_bug.cgi?id=211234)
  - iOS では object URL の revoke タイミングや挙動が他環境と異なることを示す
    関連事例。
- [StackOverflow: Data URI leak in Safari / HTML5 canvas](https://stackoverflow.com/questions/8538917/data-uri-leak-in-safari-was-memory-leak-with-html5-canvas)
  - `Image.src` を data URI で繰り返し差し替えると Safari でメモリが増えた
    古い事例。`Image.src` 経由を避けることで改善したという示唆がある。
- [Tauri issue 4026: High memory usage when invoking commands](https://github.com/tauri-apps/tauri/issues/4026)
  - 大きなデータを WebView 側へ高頻度に渡すとメモリが増える関連パターン。
- [Electron issue 24835: Memory usage increasing when background-image is updated](https://github.com/electron/electron/issues/24835)
  - WebView 的な環境で画像更新を繰り返すとメモリが増える関連パターン。
- [MDN: URL.revokeObjectURL()](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)
  - object URL の解放 API。viewer 側の全リソースが即時解放される保証ではない。

## 関連するローカルコード

- `src/api/PDFDocument.ts`
  - `PDFDocument.load()` は入力を `Uint8Array` に変換し、`PDFContext` として
    PDF 全体をパースする。
  - `PDFDocument.save()` は埋め込み素材を `flush()` し、新しい `Uint8Array`
    へシリアライズするが、保存後も document は編集可能なまま残る。
  - document は page/form cache、page map、fontkit、fonts、images、
    embedded pages/files/scripts などを保持する。
- `src/api/PDFImage.ts`
  - 既に embed 後に `this.embedder = undefined` しており、元画像データを
    GC 可能にする実装が入っている。
- `src/api/PDFEmbeddedPage.ts`
  - `PDFPageEmbedder` を embed 後も保持する。これは元ページやコピー済み
    resource graph を引っ張る可能性がある。
- `src/api/PDFFont.ts`
  - font embedder を保持する。保存後も text measurement や追加描画に使える
    API 設計なので、通常の `save()` では安易に破棄できない。
- `apps/web/*.html`
  - 手動テスト用 Web サンプルは、生成 PDF を `Blob` URL + `iframe` で表示
    している。現状、object URL の堅牢な cleanup 例にはなっていない。
- `apps/web/preview-server.js`
  - `test20.html` 用の小さな検証サーバー。生成済み PDF bytes を POST で受け、
    `blob:` URL ではなく通常の HTTP PDF URL として返す。
- `apps/web/test21.html`
  - `iframe` 表示も network preview も行わず、PDF 生成と
    `save({ dispose: true })` だけを繰り返す切り分けサンプル。
- `apps/web/test22.html`
  - iPadOS Safari では inline PDF iframe preview を避け、生成済み PDF の
    object URL をリンクとしてだけ提示する mitigation サンプル。
- `apps/web/test23.html`
  - stress test 中は object URL を作らず、最後の PDF bytes だけを保持する。
    ユーザーが `Open Latest` を押した時だけ object URL を作る deferred preview
    サンプル。
- `apps/web/utils.js`
  - `createDeferredPdfObjectUrlPreview()` を追加した。`setBytes()` は bytes を
    保持するだけで `Blob` / object URL を作らず、`open()` / `download()` が
    呼ばれた時だけ object URL を作る。作成した object URL は既定で 30 秒後に
    revoke する。`clearBytesAfterUse: true` を指定すると、`open()` / `download()`
    後に元の bytes 参照も解放する。
- `docs/WEBKIT_MEMORY_RECORDING_SUMMARY.json`
  - iPadOS Safari で `apps/web/test19.html` を動かした Safari Web Inspector
    timeline recording から、必要な集計だけを抜き出した JSON。
- `docs/WEBKIT_MEMORY_RECORDING_TEST20_SUMMARY.json`
  - iPadOS Safari で `apps/web/test20.html` を動かした Safari Web Inspector
    timeline recording から、必要な集計だけを抜き出した JSON。
- `docs/WEBKIT_MEMORY_RECORDING_TEST21_SUMMARY.json`
  - iPadOS Safari で `apps/web/test21.html` を動かした Safari Web Inspector
    timeline recording から、必要な集計だけを抜き出した JSON。
- `docs/WEBKIT_MEMORY_RECORDING_TEST22_SUMMARY.json`
  - iPadOS Safari で `apps/web/test22.html` を動かした Safari Web Inspector
    timeline recording から、必要な集計だけを抜き出した JSON。
- `docs/WEBKIT_MEMORY_RECORDING_TEST23_SUMMARY.json`
  - iPadOS Safari で `apps/web/test23.html` を動かした Safari Web Inspector
    timeline recording から、必要な集計だけを抜き出した JSON。
  - 元の recording JSON は約 1GB あるため repo には入れず、memory category、
    GC、Blob URL 数、主要イベント数だけを保存する。
- `docs/WEBKIT_MEMORY_RECORDING_ANALYSIS_BRIEF.md`
  - 集計から読み取れることを短くまとめた Markdown。
- `docs/WEBKIT_MEMORY_RECORDING_SUMMARY.md`
  - memory category、GC、主要イベント数の Markdown summary。
- `docs/WEBKIT_MEMORY_TIMESERIES.csv`
  - Safari memory sample の raw CSV。
- `docs/WEBKIT_MEMORY_TIMESERIES_1S.csv`
  - memory sample を 1 秒単位に間引いた CSV。

## ライブラリを修正する方向

### 1. 明示的な document 破棄 API を追加する

ワンショット生成用途向けに、次のような API を検討する。

```ts
const pdfBytes = await pdfDoc.save({ dispose: true });
// or
const pdfBytes = await pdfDoc.save();
pdfDoc.dispose();
```

期待する挙動:

- `dispose()` 後に document を操作した場合は、明確なエラーを投げる。
- page cache、form cache、page map、fontkit、埋め込み素材配列、低レベル
  context の object storage をできるだけ解放する。
- 返却済みの `Uint8Array` は引き続き有効にする。
- 既存互換性を壊さないため、通常の `save()` の挙動は変えない。

設計上の注意:

- `context` と `catalog` は public readonly property なので、完全に `undefined`
  にするのは破壊的変更になりやすい。まずは内部データ構造を clear する設計を
  検討する。

### 2. embed 後に不要な embedder 参照を切る

`PDFImage` で既に採用されている方針を、他の embeddable に広げる。

- `PDFEmbeddedPage` は embed 成功後に `PDFPageEmbedder` を解放する。
- `PDFEmbeddedFile` は embed 成功後に `FileEmbedder` を解放する。
- `PDFJavaScript` は embed 成功後に `JavaScriptEmbedder` を解放する。

フォントについて:

- `PDFFont` は保存後も `widthOfTextAtSize()` や `drawText()` に使われるため、
  通常の `save()` では embedder を自動解放しない。
- 明示的な `PDFDocument.dispose()` の中では、font embedder 内部の重い参照を
  切る方向を検討する。

### 3. 到達不能 PDF object の pruning を検討する

将来的に `save({ pruneObjects: true })` のようなオプションを検討する。

期待する効果:

- `removePage()` やフォーム削除後に、出力に不要な indirect object を落とせる。
- 出力サイズと serialization 時のピークメモリを下げられる可能性がある。

リスク:

- フォーム、注釈、アウトライン、名前付き宛先、JavaScript、添付ファイル、
  viewer preferences などの参照関係を壊す可能性がある。
- まずは明示的破棄と embedder 解放を優先し、pruning は後続フェーズにする。

### 4. Safari/iPadOS 向けの使い方をドキュメント化する

ライブラリ側で直せない WebKit の保持を前提に、推奨パターンを明文化する。

- PDF 生成は dedicated Web Worker に閉じ込める。
- `pdfBytes.buffer` を transfer して main thread に渡し、ワンショット用途では
  worker を terminate する。
- 古い object URL を revoke し、`iframe.src` を `about:blank` などに逃がして
  から差し替える。
- 古い `PDFDocument`、`Uint8Array`、Blob、object URL の参照を残さない。
- Safari では PDF/image viewer に data URI を何度も代入するパターンを避ける。
- iPadOS Safari では、同一ページの `blob:` iframe プレビューを繰り返すより、
  一時的な server-backed PDF URL や別画面/ダウンロード導線も検討する。

## 実装フェーズ案

### Phase 1: 低リスクな参照解放

- `PDFEmbeddedPage` / `PDFEmbeddedFile` / `PDFJavaScript` が embed 後に embedder
  を解放するようにする。
- `embed()` を複数回呼んでも安全であることをテストする。
- `yarn typecheck` と `yarn test` を通す。

### Phase 2: 明示的 disposal API

- `PDFDocument.dispose()` を追加する。
- `SaveOptions.dispose?: boolean` を追加する。
- dispose 後に public API を呼んだ場合のエラーを追加する。
- `save()` 後の dispose、`save({ dispose: true })`、dispose 後エラーのテストを
  追加する。

### Phase 3: ドキュメントと Web サンプル

- README または docs に Safari/iPadOS 向けの注意を追加する。
- `apps/web` のサンプルで古い object URL を revoke し、iframe を cleanup する。
- 繰り返し生成・表示用のストレステスト HTML を追加する。
- `blob:` iframe と server-backed PDF URL を比較できる手動テストを追加する。

### Phase 4: optional object pruning

- trailer root から到達可能な object graph を走査する設計を詰める。
- フォーム、注釈、添付ファイル、コピー/埋め込みページ、metadata を含むテストを
  追加してから `pruneObjects` オプションを検討する。

## 検証計画

自動検証:

- `yarn typecheck`
- `yarn test`
- embedder cleanup と dispose behavior の focused tests

手動ブラウザ検証:

- `yarn build`
- `yarn apps:web`
- desktop Safari、iPadOS Safari、Chrome、Firefox で繰り返し PDF 生成・表示を
  試す。
- メモリが単調増加するか、一定範囲で plateau するかを確認する。
- 古い object URL が revoke され、最新 PDF が表示され続けることを確認する。

iPadOS 固有の検証:

- 実際のアプリの再描画フローで確認する。
- 少なくとも次の条件を比較する。
  - 現状実装
  - アプリ側の object URL cleanup のみ
  - `pdf-lib` の disposal のみ
  - worker 生成 + disposal
  - Safari では同一ページ `iframe` プレビューを使わない構成

## Safari 記録から分かったこと

`apps/web/test19.html` を iPadOS Safari で実行した timeline recording を集計した。
集計結果は次のファイルに保存した。

- `docs/WEBKIT_MEMORY_RECORDING_ANALYSIS_BRIEF.md`
- `docs/WEBKIT_MEMORY_RECORDING_SUMMARY.md`
- `docs/WEBKIT_MEMORY_RECORDING_SUMMARY.json`
- `docs/WEBKIT_MEMORY_TIMESERIES.csv`
- `docs/WEBKIT_MEMORY_TIMESERIES_1S.csv`

元の recording は `/Users/keitaro/tmp/172.20.10.2-recording.json` で、サイズは
約 1GB だった。repo には巨大な元ファイルではなく、集計済みの Markdown、JSON、
CSV だけを残す。

主な数値:

- 走査した record 数: 50,429
- parse error: 0
- 観測された unique `blob:` URL: 130
- Safari memory total: 52.7 MB -> 1333.3 MB
- Safari memory max: 1343.1 MB
- `page`: 35.4 MB -> 1154.7 MB
- `javascript`: 7.1 MB -> 165.9 MB
- `images`: 0 MB のまま
- `layers`: 0 MB のまま
- GC event: 50
- GC total duration: 4.923 s

recording には 70.6s-195.9s の discontinuity があるため、厳密には連続した
1 本の時系列としてではなく、2 つの観測区間として読む。

観測区間ごとの増加:

- 3.5s-69.9s: total 52.7 MB -> 565.4 MB、max 1174.0 MB
- 195.9s-228.1s: total 774.9 MB -> 1333.3 MB、max 1343.1 MB

### 考え方

この結果では、メモリ増加の支配的な要素は JavaScript heap ではなく WebKit の
`page` category だった。`javascript` も 158.7 MB 程度増えているが、`page` は
1.1 GB 以上増えている。

つまり、今回の主要因は `pdf-lib` の `PDFDocument` object graph だけでは説明
しにくい。`save({ dispose: true })`、font embedder 解放、Blob URL cleanup は
JS 側の参照を減らす対策としては意味があるが、`iframe` に読み込まれた
`blob:` PDF viewer / document resource を WebKit が保持し続ける問題までは
ライブラリ側から強制解放できない。

`images` と `layers` が 0 MB のままなので、少なくともこの recording では画像
デコードや layer accumulation が主因とは読めない。`page` category の増加が
大きいため、WebKit の page/document/PDF viewer resource retention と見るのが
自然。

### どうするべきか

ライブラリ側の方針:

- 既に入れた `PDFDocument.dispose()`、`save({ dispose: true })`、embedder
  参照解放は維持する。これは Chrome 等でも低リスクで、JS 側のピークメモリを
  下げる効果がある。
- ただし、これ以上 `pdf-lib` 内部だけを削っても、iPadOS Safari の `page`
  category 増加を根本的に止められる可能性は低い。
- optional object pruning は出力サイズや serialization peak には効く可能性が
  あるが、今回の `page` category 増加に対する第一優先の対策ではない。

アプリ側/表示方式の方針:

- iPadOS Safari では、同一ページ上の `iframe` に `blob:` PDF URL を何度も
  差し替える構成を避ける方向を第一候補にする。
- 比較すべき代替案:
  - PDF bytes を一時的な server-backed URL に置き、`blob:` URL ではなく通常の
    HTTP URL として表示する。
  - 同一 `iframe` 差し替えではなく、別画面/別タブ/別 viewer page へ遷移させる。
  - iPadOS Safari だけ inline preview を無効化し、download/open-in-new-tab
    導線にする。
  - PDF 生成を dedicated Worker に閉じ込め、生成後に worker を terminate する。
    これは JS heap 側の対策であり、`page` category 対策とは分けて評価する。
- 今後の cherry-pick 判断では、`save({ dispose: true })` 系のコミットだけで
  iPadOS Safari のクラッシュが消えることを期待しすぎない。Blob iframe 回避の
  表示方式変更と組み合わせて評価する。

次に作るとよい検証ページ:

- `test19` と同じ PDF 生成を行うが、`iframe.src = blobUrl` を使わないページ。
- server-backed URL 表示と `blob:` iframe 表示を同じ回数で比較できるページ。
- iPadOS Safari 判定時だけ preview を download/open-in-new-tab に切り替える
  実アプリ相当の検証ページ。

## いままで修正したこと

### 2026-05-15

- `codex/webkit-memory-leak-mitigation` ブランチを作成した。
- Qiita、WebKit Bugzilla、StackOverflow、Tauri、Electron、MDN の関連情報を
  調査した。
- ライブラリ側で対応できそうな領域を整理した。
  - 明示的な `PDFDocument` disposal
  - `PDFImage` 以外の embedder 参照解放
  - 到達不能 object pruning
  - Safari/iPadOS 向けドキュメント
- この進捗管理ドキュメントを追加した。
- Phase 1 の一部として、`PDFEmbeddedPage`、`PDFEmbeddedFile`、
  `PDFJavaScript` が embed 成功後に embedder 参照を解放するようにした。
- `PDFDocument` の focused test に、複数回 `flush()` / `save()` しても
  JavaScript、添付ファイル、埋め込みページの利用が壊れないことを追加した。
- Phase 2 の一部として、ワンショット生成後に呼べる `PDFDocument.dispose()`
  を追加した。
  - dispose 後は public API が `PDFDocumentDisposedError` を投げる。
  - page/form cache、page map、埋め込み素材配列、catalog、context の保持を
    clear する。
  - 通常の `save()` は既存互換性のため、まだ自動 dispose しない。
- Phase 2 の一部として、`save({ dispose: true })` と
  `saveAsBase64({ dispose: true })` を追加した。
  - 明示オプション指定時のみ、シリアライズ成功後に `PDFDocument.dispose()` を
    呼ぶ。
  - 返却済みの `Uint8Array` / base64 string は引き続き利用できる。
- Phase 2 の一部として、`PDFDocument.dispose()` 時に `PDFFont` が保持する
  embedder 参照も解放するようにした。
  - custom font の `fontkit` font object と元 font bytes を document disposal
    後に保持し続けにくくする。
  - 通常の `save()` 後は text measurement などの既存 API 互換性を維持するため、
    font embedder は自動解放しない。
- Phase 3 の一部として、`apps/web` の Blob URL + `iframe` 表示サンプルを
  共通 helper に寄せた。
  - 差し替え前に古い `iframe` を `about:blank` に逃がす。
  - 古い object URL を `URL.revokeObjectURL()` する。
  - `pagehide` 時にも表示中の object URL を cleanup する。
- Phase 3 の一部として、iPadOS Safari で繰り返し生成・表示を試すための
  `apps/web/test19.html` を追加した。
  - `Run 30` と `Run 100` で、PDF 生成、`save({ dispose: true })`、iframe 表示
    差し替えを繰り返す。
  - `Stop` で表示中の Blob URL を cleanup する。
  - 各 iteration 完了時に `30回テスト 12回目 完了した` の形式で status と
    console に記録し、完走後は iframe を `about:blank` に戻して Blob URL を
    cleanup する。
- Phase 3 の一部として、`blob:` iframe を避ける比較対象を追加した。
  - `apps/web/preview-server.js` は POST された PDF bytes を一時保持し、HTTP PDF
    URL として返す。
  - `apps/web/test20.html` は `save({ dispose: true })` した PDF を preview server
    に POST し、`iframe` には `blob:` ではなく `/__pdf_preview/*.pdf` を設定する。
  - 各 iteration 完了時に `30回テスト 12回目 完了した` の形式で status と
    console に記録し、完走後は iframe を `about:blank` に戻して server 側 preview
    entry を DELETE する。
  - `yarn apps:web:preview` で起動して、`test19` と `test20` の iPadOS Safari
    memory category を比較する。
- iPadOS Safari の timeline recording を集計し、
  `docs/WEBKIT_MEMORY_RECORDING_SUMMARY.json` として保存した。
  - memory total は 52.7 MB から 1333.3 MB まで増えた。
  - 増加の大半は `page` category で、`javascript` より支配的だった。
  - `blob:` URL は 130 個観測された。
  - この結果から、次の主戦場は `pdf-lib` 内部解放だけではなく、iPadOS Safari
    で `blob:` iframe PDF preview を避ける表示方式の検証だと判断した。
- `test20.html` の iPadOS Safari timeline recording を集計し、
  `docs/WEBKIT_MEMORY_RECORDING_TEST20_SUMMARY.json` として保存した。
  - `blob:` URL は 0 個になった。
  - memory total は 48.8 MB から 545.0 MB まで増えた。
  - `page` category は 29.2 MB から 338.8 MB まで増えた。
  - server-backed PDF URL に変えても増加の中心は残ったため、原因は Blob URL
    そのものよりも、Safari/WebKit の inline PDF iframe 表示または page resource
    保持に寄っている可能性が高い。
- Phase 3 の一部として、`apps/web/test21.html` を追加した。
  - PDF を生成して `save({ dispose: true })` するだけで、iframe に表示しない。
  - `test21` でも増えるなら `pdf-lib` 側または JS runtime 側の保持が疑わしい。
  - `test21` で増えないなら、inline PDF iframe 表示が主因だと判断しやすくなる。
- Phase 3 の一部として、`apps/web/test22.html` を追加した。
  - `renderPdfBytesWithInlinePreviewMitigation()` を通して PDF を扱う。
  - iPadOS Safari では `iframe.src` に PDF URL を設定せず、リンクだけを更新する。
  - Safari 以外では従来通り iframe preview できるため、既存サンプルとの比較に使える。
  - `?force-mitigation=1` を付けると、デスクトップブラウザでも回避モードを確認できる。
- `test21.html` の iPadOS Safari timeline recording を集計し、
  `docs/WEBKIT_MEMORY_RECORDING_TEST21_SUMMARY.json` として保存した。
  - `blob:` URL と server preview PDF URL はどちらも 0 個だった。
  - memory total は 43.5 MB から 65.9 MB までの増加に留まった。
  - `page` category は 25.6 MB から 14.5 MB に減った。
  - 生成と `save({ dispose: true })` だけでは `test19` / `test20` のような
    大きな `page` 増加は再現しない。
- `test22.html` の iPadOS Safari timeline recording を集計し、
  `docs/WEBKIT_MEMORY_RECORDING_TEST22_SUMMARY.json` として保存した。
  - memory total は 49.3 MB から 218.3 MB まで増えた。
  - `page` category は 29.8 MB から 143.2 MB まで増えた。
  - `blob:` URL は 30 個観測された。
  - `iframe` に PDF を流さないことで `test20` より改善したが、繰り返し
    object URL を作るだけでも Safari/WebKit 側の `page` 保持が残る可能性がある。
- Phase 3 の一部として、`apps/web/test23.html` を追加した。
  - 繰り返し生成中は `Blob` も object URL も作らない。
  - 最後の `Uint8Array` だけを保持し、ユーザー操作時だけ object URL を作って
    別タブで開く。
  - `test22` で残った `page` 増加が object URL 作成由来かを切り分ける。
- `test23.html` の deferred preview 処理を
  `createDeferredPdfObjectUrlPreview()` helper に切り出した。
  - 利用側は `setBytes(pdfBytes)` で最後の PDF bytes だけ保持する。
  - `open()` / `download()` をユーザー操作から呼んだ時だけ object URL を作る。
  - 新しい bytes を設定する時、`pagehide` 時、または `open()` / `download()` から
    既定 30 秒後に、既存 object URL を revoke する。
  - `test23.html` では `clearBytesAfterUse: true` を使い、ユーザー操作後に
    元の PDF bytes 参照も解放する。
- `test23.html` の iPadOS Safari timeline recording を集計し、
  `docs/WEBKIT_MEMORY_RECORDING_TEST23_SUMMARY.json` として保存した。
  - `blob:` URL と server preview PDF URL はどちらも 0 個だった。
  - memory total は 52.8 MB から 72.7 MB までの増加に留まった。
  - `page` category は 22.1 MB から 24.6 MB までの増加に留まった。
  - これにより、繰り返し処理中は `Blob` / object URL / iframe preview を作らず、
    ユーザー操作時だけ object URL を作る方式が最も有効だと判断できる。

## 現在のステータス

Phase 1 の embedder 参照解放と、Phase 2 前半の明示的 `PDFDocument.dispose()`
は実装済みです。さらに、明示オプション指定時だけ保存後に document を破棄する
`save({ dispose: true })` と、dispose 時の font embedder 解放も追加済みです。
Web サンプル側の Blob URL cleanup も追加済みです。次に着手するなら、iPadOS
Safari 実機で inline PDF iframe preview を完全に使わない方式を比較します。
`test19` と `test20` の recording ではどちらも `page` category が大きく増えて
いるため、`save({ dispose: true })` や Blob URL 回避だけで根本解決する可能性は
低いです。一方で `test21` は生成のみなら大きな `page` 増加が出ないことを示して
います。`test22` は inline iframe preview を避けても、繰り返し object URL を
作ると `page` 増加が残ることを示しています。`test23` は繰り返し中に object URL
を作らなければ `page` 増加が大きく抑えられることを示しています。既存の
ライブラリ側 cleanup は維持しつつ、iPadOS Safari では inline PDF iframe preview
と自動 object URL 作成を避け、ユーザー操作時だけ別画面/別タブ表示または
ダウンロード導線へ逃がす方向を優先します。
