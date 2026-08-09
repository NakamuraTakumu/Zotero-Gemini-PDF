---
title: "Chat Panel Height Persistence"
responsibility: "Zotero を再起動してもチャット表示の縦サイズを安全に復元する変更を記録する。"
summary: "チャット高さの単一所有者、保存値の安全な復元、境界テストを実装し、347 px の実ドラッグ保存とclean restart後のDOM復元を確認した。"
created: "2026-08-08 11:41 UTC"
updated: "2026-08-08 11:53 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "0d0c7902e707d97ef89b6409f3fd011210f5c372"
model: "gpt-5.6-terra"
reasoning_effort: "xhigh"
session: "019fe072-7c41-7241-ab4f-082196c2f46a"
handling: "document-workflow"
workflow_stage: "completed"
stale: false
---

# Chat Panel Height Persistence

## Background

チャット表示の高さは `chatPanelHeight` preference に保存されていたが、reader pane の生成と再描画で同じリサイズ操作を二つの実装が処理していた。さらに、初期レイアウトが未確定または非表示のときに保存値をその一時的な寸法へ制限し得たため、Zotero を開き直すと直前の高さを表示できない状態があった。

この変更は、ユーザーがドラッグで選んだ高さを preference に永続化し、表示可能なレイアウトでは安全な範囲へ制限し、レイアウト情報が信頼できない間は保存値を失わずに復元することを目的とする。

## Answer

高さの変更は `ChatPane` だけが処理するよう統合し、ドラッグ終了時の最終サイズを既存の `chatPanelHeight` preference へ保存する。起動時、コンテナのサイズ変更時、および reader の文脈更新時に保存値を復元する。最小値は 50 px とし、利用可能なコンテナまたは viewport の上限が得られる場合だけ上限を適用する。非表示または未配置の pane では、保存値を一時的な 50 px へ表示上制限しない。

56 件のテスト、production build、対象ファイルのPrettier検査、差分の空白検査を実行した。実UIではドラッグで 347 px を `chatPanelHeight` preference へ保存し、clean restart後も preference と実DOM高さの両方が 347 px へ復元されることを確認した。詳細は [検証](#検証) を参照する。

## Body

- [原因](#原因)
- [実装](#実装)
- [安全性](#安全性)
- [検証](#検証)

### 原因

`src/modules/reader/chatPane.ts` と `src/modules/readerItemPane.ts` は、同じ `#chat-resizer` の mouse event を別々に処理していた。両方が inline height と `chatPanelHeight` preference を変更するため、表示値と保存値の所有者が一意でなかった。

復元は reader の文脈更新中にも実行される。初期化時にコンテナが非表示または viewport 外なら、DOM が返す高さは最終レイアウトの上限として使えない。保存値をその値で制限すると、正しい preference でも低い表示値として復元される。

### 実装

`src/modules/reader/chatPane.ts` をリサイズの単一所有者にした。`ReaderItemPaneFactory` に残っていた旧 document-level handler は、hot reload で残存している listener を abort する cleanup だけに縮小した。

`ChatPane` はドラッグ中だけ復元を抑止し、`mouseup` で制限後の高さを `setPref(PREF_CHAT_PANEL_HEIGHT, effectiveHeight)` に保存する。初期化、reader 文脈更新、`ResizeObserver` 通知では保存値を再適用する。destroy 時には animation frame、observer、進行中dragのdocument-level listenerを解除し、破棄済みpaneが preference を書き換えないようにする。

`src/modules/reader/chatPanelHeight.ts` に保存値の検証、最小・最大の制限、利用可能な上限の選択を分離した。これにより DOM に依存しない境界条件を `test/chatPanelHeight.test.ts` で検証する。

### 安全性

保存値は有限の正数だけを受け入れ、丸めた値が 50 px 未満にならないようにする。コンテナと viewport のどちらかから正の上限を得られる場合は、その利用可能な上限を適用する。

viewport の高さが 0、コンテナのclient/描画高さが 0、またはコンテナが viewport 外なら、レイアウトは未確定として上限を返さない。この場合は保存値をそのまま復元する。次の有効な resize で通常の制限を再適用するため、起動途中の一時的な低い寸法で表示値を決めない。

### 検証

実行済みの検証は次のとおりである。

- `npm test` — 56 passing
- `npm run build` — production build succeeded
- `npx prettier --check src/modules/reader/chatPane.ts src/modules/readerItemPane.ts src/modules/reader/chatPanelHeight.ts test/chatPanelHeight.test.ts document/chat-panel-height-persistence-20260808.md`
- `git diff --check`

Xpra :100 のreaderで、remote debuggerから実際の `#chat-resizer` の `mousedown` と document の `mousemove` / `mouseup` を発火した。310 px から 347 px へ変更した直後、実DOM高さと `extensions.zotero.AskMyPaper.chatPanelHeight` preference はともに 347 px だった。

確認後、Xpra本体を維持したまま既存のZotero、content process、`npm start`、`zotero-plugin serve` の各子PIDだけを停止し、`:100` に新しいchildを起動した。再起動後、remote debuggerで preference=347、実DOM高さ=347 px、inline height=`347px`、chat container高さ=586 px を実測した。

### Referenced File Hashes

- `src/modules/reader/chatPane.ts`: `sha256:c179f1adf0f4b44a2cfd965909bfdd1cb987b899468e7322a551e4d7a5363164`
- `src/modules/reader/chatPanelHeight.ts`: `sha256:3d25949d9423fdc0760e5cd8407a55f125203fad6f8d883f35f26bed20df1092`
- `src/modules/readerItemPane.ts`: `sha256:4db4ccb5bd41664d50c8e3556fe4f1f9779f91f514ee9c7ae220fa62fcafbb9b`
- `test/chatPanelHeight.test.ts`: `sha256:18c07d11012be0b6a34973b95e94e1fe7bd25d27473350502b24ad5d90f993b5`
