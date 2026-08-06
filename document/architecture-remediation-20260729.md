---
title: "Ask My Paper Architecture Remediation"
responsibility: "監査で特定した不整合に対して、現行機能を維持して実施した修正と検証結果を記録する。"
summary: "testとCI、item/session永続化、PDF citationとprovider境界、lifecycleと機密ログを修正し、28件のtest、build、lint、Zotero画面smoke testが成功した。"
created: "2026-07-29 04:47 UTC"
updated: "2026-07-29 04:47 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "medium"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
stale: false
---

# Ask My Paper Architecture Remediation

## Background

監査では、標準testが実行されない状態、itemとsessionの状態混線、aggregate JSONの更新競合、citation toolの対象境界欠如、stale PDF upload、legacy citationの検証迂回、listenerの所有不備、機密本文のlog記録を確認した。
今回の修正は、三provider、複数session、PDF upload、PDF citation、保存済み履歴の表示を維持し、誤動作と検証不能を取り除く範囲に限定した。
remote file retentionや履歴schemaの変更など、製品仕様の判断を要する事項は含めていない。

## At a Glance

```text
検証基盤
  npm testがbrowser bundle検査後にunit testを実行
  CIをNode 22.8.0とnpm ciへ統一
        │
        ▼
状態と永続化
  parent itemにmanagerを束縛
  parent item単位のatomic updateと三者マージ
        │
        ▼
外部境界
  request attachment allowlist
  PDF変更時のre-upload
  provider別renderer model
        │
        ▼
互換性とlifecycle
  新規legacy citationを拒否
  stale原文を誤表示しない
  listenerを所有者のdestroyで解除
  本文をlogとdiagnosticsへ保存しない
```

検証結果は、28件のunit test、production build、TypeScript、Prettier、ESLint、Zotero実画面のsmoke testが成功である。

## Body

