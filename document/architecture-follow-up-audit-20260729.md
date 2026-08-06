---
title: "Ask My Paper Follow-up Architecture Audit"
responsibility: "前回修正後の実装に残る不具合と、新たに混入した回帰を、再現可能な実行経路に基づいて特定する。"
summary: "libraryをまたぐ状態混線、rapid render競合、並行削除の復活、partial upload failureによる古いPDF再利用、citation検証迂回、provider設定分離、release gate不整合を優先修正対象として確認した。"
created: "2026-07-29 05:01 UTC"
updated: "2026-07-29 05:01 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "medium"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
stale: false
---

# Ask My Paper Follow-up Architecture Audit

## Background

前回の修正では、標準test、item切替、aggregate JSON更新、citation allowlist、PDF更新判定、listener lifecycle、機密logを対象にした。
今回の監査では、その修正後のdirty worktreeを正本とし、既知の保留事項を除いて、残存不具合と修正で混入した回帰を調べた。
調査はread-onlyで行い、実装file、test、設定、Zotero dataを変更していない。

## At a Glance

修正順序は、異なるデータを同じものとして扱う問題から始める。

```text
Phase 1: 所有identityと非同期世代
  libraryID + item keyを唯一のidentityにする
  rapid renderとpane destroyをgenerationで無効化する
      ↓
Phase 2: 永続化の削除・失敗原子性
  concurrent deletionを復活させない
  upload成功時だけtimestamp/refをcommitする
  migrationとtitle generationをdelete-safeにする
      ↓
Phase 3: request snapshot
  provider/model/PDF attachment setを送信開始時に固定する
  stale metadataをtool allowlistから除く
      ↓
Phase 4: citation入力をstrictにする
  current responseはregistered rangeIdだけを受ける
  malformed、legacy、code fence、inline containerを拒否する
      ↓
Phase 5: lifecycle・log・release gate
  window-local routing、error redaction、release CIをそろえる
```

Phase 1と2は別itemへの送信、削除済みデータの復活、古いPDFの利用を防ぐため、ほかの整理より先に直す。

## Body

