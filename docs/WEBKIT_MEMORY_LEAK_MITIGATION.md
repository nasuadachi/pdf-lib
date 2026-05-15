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

- [Qiita: 10年前からあるSafariのメモリリーク問題が結構やばい](https://qiita.com/RepublicOfKorokke/items/90c9f49d8b8697ae0427)
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

## 現在のステータス

Phase 1 の embedder 参照解放と、Phase 2 前半の明示的 `PDFDocument.dispose()`
は実装済みです。さらに、明示オプション指定時だけ保存後に document を破棄する
`save({ dispose: true })` と、dispose 時の font embedder 解放も追加済みです。
次に着手するなら、Web サンプル側の Blob URL cleanup と、iPadOS Safari での
手動ストレステスト導線を別コミットで追加します。
