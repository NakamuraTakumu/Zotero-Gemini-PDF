---
title: "Ask My Paper Architecture and Specification Audit"
responsibility: "現行機能を維持したまま修正すべき仕様・設計上の不整合を、実行経路と検証結果に基づいて特定する。"
summary: "アイテム切替時の状態混線、aggregate JSONの更新競合、citation toolの対象境界欠如、stale PDF upload、legacy citationの検証迂回、標準test停止を優先修正対象とし、全面改修ではなく責務境界ごとの段階修正を提案する。"
created: "2026-07-29 04:28 UTC"
updated: "2026-07-29 04:47 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "medium"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
stale: true
---

# Ask My Paper Architecture and Specification Audit

## Background

Ask My Paperは、Gemini向けの単一provider実装から、複数provider、PDF upload、複数chat session、PDF citationへ機能を増やしてきた。
今回の調査では、既存機能を削除または変更せずに直せる仕様・設計上の不整合を特定した。
現在のdirty worktreeを正本とし、コード変更、providerへの送信、Zotero UI操作は行っていない。

## At a Glance

修正順序は、見た目の整理ではなく、データと境界を守れる順にする。

```text
Phase 1: 実行基盤
  標準testを実行可能にする
      ↓
Phase 2: 状態と永続化
  item/session/PDF contextを同じ所有単位へ束縛する
  parent item単位でaggregate JSON更新を直列化する
      ↓
Phase 3: 外部境界
  citation toolのattachment allowlist
  PDF更新時のupload invalidation
  logとprovider errorのredaction
      ↓
Phase 4: 互換経路とlifecycle
  legacy citationを生成時と履歴表示時で分離する
  window/pane/listenerの所有者を一意にする
      ↓
Phase 5: 構造と文書
  循環依存・重複責務・相反する設計記録を整理する
```

Phase 1から4は、正常系の機能を変えず、現在の誤動作、データ消失、情報露出を止める修正である。
Phase 5は、先行修正に回帰testが付いた後で行う。

## Body