- [監査基準](#監査基準)
- [所有identityと非同期処理](#所有identityと非同期処理)
- [永続化とPDF同期](#永続化とpdf同期)
- [Request境界](#request境界)
- [Citation入力](#citation入力)
- [Lifecycleと機密情報](#lifecycleと機密情報)
- [実行基盤と型](#実行基盤と型)
- [仕様書の不一致](#仕様書の不一致)
- [確認できた健全性](#確認できた健全性)
- [推奨する修正単位](#推奨する修正単位)
- [Referenced File Hashes](#referenced-file-hashes)

### 監査基準

優先度は次の意味で使う。

- **P0**：別libraryまたは別itemのデータを誤って利用するか、削除済みデータを復活させ、保存内容の正本を信用できなくする。
- **P1**：通常操作または非同期処理の競合により、誤ったPDF、session、provider、引用を利用する。
- **P2**：壊れた入力を有効扱いするか、lifecycleと検証基盤の不足によって回帰を検出できない。
- **P3**：直ちに実行時故障を起こさないが、型、package、設定の正本を誤らせる。

既知の保留事項であるremote PDF削除時期、失敗messageの履歴保存、stale citation原文の新保存形式、壊れたaggregate JSONの復旧方針は再掲しない。

### 所有identityと非同期処理

#### P0: libraryを含まないitem identity

`ParentItemDataRepository` のqueueだけは `libraryID:key` を使うが、`GlobalChatManager` のcacheとevent、`ChatSessionManager`、`ChatPane` のmanager差替え、送信のin-flight key、PDF同期のin-flight keyはitem keyだけを使う。
Zotero item keyはlibraryをまたいで一意ではない。

異なるlibraryに同じkeyのparent itemがあると、後から開いたitemは先にcacheされた `ChatSession` を受け取り、先のitemへ会話を保存または削除し得る。
PDF同期も別libraryの進行中Promiseとmetadataを共有し、別PDFのupload referenceを返し得る。

保存schemaの `zoteroParentItemKey` は維持し、runtimeの所有identityだけを `libraryID:key` へ統一する。
cache key、event payload、pane判定、send/sync guardを個別に直すのではなく、一つのidentity helperを正本にする。

#### P0: rapid renderの世代競合

`ChatPane.render()` は直列化されず、item B用managerの `init()` がsession loadを待つ間にitem Cのrenderを開始できる。
C側がB managerをdestroyしても、Bのload解決後に `init()` はlistenerを登録し、B側renderの後段は現在のC用UIを操作する。

この競合は、破棄済みmanagerのlistenerを残し、Bのsession eventでC paneを再描画し得る。
初期化中に複数renderが入る場合は `UIManager` とpreference observerも重複作成し得る。

paneにlatest-winsのgenerationを持たせる。
managerもdestroy flagを持ち、await後とlistener登録前にgenerationまたはdestroy状態を検査する。

#### P1: pane破棄後の非同期UI更新

paneをdestroyしても進行中のPDF同期とLLM送信はinvalid化されない。
`SendMessageUseCase` はawait後に、destroy済み `UIManager` のdetached DOMへmessageを追加または更新する。

requestの永続化は継続できるが、pane generationまたはAbortSignalによりdestroy後のUI更新をno-opにする必要がある。

### 永続化とPDF同期

#### P0: concurrent deletionの復活

三者マージは、snapshotとproposedに同じrecordが残り、latestだけから消えた場合にproposedを採用する。
`latest=[]`、`snapshot=[deleted]`、`proposed=[deleted]` を `mergeRecords()` に渡すと `[deleted]` が返ることを再現した。

PDF同期がaggregateをloadした後にsessionを削除し、PDF同期が古いsnapshotをsaveすると削除済みsessionが復活する。
file recordにも同じ問題がある。

proposedでrecordがsnapshotから変更されていなければ、latest側の削除を保持する。
同じrecordに対する明示削除と明示更新が競合する場合の優先順位はtestで固定する。

#### P1: partial upload failureによる古いPDF再利用

PDF同期はre-upload成功前に `lastModified` を新しい値へ更新する。
複数PDFのうち、変更済みPDF Aのuploadが失敗し、PDF Bが成功すると、aggregate全体のsaveによりAの「新timestampと旧remote ref」が保存される。

次回同期ではAを未変更と判定する。
旧remote refがavailableなら再-uploadせず、LLMは古いPDFを利用する。

uploadが必要なfileは、成功時にだけtimestampとprovider refをcommitする。
別PDFの部分成功を保存する現在の挙動は維持できる。

#### P1: title generationによるsession復活

初回title generationはbackgroundで実行される。
generation中にsessionを削除しても、完了後の `saveSession()` はupsertとして働き、同じchat IDをaggregateへ再追加する。
手動title再生成と削除の競合にも同じ経路がある。

`ChatSession` にdeleted状態を持たせるか、save前にmanagerが現在も所有するsessionかを確認する。
削除後の非同期saveはno-opにする。

#### P1: legacy migrationの削除順序

per-session attachment migrationは、historyを読み取った直後にsource attachmentを削除し、その後にaggregateへ保存する。
aggregate update、attachment作成、JSON書込みが失敗すると、sourceと移行先の両方からhistoryを失う。

aggregateへの永続化を先に成功させ、その後でlegacy attachmentを削除する。
cleanup失敗時のduplicateは、data lossより安全である。

### Request境界

#### P1: provider snapshotの分離

PDF同期は開始時のchat providerを読むが、`ChatSession.sendMessage()` は同期完了後にglobal preferenceを再読する。
同期中にproviderがAからBへ変わると、A用uploadだけを準備してBへchat requestを送る。
Bのcontent adapterはB用upload refがないPDFを省くため、PDFなしの回答になる。

同じpaneのselectorをdisableするだけでは、別paneからのglobal preference変更を防げない。
送信開始時にprovider、model、citation renderer provider/modelをrequest contextへsnapshotし、PDF同期からchatとrendererまで渡す。

#### P1: stale attachment metadataを含むallowlist

PDF同期は現在のchild PDFを列挙するが、`metadata.files` から削除済みattachment recordを除かない。
tool attachment contextとallowlistはmetadata全件から作るため、parent itemから外したPDFもrequest内のtool対象として残る。

remote upload metadataをいつ削除するかというretention判断とは分離し、送信用metadataをcurrent attachment setでfilterする。

#### P1: citation rendererのprovider/model不一致

renderer providerをOpenAIまたはAnthropicへ変更しても、保存済み既定modelは `gemini-3.1-flash-lite` のままである。
rendererはmodel preferenceが空の場合だけprovider別fallbackを使うため、Gemini model名を別provider adapterへ渡す。

providerのmodel listに含まれるかを検証し、無効または空ならそのproviderの既定renderer modelを使う。
ユーザーが指定したcustom modelを維持する規則も必要である。

#### P2: Gemini 403のavailability分類

Gemini file lookupの403 permission errorをmissing fileとして扱い、再-uploadへ進む。
credentialまたは権限問題ならuploadも解決せず、requestと費用だけを増やす。

structured reasonからresource missingとcredential/permissionを分離する。
別credentialが所有しないfileを再-uploadする扱いは仕様判断が必要である。

### Citation入力

#### P1: new responseのlegacy locator迂回

current response normalizerは `rangeId` がないJSON blockをlegacy locatorとして受理する。
次の入力がquote登録とrequest-local registryを通らずcanonical化されることを再現した。

```markdown
::: citation {"locator":{"libraryID":1,"attachmentKey":"A","start":1,"end":3}}
untrusted
:::
```

normalizerは現在PDFの `[1,3)` を読み、`normalizedCount: 1` としてtext version付きlocatorへ変換した。
current responseではregistered `rangeId` だけを許可し、保存済み履歴のcanonical locatorはrendererとhistory adapterだけで扱う。

#### P1: legacy pipe拒否の迂回

legacy pipe detectorはsource先頭が `{` の場合を除外する。
次の入力はdropもwarningもなく残り、UIのより広いlegacy grammarがcitationとして描画することを再現した。

```markdown
::: citation {legacy source}|unverified quote
:::
```

JSONとの区別をsource先頭文字に依存させず、JSON parseの成功結果で判定する。

#### P1: text version欠損locatorの表示

public formatはcanonical locatorの `textVersion` を必須にするが、parserはoptionalとして受理する。
version欠損時はstaleではないと判定するため、PDF更新後に同じoffsetが別の文章を指しても、その現在文字列を旧citation原文として表示する。

欠損する保存済みlocatorは検証不能として本文を返さず、既存履歴の近傍に警告する。

#### P2: malformed locator validation

locator parserは整数性だけを検査し、負のstartと `end <= start` を受理する。
`start=-1,end=1` が有効なlocator objectとして返ることを再現した。

parser境界で `start >= 0`、`end > start`、正規text versionを検査する。

#### P2: Markdown構文を無視するblock parser

block parserはfenced code stateを持たないため、code fence内のcitation例を実citationとして一件検出する。
同じparserは行内の `Claim. ::: citation ...` も検出するが、Markdown container rendererはそれを正しいcontainerとして描画しない。

strict parserは最大三spaceのindentを許した行頭だけを開始位置とし、backtickとtildeのfenced code内を無視する。

#### P3: surrogate pairのcontext分断

検索結果の前後contextはUTF-16 code unit固定長でsliceするため、境界がemojiなどのsurrogate pair中間に入るとlone surrogateを含む `sourceText` を返す。
locatorとquoteのUTF-16契約は維持し、context境界だけをpair外へ一code unit調整する。

### Lifecycleと機密情報

#### P1: selected textのglobal混線

selection popup作成時にglobal `lastSelectedText` を上書きし、button click時にその最新値を読む。
item Aのpopup表示後にitem Bで選択し、Aのbuttonを押すと、Bの選択本文をAのparent itemとsessionへ送る。

popup eventのannotation textをimmutable closureとして保持する。
global fieldを送信sourceに使わない。

#### P1: 複数windowのpane routing

popupは全window共通pane mapからitem IDだけで送信先を探し、最後に一致したpaneを使う。
同じitemを複数windowで開くと、別windowのpaneへselected-text actionを送信し得る。

paneのowner document/windowをidentityに含め、popupのreader documentと同じownerだけを候補にする。

pane action、request status、confirm dialogは毎回 `getMainWindow()` を評価する。
登録後にmain windowが変わると、destroyは登録先とは別documentからlistenerを外し、旧listenerを残す。
pane-local eventはowner documentへ束縛し、window間statusはaddon-owned event emitterへ分ける。

#### P1: logとerrorの未処理経路

PDF同期はPDF titleとabsolute pathをlogへ出す。
session saveと削除はユーザー依頼由来のtitleをlogへ出す。

citation rendererのprovider errorはsafe upload wrapperを通らず、normalizer warning、log、assistant diagnostics、保存履歴、UIへ生messageが流れる。
tool loop errorにもlocal tool exception messageをlogとToolMessageへ渡す経路が残る。

logはoperation、provider、件数、安全なstatusだけにする。
rendererとtool loopのerrorも保存前に固定分類へ変換する。

#### P2: listenerの残存

popup cleanupはstatus listenerを外すが、再描画ごとに追加したwindow unload listener自身を外さない。
Web Search checkboxもpane renderごとに匿名change listenerを追加する。
chat resizerはpane-localとdocument delegationの二実装が同じdragを処理する。

AbortControllerまたはownerの `destroy()` で一括解除し、各controlのlistenerとresizerの所有者を一つにする。

#### P2: credential cache

provider client cacheはraw API keyをMap keyとして保持し、key rotationとaddon shutdownでclearしない。
外部sinkへの露出は確認していないが、旧credentialとclientをprocess終了まで保持する。

providerごとの単一entryへ置き換え、key変更とshutdownでclearする。

### 実行基盤と型

#### P1: release workflowのgate不一致

通常CIはNode 22.8.0と `npm ci` を使うが、tag releaseだけはNode 20と `npm install` を使う。
release jobはlintとtestを実行せず、未対応Nodeと非lock依存集合でbuildとpublishを行う。

releaseもNode 22.8.0、`npm ci`、lint、test、buildの順へ統一する。

#### P2: Zotero runtime integration testの欠如

標準testはFirefox target bundle検査とNode上のunit testであり、Zotero sandbox、bootstrap、hook、実DOMを自動起動しない。
fast testは維持し、Zotero binaryを提供できる環境だけで別のintegration jobを実行する。

#### P3: declaration fileのdrift

手書き `.d.ts` は実装のpreference hookとpane APIを欠き、存在しないmethodを宣言する。
現在の内部buildは `.ts` を解決するため故障していないが、配布または次の修正で誤ったpublic contractを与える。

手書き宣言を廃止して型生成へ統一するか、declaration差分をCIで検査する。

#### P3: npm packageの内部資産

XPIには混入しないが、npm packageには作業用file、設計記録、testが含まれる。
npm publishを行うなら `files` allowlistまたは `.npmignore` を設ける。
package公開を行わないなら `private` の明示が必要である。

### 仕様書の不一致

`docs/pdf_citation_format.md` はrendererへ `before` と `after` を渡すと定義するが、実装と現行remediation記録は送らない。
現在の機能を正本にするなら、文書からrenderer inputの記述を外し、registry内部のcontextと明記する。

format文書は壊れた保存済みcitationの近傍へ警告すると定めるが、UIはlocator parse失敗時に固定warning containerを作らない。
正常な引用表示を変えず、検証不能な保存blockだけを明示警告へ変える。

READMEはGemini API keyだけを設定する手順のままであり、三provider実装と一致しない。
使用providerを選び、そのproviderのkeyを設定する手順へ直す。

### 確認できた健全性

次の点には新しい回帰を確認しなかった。

- 標準testは全test entryをbrowser targetでbundleし、28件を実行する。
- production XPIの内容とarchive integrityは正常であり、testとdocumentはXPIへ入らない。
- exact quote登録はtext versionを検証し、overlapする重複quoteも複数として拒否する。
- assistant HTMLはDOMPurifyのDocumentFragment経路を通り、source URLはHTTP(S)へ制限される。
- request外attachmentの明示的tool callは、metadata allowlistに含まれない限りfulltext access前に拒否される。
- runtime import cycleは前回修正後も解消されている。

### 推奨する修正単位

修正は次の五単位に分ける。

1. **Identityとgeneration**：library-qualified identity、render serialization、destroy後UI無効化、window-local routing。
2. **Persistence commit**：deletion-aware merge、upload timestamp commit、migration順序、deleted session guard。
3. **Request context**：provider/model snapshot、current attachment filter、renderer model resolver、safe error。
4. **Strict citation input**：current responseのrangeId限定、legacy pipe、locator validation、Markdown fence。
5. **Releaseと契約**：release gate、integration test、format/README、declaration管理。

各単位はwrite setが重ならないように実装できる。
一つ目と二つ目の回帰testを先に追加し、その後に境界修正を行う。

### Referenced File Hashes

- `.github/workflows/ci.yml`: `sha256:ab1aa9960f62ac758e412a361609c1a33ea292742f1cc99779f947ba70e8772f`
- `.github/workflows/release.yml`: `sha256:d7376054c63be2a88c4371748ccec7512d8f591053a05de7244565b9c21981f3`
- `README.md`: `sha256:9cc1ca6c94278d8317fde85325635ca03e2427918410df7cd0c6f150813ca203`
- `addon/prefs.js`: `sha256:5399b86bfa619effeecedccfb5fbfb2b3056c9c2d59e3206f32a1c5988265ad5`
- `docs/pdf_citation_format.md`: `sha256:27c0c3fdaa473e49ba9b6020087586d9e41880ba8e180bfadaa65519d602e64e`
- `package.json`: `sha256:97120caae6698f907d49aa28881fd7ec1567917459c41ca47c815794a1f02bdd`
- `src/hooks.ts`: `sha256:32eddfcc804b7b72a006f7bbbd91b72680bd3cbb9531530ac1df4d4803dfa153`
- `src/modules/globalChatManager.ts`: `sha256:830cea5876b50ea9139926328ad5f4521444ca8741a3c2a95968bee6bd59442a`
- `src/modules/llm/chat.ts`: `sha256:92b4cf442fb775c6929c34550e527a88c92c5e9e81f7f3c12122afbe7e765fe2`
- `src/modules/llm/chatProviderAdapters.ts`: `sha256:52cd86dd75955ea36ec89f41d07535e5d5f3327ca307e1ee1d172e79a87f096b`
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
- `src/modules/reader/titleGenerationService.ts`: `sha256:cbe9692f2ce221ffe05c3831b2485bc31492b615cd263130dcdc3430f55f492d`
- `src/modules/reader/ui.ts`: `sha256:bbfb75e72f072d543dbfb07bddb1df571c8732c50da0e7a61e4cff820976b5a2`
- `src/modules/readerItemPane.ts`: `sha256:97d0fb07cb5b936ee924ed301fb75ffcbf800774c3e0da96a7288cfdece46ab5`
- `src/modules/readerPopup.ts`: `sha256:069e5dc7d8a1b9711ed3e0125a2cc8ada441e8671cdb8cdc43e2604427193197`
- `src/utils/prefMigration.ts`: `sha256:c0ceb154eab070ceb27432949529972f2fa0ec1ab1b547b0518d03a5b8d3aa29`
- `src/utils/providerConfig.ts`: `sha256:23501bf46f1cf1f0787ba3936d00809b2b1638b554ad27f7c3e499dcac62c88b`
- `test/run.mjs`: `sha256:64e6932c8072ad1ad66cb410c1e6ba8529d90ddf21770f410a0ba07cb33f5175`