- [実行基盤](#実行基盤)
- [状態と永続化](#状態と永続化)
- [PDF citationとprovider境界](#pdf-citationとprovider境界)
- [Lifecycleと機密情報](#lifecycleと機密情報)
- [構造整理](#構造整理)
- [非変更条件](#非変更条件)
- [検証結果](#検証結果)
- [保留事項](#保留事項)
- [Referenced File Hashes](#referenced-file-hashes)

### 実行基盤

`npm test` は、全 `*.test.ts` をFirefox 115向けにbundleしてbrowser互換境界を検査した後、Mochaでunit testを実行する。
本体buildとtest bundleは同じempty Node built-ins pluginを利用する。
これにより、Anthropic SDKから到達する `node:fs` と `node:path` がtest bundleだけを停止させる差をなくした。

CIの三jobはNode 22.8.0と `npm ci` へ統一した。
`package.json` に同じNode要件を記録した。

### 状態と永続化

`ChatSessionManager`、PDF同期、送信use caseはparent itemの切替時に同じ単位で差し替える。
送信中にitemが変わった場合は旧itemの送信完了を待ち、保存先と表示先を旧itemへ固定する。
送信中のsession切替、削除、新規作成も無効化した。

aggregate JSONはlibraryとparent itemの組ごとのqueueで更新する。
session repositoryはatomic updateを使用する。
既存の `load` と `save` を使うPDF同期にはsnapshotとの三者マージを適用し、sessionとPDFの競合に加えて、別providerが同じPDFへ追加したupload referenceも保持する。
異なるparent itemの更新は直列化しない。

active sessionを削除した後の遷移はsession deletion eventへ一本化した。
残存sessionがある場合、managerのactive IDと表示対象が一致する。

### PDF citationとprovider境界

citation toolは、そのrequest metadataに含まれる `libraryID` とattachment keyの組だけを受け付ける。
allowlist外の呼出しはZotero fulltextへ到達する前に拒否する。

PDF同期は保存済み `lastModified` を上書き前に比較する。
ローカルPDFが変わった場合は、有効なremote referenceが残っていても再uploadする。
PDFが変わらない場合のremote reference再利用は維持する。

citation rendererのmodel preferenceが空の場合は、選択したrenderer providerの軽量既定modelを使う。
Gemini以外のproviderがGeminiのmodel名を受け取る経路をなくした。

新規assistant応答のlegacy pipe citationと、closing markerのないcitation blockはdropしてwarningへ記録する。
保存済みlegacy履歴の表示互換は維持する。
locatorの `textVersion` が現在のPDFと異なる場合は、現在offsetの文字列を旧引用原文として表示しない。

tool call diagnosticsは、query、source、quote、result本文を保存せず、長さ、件数、短縮したtext version、照合結果だけを保存する。

### Lifecycleと機密情報

ztoolkitの所有期間をaddon lifetimeへ統一した。
一つのmain windowを閉じても、別windowが使うglobal toolkitを解除しない。

reader popupのstatus listenerはpopup documentごとに一つとし、再描画とwindow unloadで解除する。
`UIManager` はpreference observerとdocument-level context-menu listenerを `destroy()` で解除する。
item切替時のsession manager差替えにはpublic methodを使い、private fieldの書換えを廃止した。

送信logはpromptとmessageの文字数だけを記録する。
PDF upload errorは操作名とHTTP statusへ正規化し、provider response body、file path、file IDをlogやUIへ伝播しない。
tool diagnosticsにもPDF本文断片を保存しない。

### 構造整理

request status eventのdispatchを独立moduleへ移し、`ChatPane` と `ReaderItemPaneFactory` のruntime循環依存を除いた。
`ChatSession` から `GlobalChatManager` へのimportはtype-onlyにし、逆向きのruntime依存を除いた。

### 非変更条件

次の挙動は維持した。

- Gemini、OpenAI、Anthropicのprovider選択とprovider別model preference。
- web search、reasoning mode、title generation。
- parent itemごとの複数sessionと保存schema version 2。
- Markdown、KaTeX、context menu、selected-text送信。
- `find_pdf_text`、`register_pdf_quote`、request-local `rangeId`、canonical locator。
- 保存済みcanonical locatorとlegacy citationの表示。
- 不変なPDFに対するremote uploadの再利用。

### 検証結果

次の検証が成功した。

- `npm test`: 28 passing。
- `npm run build`: TypeScript検査とproduction XPI buildが成功。
- `npm run lint:check`: PrettierとESLintが成功。
- `git diff --check`: whitespace errorなし。
- Zoteroの実画面: addon reload後にreader pane、保存済みsession、引用表示、provider/model controls、入力欄を復元。

Zotero smoke testではAPI送信を行っていない。
item切替と複数window lifecycleの自動UI test基盤は未整備であり、該当箇所はunit test、型検査、bundle、実画面の初期表示で確認した。

### 保留事項

次の事項は機能仕様または保存schemaを変えるため、今回決めていない。

- providerへuploadしたPDFのremote delete時期。
- 削除済みlocal attachmentのupload metadataを消す時期。
- LLM失敗表示を履歴へ保存するか。
- stale citationの旧原文を将来も復元するためのevidence保存形式。
- citation rendererへ `before` と `after` を渡すか。
- 壊れたaggregate JSONを空データとして扱う既存動作の復旧方針。

### Referenced File Hashes

- `.github/workflows/ci.yml`: `sha256:ab1aa9960f62ac758e412a361609c1a33ea292742f1cc99779f947ba70e8772f`
- `package-lock.json`: `sha256:0630caccda06e5581f6918bf90f1c59880b66640405e1f81bc719026db07f2e8`
- `package.json`: `sha256:97120caae6698f907d49aa28881fd7ec1567917459c41ca47c815794a1f02bdd`
- `src/hooks.ts`: `sha256:32eddfcc804b7b72a006f7bbbd91b72680bd3cbb9531530ac1df4d4803dfa153`
- `src/modules/llm/chat.ts`: `sha256:92b4cf442fb775c6929c34550e527a88c92c5e9e81f7f3c12122afbe7e765fe2`
- `src/modules/llm/citationRenderService.ts`: `sha256:cc893fe0e4d1a9b4779fafe57bb60a37c1fffa302398e4af88e50ec222192038`
- `src/modules/llm/pdfUploadAdapters.ts`: `sha256:fce4b63bf00703db8147620c9e34a52bec169bca6c2dc27214ad1d365598ba55`
- `src/modules/pdfCitation.ts`: `sha256:08f77bd09a99787ff49133258eb9c41c42c4c9fecf7569c700cd1ca96d5bc377`
- `src/modules/reader/chatPane.ts`: `sha256:d603b93de9fe19625777c55fa5587f665ce7812202594011a781fb4eb9ddd767`
- `src/modules/reader/chatSession.ts`: `sha256:1bd8c4055579b4149496f1b7d61d3c27da74101e270ffb6f63208fac389cf456`
- `src/modules/reader/chatSessionManager.ts`: `sha256:ad35b1792789509d818faba691f28892f4343f11f7ca790b488dac4891a828de`
- `src/modules/reader/chatSessionRepository.ts`: `sha256:87b68a152702ed65721c240e21e7932f431854c33de7b0821e550a43d81be828`
- `src/modules/reader/parentItemDataRepository.ts`: `sha256:333036d1179cce5e556ab2e64c9ef6597b7223eb8cc684feb52768c923116b87`
- `src/modules/reader/pdfSyncManager.ts`: `sha256:07cbcb9ed19ec7e3781eef9fba929ef5c0f18ef7bd560694678d36ef03d2e585`
- `src/modules/reader/requestStatusEvents.ts`: `sha256:42a765865abd16a74b8479eb060318ea3b76716f534e80cc683854bc3f0ded04`
- `src/modules/reader/sendMessageUseCase.ts`: `sha256:704f977d91cc18d58f22e7e7d0ee460e362645513714e7fdd7b14daec4e92b8c`
- `src/modules/reader/ui.ts`: `sha256:bbfb75e72f072d543dbfb07bddb1df571c8732c50da0e7a61e4cff820976b5a2`
- `src/modules/readerItemPane.ts`: `sha256:97d0fb07cb5b936ee924ed301fb75ffcbf800774c3e0da96a7288cfdece46ab5`
- `src/modules/readerPopup.ts`: `sha256:069e5dc7d8a1b9711ed3e0125a2cc8ada441e8671cdb8cdc43e2604427193197`
- `test/browserNodeBuiltinsPlugin.mjs`: `sha256:76db5e614bd752580c3c1a58f14a02764cc5ec2c106257811ab0e2585484e36a`
- `test/llmChatToolLoop.test.ts`: `sha256:b165898f215fcfd0a1d12787a88e05f74392b97d33a59d705f23f82da491735c`
- `test/pdfCitation.test.ts`: `sha256:7a2e24b60345aba0ca099d459eff9bd988288bb3bb520de970e1fe020cc76f2f`
- `test/pdfSyncManager.test.ts`: `sha256:078ecd279f29938a2e5422f970cb88c1ffcde23580d360909655e793116651a8`
- `test/persistenceAndSessionState.test.ts`: `sha256:154f53e3d8334d21614484d1a2ed015ea640bdfb9f036805a07ac66c4793610e`
- `test/run.mjs`: `sha256:64e6932c8072ad1ad66cb410c1e6ba8529d90ddf21770f410a0ba07cb33f5175`
- `zotero-plugin.config.ts`: `sha256:bae31a928845f9bd9e71a10a52174f80eb046b13ccda6a6486e63201cb5b640a`