- [調査基準](#調査基準)
- [実行基盤](#実行基盤)
- [状態管理](#状態管理)
- [永続化](#永続化)
- [PDFとproviderの境界](#pdfとproviderの境界)
- [Citation](#citation)
- [Lifecycleと機密情報](#lifecycleと機密情報)
- [構造](#構造)
- [仕様書と設計記録](#仕様書と設計記録)
- [健全な実装](#健全な実装)
- [修正時の非変更条件](#修正時の非変更条件)
- [判断を保留する事項](#判断を保留する事項)
- [検証状態](#検証状態)
- [Referenced File Hashes](#referenced-file-hashes)

### 調査基準

優先度は次の意味で使う。

- **P0**: test不能、データ混線、またはデータ消失によって、他の修正を安全に進められない。
- **P1**: 正常な操作またはLLM入力から、誤った対象へのアクセス、古い情報の利用、機密情報の記録、明確な操作失敗が生じる。
- **P2**: 現在の仕様と実装が食い違うか、所有者の重複によって変更時の回帰可能性が高い。
- **P3**: 直ちに機能を壊さないが、互換性、診断、文書の解釈を曖昧にする。

「機能を変えない」とは、三provider、PDF upload、chat session、title generation、Markdown/KaTeX表示、PDF citation、保存済み履歴の読取りを維持することを指す。
誤ったitemへ送る、古いPDFを使う、壊れたcitationを有効扱いする、といった挙動は維持対象ではない。

### 実行基盤

#### P0: 標準testが一件も実行されない

`npm test` は、test entryをZoteroで実行する前のbrowser bundleで停止する。
`test/llmChatToolLoop.test.ts` から `chat.ts`、`chatProviderAdapters.ts`、Anthropic SDKへ依存が到達し、SDK内の `node:fs` と `node:path` をtest bundlerが解決できない。
本体buildだけは `zotero-plugin.config.ts` のshimを使うが、scaffoldのtest bundlerはそのpluginを継承しない。

本体をNode向けに変えるのではなく、Firefox targetを保ったままtest bundleにも同じbrowser互換境界を適用する必要がある。
修正後は、test entryのbundle成功自体を回帰testまたはCI gateにする。

#### P1: CIのNode versionと依存packageの要件が一致しない

CIはNode 20を使うが、lock済みの `zotero-plugin-scaffold@0.8.2` はNode 22.8以上を要求する。
CIとlocalのNode versionを22.8以上へ統一し、`package.json` にengineを明記するのが保守的である。

CIはlockfileがあるにもかかわらず `npm install` を使う。
すべてのjobを `npm ci` にそろえ、同じ依存集合でlint、build、testを実行する必要がある。

#### P1: lint gateがHEADの時点で失敗する

`npm run lint:check` はPrettierで停止する。
TypeScript型検査とESLint単体は成功するため、既存7ファイルのformatを機械的に直せばgateを復旧できる。

### 状態管理

#### P0: item切替後も前itemのsession managerを使う

`ChatPane.render()` はpane生成後に `ChatSessionManager` を一度しか初期化しない。
Zoteroの `onRender` はitem変更時にも同じpaneへ呼ばれるが、再描画時に更新するのは `zoteroContext.actualParentItem` だけである。

このため、item Aからitem Bへ切り替えると、画面とactive sessionはAのまま、PDF同期対象だけがBになる。
送信時にはAの履歴へBのPDF contextを渡し、保存先と根拠PDFが分離する。

managerの初期化単位をpaneではなくparent item keyにする必要がある。
同じitemの再描画では既存managerを再利用し、keyが変わったときだけUI、session manager、send use caseを同じ順序で破棄・再生成する。

#### P1: 送信中のsession操作で保存先と表示先が分かれる

送信処理は開始時のactive sessionを保持してPDF同期とLLM応答を待つが、無効化するのはinputとsend buttonだけである。
待機中にsession切替、新規作成、削除を行うと、保存は開始時sessionへ行い、応答表示は現在のpaneへ追加する。
削除済みsessionを保存して復活させる経路も残る。

送信をsession IDへ束縛し、完了時にactive/deleted状態を確認する必要がある。
UI操作を待機中だけ無効化する方式でも正常機能は維持できるが、複数paneの並行利用まで止めないよう範囲をsession単位に限定する。

#### P1: active session削除後にactive IDがnullへ戻る

削除event listenerは残存sessionへ同期的に切り替える。
そのlistenerが戻った後、削除呼出元が `_activeSessionId = null` を実行するため、UIにsessionが表示されていても次の送信はactive sessionなしとして失敗する。

active IDの遷移をevent listenerか削除use caseの一方だけに持たせる必要がある。

### 永続化

#### P0: aggregate JSONのread-modify-writeが更新を失う

session保存とPDF metadata同期は、別々のrepository instanceからparent itemのaggregate JSON全体を読み、変更後の全体を書き戻す。
parent item単位のmutexまたは更新queueがないため、別sessionの送信、title生成、別providerのPDF同期が重なると、遅い書込みが他方の変更を古いsnapshotで上書きする。

`ParentItemDataRepository` にparent item key単位のatomic update境界を置く必要がある。
個別repositoryがloadとsaveを別々に呼ぶ形をやめ、更新関数をqueue内で実行すれば、現在のaggregate形式と並行UIを維持できる。

#### P2: 読取失敗を空データへ変換して既存データを上書きする

aggregate JSONのparse失敗は空のmetadataとして扱われる。
次回のsession保存またはPDF同期は、その空データを既存attachmentへ書き戻すため、破損、一時的なread失敗、将来schemaをデータ初期化へ変換する。

parseまたはschema validation失敗は書込み禁止のerrorとして上位へ返す必要がある。
復旧する場合も、元attachmentを保持した明示的なbackup/migration経路に分ける。

#### P2: aggregate schemaの検証範囲が狭い

現行検証はsessionのversion、chat ID、messages配列を中心とし、file/upload reference、metadata timestamp、StoredMessageのshapeを十分に検証しない。
aggregate自体にもschema versionを持たせ、未知recordを削除せず隔離する方が、保存済みデータの互換性を守りやすい。

### PDFとproviderの境界

#### P1: citation toolがrequest対象外のattachmentを読める

toolはLLMから受け取った `libraryID` と `attachmentKey` をそのままZoteroへ渡す。
現在のrequest metadataに含まれるattachmentとの照合がないため、モデルが別itemの既知keyを指定すると、そのfulltextをtool resultとして外部providerへ返せる。
PDF本文中のprompt injectionも同じtool引数を生成し得る。

`createPdfCitationTools` へrequest-scopedなattachment allowlistを渡し、両toolの実行直前に完全一致で検証する必要がある。
現在のparent itemに属する複数PDFはすべて許可し、対象外keyだけをtool errorにする。

#### P1: ローカルPDF更新後も古いprovider uploadを使う

PDF同期処理は現在のmodification timeを取得するが、保存済み時刻と比較する前にmetadataへ代入する。
再uploadの判断はremote referenceの存在確認だけなので、ローカルPDFが変更されてもprovider上の旧fileを使い続ける。
`docs/chat_log_format.md` が定義する `lastModified` のstale判定責務も実装されていない。

保存済み時刻と現在時刻を先に比較し、変更時だけremote availabilityに関係なく再uploadする必要がある。
PDFが不変でremote referenceが有効な場合に再uploadしない現在の費用抑制は維持する。

#### P1: citation rendererのprovider別default modelがない

citation renderer providerは設定でOpenAIまたはAnthropicへ変えられるが、model未指定時は常にGeminiのmodel名へfallbackする。
providerを解決した後、そのproviderのdefault citation modelを選ぶ必要がある。
既定のGemini provider/modelと、ユーザーが明示したmodelは変えない。

#### P2: native toolの生成責務が二重

adapterの `buildInvokeOptions()` とcallerの双方が `buildNativeTools()` を呼び、別objectを生成する。
citation tool loopはinvoke options内のtoolsを捨て、caller側で生成したtoolsだけをbindする。

provider request descriptorを一度だけ作り、direct invokeとtool-bound invokeの双方をそこから構成する必要がある。
local citation toolとprovider-native web searchを同じrequestで使える現在の能力は維持する。

### Citation

#### P1: 旧pipe形式が完全一致検証を迂回する

UI rendererは `::: citation source|quote` を有効なcitationとして受け入れ、LLMが出したquoteをhover原文に使う。
一方、生成直後のnormalizerはJSON形式だけを処理するため、この旧形式は `register_pdf_quote`、rangeId、textVersion、一意性検証、drop/warningをすべて迂回する。
現行仕様が互換対象として明記するのはlegacy locatorであり、pipe形式ではない。

新規LLM応答ではpipe形式をdropしてwarningへ記録し、既存保存履歴を読むrendererだけに必要な互換処理を残す必要がある。
生成時のstrict parserと履歴表示時のtolerant parserを分けるのが安全である。

#### P1: stale locatorの現在位置を旧引用原文として表示する

PDFのhashが変わった場合も、hover recoveryは旧offsetで現在本文をsliceし、warningを付けてその文字列を表示する。
PDF編集によってoffsetが移動すると、旧citationと無関係な現在本文が「引用原文」に見える。

stale時は現在sliceを原文として表示せず、根拠を復元できない旨だけを表示する必要がある。
旧原文を常に表示するにはimmutable evidenceまたはfingerprintを保存するschema変更が必要なので、今回の非変更範囲とは分ける。

#### P2: citation render inputの仕様と実装が違う

registryと公開仕様は `before` / `after` を保持し、render LLMの補助contextに使うと定める。
実際のserviceへ渡すのは `rawText` とPDFだけであり、contextは途中で失われる。

表示出力を変えないことを優先するなら、まず現行実装に合わせて仕様と不要な型を削る。
contextを追加する案はrenderer出力を変え得るため、別の明示判断が必要である。

#### P2: diagnosticsへPDF原文previewを永続化する

tool diagnosticsはquoteとsource textの先頭160文字をassistant metadataへ保存する。
設計記録は長さと照合結果を保存する契約であり、previewの永続化は不要である。
長さ、成功/失敗code、短縮textVersion、rangeIdだけへ縮めても回答機能は変わらない。

#### P3: closing markerのないcitation blockを自動修復する

JSON citation parserは終了 `:::` がなくてもmessage末尾までをblockとして扱い、canonical blockへ変換する。
後続proseまでcitation bodyとして扱うため、新規応答ではmalformedとしてdropとwarningにする方が現行契約に合う。

### Lifecycleと機密情報

#### P1: promptと選択PDF本文をlogへ全文出力する

通常送信は `messageText` と `promptText` を、selection送信はevent detail、full prompt、summary textをそのまま `Zotero.log` へ出す。
ユーザーの質問と論文抜粋が永続logへ残る。

event種別、pane/item ID、文字数だけを記録し、payloadはlogへ出さない必要がある。
chat履歴へ保存する現在の機能とは独立して修正できる。

#### P1: provider error bodyをlogとUIへ渡す

Anthropic file lookupはHTTP body全体を `Error.message` に入れる。
PDF同期はそのmessageを複数回logへ書き、UIにも表示する。
SDK errorの文字列化も同じ経路を通る。

内部判定にはraw errorを使い、logとUIにはstatus、分類、上限付きのsanitized messageだけを渡す必要がある。

#### P1: 複数windowでztoolkitの所有者が入れ替わる

window loadごとに単一の `addon.data.ztoolkit` を置き換え、どのwindowのunloadでも現在のglobal toolkitへ `unregisterAll()` を呼ぶ。
window Aの後にBを開き、Aを閉じると、Bの登録を解除し、Aのtoolkitは参照不能になる。

toolkitをwindowごとのmapで所有し、各windowのunloadでは対応instanceだけを解除する必要がある。
addon lifetimeの登録とwindow lifetimeの登録も分ける。

#### P2: paneとpopupのcleanupが完結しない

`UIManager` はpref observerとdocument listenerを登録するが、解除処理が `ChatPane.destroy()` から呼ばれない。
selection popupは表示のたびにmain documentへlistenerを追加し、明示的にcleanupしない。

各objectにidempotentな `destroy()` を持たせ、作成者が必ず呼ぶ所有関係に統一する。
popup hookがcleanupを提供しない場合は、document listenerを一つに集約する。

### 構造

#### 循環依存

静的import graphには二つの循環がある。

```text
GlobalChatManager ↔ ChatSession
ReaderItemPaneFactory ↔ ChatPane
```

前者はsessionがglobal managerへ保存を委譲し、managerがsessionを生成するために生じる。
後者はfactoryがpaneを所有し、paneがrequest status dispatchのためにfactoryへ戻るために生じる。
repository/callbackをconstructorから注入する既存方針を徹底すれば、機能を変えずに切れる。

#### 責務が集中したmodule

`ui.ts` は約1120行で、Markdown sanitize、citation rendering、diagnostics、provider controls、context menu、DOM lifecycleを持つ。
`pdfCitation.ts` は約1024行で、tool schema、検索、quote登録、registry、block parser、normalization、recovery、diagnosticsを持つ。

先に回帰testを追加し、その後に「純粋parser」「Zotero text access」「request-local registry」「UI component」の境界で分割する。
行数だけを理由に分割せず、今回確認した所有権と検証境界に沿わせる。

#### 重複した状態と処理

provider model list/defaultは `addon/prefs.js` と `providerConfig.ts` に重複する。
chat resizerはpane-local handlerとdocument delegationの二経路が同じdragを処理する。
重複を一方の正本へ集約し、現在のdefault値とresize結果を回帰testで固定する必要がある。

### 仕様書と設計記録

現行仕様の候補は `docs/pdf_citation_format.md` と `docs/chat_log_format.md` だが、`document/` に相反する設計案が実装指示の文体で残る。
たとえばhost-driven設計はLLMへcitation toolを渡さないと定めるが、現行実装はtool calling方式である。
旧 `read_pdf_text_range` を前提とする記録も複数ある。

さらに、古い8文書にはdocument-workflow用metadataがなく、一覧commandが状態を判定できない。
quote-registration specは内容が現行方式に近いが、参照hashが変更前snapshotのため `review-required` である。
requirements文書は実装方式から独立すると宣言しながら、古いtool-call-position文書のhashへ依存する。

設計記録を削除せず、採用前提案には `stale: true` またはsupersededを明記する。
現行仕様の正本を `docs/` の二文書に限定し、履歴記録から正本へ一方向に参照させる。

### 健全な実装

次の経路は今回の監査で設計意図と実装が一致した。

- `register_pdf_quote` はcurrent textVersionを検証し、quoteとoptional source textの完全一致・一意性からoffsetを内部計算する。
- request-local range registryはunknown、empty、staleなentryをdropし、warningへ記録する。
- 保存済みlocatorは次turnのLLMへoffset JSONのまま渡さず、復元したevidence contextへ変換する。
- GeminiとOpenAIの実送信で、通常の `find_pdf_text` → `register_pdf_quote` → canonical citationが成功している。
- assistant MarkdownはDOMPurifyを通り、user messageは `textContent` で描画される。
- citation URLはHTTP(S)へ制限される。
- PDF file streamはfinallyでcloseされる。
- remote availabilityのnetwork/auth/5xxを「file不存在」と誤認して再uploadしないため、障害時の費用burstを避ける。
- PDF同期の同一item/provider処理と、同一sessionの送信にはin-flight重複防止がある。
- title generationは通常chatのweb searchとreasoningを無効化する。

### 修正時の非変更条件

修正は次の条件をtestで固定してから行う。

- 三providerの選択、provider別model preference、web search、reasoning modeを維持する。
- 同一PDFが不変かつremote referenceが有効ならuploadを再利用する。
- parent itemごとの複数sessionと、保存済みschema version 2を読み続ける。
- 正常なMarkdown、KaTeX、context menu、title generation、selected-text送信を維持する。
- `find_pdf_text`、`register_pdf_quote`、request-local rangeId、canonical locatorの現行契約を維持する。
- 既存のcanonical locator履歴を表示し、次turnのevidenceとして利用する。
- Gemini/OpenAI live testで確認した引用結果をgolden fixtureとして再現できるようにする。

### 判断を保留する事項

次の事項は、機能を変えない修正として自動的に決められない。

- providerへuploadしたPDFをいつremote deleteするか。
- 削除済みローカルattachmentのupload referenceをいつaggregate JSONから消すか。
- LLM失敗表示をtransient UIとして消すか、履歴へ永続化するか。
- stale citationの旧原文を将来も表示するため、raw evidenceまたはfingerprintを保存するか。
- citation rendererへ `before` / `after` を渡して表示文を変えるか、現行実装へ仕様を合わせるか。

これらはretention、履歴schema、表示契約を変えるため、修正段階でユーザー判断を得る。

### 検証状態

調査は5領域の独立したread-only監査と、親agentによるcaller/calleeの再読で行った。
`npx tsc --noEmit` とESLint単体は成功した。
本体のFirefox 115 target bundleはbrowser shim込みで成功する。
標準 `npm test` はtest bundleで停止するため、既存test suiteを品質証拠として利用できない。
`npm run lint:check` は既存のPrettier違反で失敗する。

今回の調査では実装fileを変更していない。
新規作成したのは本記録だけである。

### Referenced File Hashes

- `.github/workflows/ci.yml`: `sha256:b7a45de264241d2b2d763d4b4c414d96779802b4cc0a4ad82314825fd45ec563`
- `addon/prefs.js`: `sha256:5399b86bfa619effeecedccfb5fbfb2b3056c9c2d59e3206f32a1c5988265ad5`
- `docs/chat_log_format.md`: `sha256:77ae63f51269da6a806dd507acccd6ae02c2c18acec988041eb55423b2775ed8`
- `docs/pdf_citation_format.md`: `sha256:27c0c3fdaa473e49ba9b6020087586d9e41880ba8e180bfadaa65519d602e64e`
- `document/pdf-citation-host-driven-design.md`: `sha256:fd5831d718970f0ad84bc77f30ff751333b4571512a15dfe8cd73ccb44f85187`
- `document/pdf-citation-quote-registration-spec.md`: `sha256:30e1cf7483d05da4985e5c2b278302b64daaa41089d0c3002184fd664601da60`
- `document/pdf-citation-requirements.md`: `sha256:43837ead062bede81768e60e232d31b5d255a8249a9870961cd9a8e4d4ba039e`
- `package-lock.json`: `sha256:301e9c9a1cdc9a83229bac18d576aa99f7fb9b154d25abe516a1815666f61976`
- `package.json`: `sha256:ede04188c77f9912caea8b0c0362acb6a140eef1e771b345252952d9264627e3`
- `src/hooks.ts`: `sha256:60816e714b9011990e5abde6d1a8315fb939a7d688da4abda9aaf2f513398a69`
- `src/index.ts`: `sha256:dcbcc973438cffdb09da2dd2da3b2c4c2598ca056a946ce4d6dd112f78006932`
- `src/modules/globalChatManager.ts`: `sha256:830cea5876b50ea9139926328ad5f4521444ca8741a3c2a95968bee6bd59442a`
- `src/modules/llm/chat.ts`: `sha256:be7df4b35749a219f1fa542f1025017006bf30d1a75153fa3053c14a8a9e0fdd`
- `src/modules/llm/chatProviderAdapters.ts`: `sha256:52cd86dd75955ea36ec89f41d07535e5d5f3327ca307e1ee1d172e79a87f096b`
- `src/modules/llm/citationRenderService.ts`: `sha256:13177e699c6719f090f9e1759fb39e40329c8f71e026455082354a6733ef9ef1`
- `src/modules/llm/pdfUploadAdapters.ts`: `sha256:1fc4adbf5ed8bf453a3832e3442144c51fb1512a8f09d02f9176a24af2eba5aa`
- `src/modules/pdfCitation.ts`: `sha256:54b1485a7e234aa2241fd008d87cdc6923587ff82cfd020b25b894e1dc1fa8f9`
- `src/modules/reader/chatPane.ts`: `sha256:6c90edc223d4b82d0dd2631c322a4e6e9381e9255b95693659eb46f196e2d558`
- `src/modules/reader/chatSession.ts`: `sha256:3af4b795f524985e672a69dc71ab181947e010f2c8c282da95e2f09c85bfcfa3`
- `src/modules/reader/chatSessionManager.ts`: `sha256:6500a483d3ad5a298460bea1bac8f2793da2bb635e2e0d5978e33757ab3b711b`
- `src/modules/reader/chatSessionRepository.ts`: `sha256:db07d486b2bdd22edd817c268cdc858eeea015696d08be06cb8d3d742a695884`
- `src/modules/reader/parentItemDataRepository.ts`: `sha256:f9ce63f8bf94d4db9bb077d407e580cd8134bf648184214c4b2250cdc37e24f8`
- `src/modules/reader/pdfSyncManager.ts`: `sha256:82b2daacd60599c6702f2a9b45afa3a26f385df9744dee3f71f3a8225de29656`
- `src/modules/reader/sendMessageUseCase.ts`: `sha256:faddfc7b92ccb0761ce8b5784862dfbcc4ca1cd0e0fceb3a3c922204e69f4954`
- `src/modules/reader/ui.ts`: `sha256:ea6e43e933d97e19395b48890bf1f50e3b8acf6ac0e53e91fef6d4f361bf684c`
- `src/modules/readerItemPane.ts`: `sha256:2a9204cc611f83118df42c41d6a3a23ca3a220334764f1231466ad26eab96af1`
- `src/modules/readerPopup.ts`: `sha256:41d7040feddb946ba5e963447e2c059a0f20717ec1e8ced532956a0f5f327b4c`
- `src/utils/eventEmitter.ts`: `sha256:3388e2726e7e4dcf2acdc4225211fb0a08d75f9bc08b1925ceab9084b125f060`
- `src/utils/providerConfig.ts`: `sha256:23501bf46f1cf1f0787ba3936d00809b2b1638b554ad27f7c3e499dcac62c88b`
- `test/llmChatToolLoop.test.ts`: `sha256:313af3e21363b538d9e74484594e149fdfc43b33b32519ffd80fb424c691fea2`
- `zotero-plugin.config.ts`: `sha256:4034fe3ee510e8240e4e5f401259efefa3e737f33af7b10ba9fd48a74279ffba`
