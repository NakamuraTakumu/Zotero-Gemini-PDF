---
title: "Ask My Paper Low-Complexity Follow-up Remediation"
responsibility: "追加監査で確認した局所修正可能な不具合について、実装範囲、変更内容、検証結果、除外範囲を記録する。"
summary: "citation入力検証、provider/model整合、request-local PDF絞り込み、listener cleanup、機密情報redaction、release gate、型宣言、READMEを局所修正し、37 tests、lint、buildの成功を確認した。"
created: "2026-07-29 05:28 UTC"
updated: "2026-07-29 05:28 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "low"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
stale: false
---

# Ask My Paper Low-Complexity Follow-up Remediation

## Background

追加監査では、libraryを含むidentityの統一、非同期generation、永続化競合など、正しく直すために設計変更を要する問題も確認した。
ユーザーはそのうち、既存の関数境界で修正でき、新しい状態管理を導入しない問題だけを先に直すよう指定した。
この記録は、局所修正として採用した範囲と、意図的に変更しなかった範囲を分ける。

## At a Glance

修正は、入力境界から配布境界へ進む順序で適用した。

```text
LLM出力
  └─ citation入力を検証
       ├─ 不正offset、version欠損、legacy pipeを拒否
       └─ code fence内を解析対象外にする
          ↓
LLM request
  ├─ providerに属するmodelだけを選ぶ
  ├─ 現在のPDF attachmentだけを渡す
  └─ SDK errorを固定文へ置換する
     ↓
UI lifecycle
  └─ popupとWeb Searchのlistenerを重複させない
     ↓
配布
  └─ release前にCIと同じinstall、lint、build、testを通す
```

所有identity、非同期generation、永続化の原子性は、この修正系列へ含めていない。

## Body

- [Citation入力](#citation入力)
- [Providerとrequest](#providerとrequest)
- [Lifecycleと情報露出](#lifecycleと情報露出)
- [配布と文書](#配布と文書)
- [検証結果](#検証結果)
- [除外範囲](#除外範囲)

### Citation入力

locator parserとrange registryは、負の`start`と`end <= start`を拒否する。
新規assistant応答の直接locatorには`textVersion`を必須とし、保存済みlocatorを読む既存経路は維持した。

legacy pipe detectorは、sourceが`{`から始まる場合もJSON parse結果に基づいて判定する。
backtickまたはtildeのfenced code内にあるcitation例は、citation blockとして処理しない。

### Providerとrequest

citation rendererは、設定されたmodelが選択providerのmodel listに含まれる場合だけ採用する。
一致しない場合はproviderの既定modelを使い、既定modelもlistにない場合はlist先頭を使う。

LLMへ渡すPDF metadataは、送信直前に現在のparent itemのchild attachmentと照合する。
`libraryID`とattachment keyが一致し、PDF MIME typeとattachment pathを持つfileだけをrequest-local copyへ残す。
永続metadataとremote upload retentionは変更していない。

providerまたはSDKが返した例外文字列は、citation warning、diagnostics、保存message、UI、logへ直接渡さない。
PDF citation toolが返すmodel向けerrorは、LLMが再試行に使う既知のlocal validation errorだけを残し、未知の例外を固定文へ置換する。

### Lifecycleと情報露出

reader popupのcleanupは、status listenerだけでなく自身のunload listenerも解除する。
Web Search checkboxは`onchange`を使用し、同じUIを再初期化してもlistenerを累積しない。

PDFのabsolute path、session titleとID、SDK errorの本文をlogとUIへ出さない。
失敗の種類は固定文で通知し、ユーザーのlibrary内容やprovider responseをdiagnostic textへ複製しない。

### 配布と文書

release workflowをNode 22.8.0、`npm ci`へ合わせ、release前にlint、build、testを実行する。
手書き型宣言は、実装済みのpreference hookとreader pane APIを公開し、存在しないAPI宣言を削除した。

READMEはGemini、OpenAI、Anthropicのprovider選択と、選択providerに対応するAPI key設定を説明する。

### 検証結果

最終統合状態で次を実行し、すべて成功した。

- `npm run lint:check`
- `npm test`：37 passing
- `npm run build`：`tsc --noEmit`とXPI buildを含む
- `git diff --check`

回帰testは、citation入力、provider/model選択、current attachment filtering、SDK error redactionを対象に追加した。

### 除外範囲

次の問題は局所修正に含めていない。

- libraryを含むruntime identityの統一
- ChatPaneのrender generationと破棄後UI更新
- concurrent deletionを含む永続化mergeの再設計
- PDF upload部分失敗のcommit規則
- provider設定のrequest全体snapshot
- 複数window単位のselectionとpane routing
- title generationと削除の競合
- legacy migrationの削除順序

これらは新しい所有規則、状態、または非同期境界を導入するため、別の変更単位として扱う。

### Referenced File Hashes

- `.github/workflows/release.yml`: `sha256:7acefefdf4dabeba6d242609f0b51b68a715064219574c4e23a27402c1de441c`
- `README.md`: `sha256:215ac05bb4f4e52440b3f87293c259a2002c9b079af21ffbe6a6fa9c92ec8e3d`
- `src/hooks.d.ts`: `sha256:ccf2c4644d35284fb01898d126631eed459960bfb2bfd9cd0b6c9068c33d5ed5`
- `src/modules/llm/chat.ts`: `sha256:d7c6b1cd6e990a4aec735400996011761cede8cf11cfeba62fa3f188d90f326f`
- `src/modules/llm/citationRenderService.ts`: `sha256:3db12dcb379bac1590d752a4398f9ea6178d769edd5d565ebe8eeaea8dcc56fa`
- `src/modules/llm/langChainMessages.ts`: `sha256:fef11da53b6f158866275f62163a2bf9a2f6998065d41891b0312002250cfa39`
- `src/modules/pdfCitation.ts`: `sha256:83abf887a3fd5183f87963a03fbe18855c440f6afeef6a0fcc44fb8817be9822`
- `src/modules/reader/chatPane.ts`: `sha256:2c759d9c053e3fd2681c0d218b90aacb9a3750a56c59f5419631fae1599dc02c`
- `src/modules/reader/chatSession.ts`: `sha256:a390afe1885f5b60a08f0c019fd6513fc76e9571095a5a9a2b733378438410d0`
- `src/modules/reader/chatSessionManager.ts`: `sha256:44b397743d2a3b89a49916edc9f58735b2e12dd22e354ed03506f0c6a8d9988b`
- `src/modules/reader/chatSessionRepository.ts`: `sha256:56fb7590684f5a11eea0c73f83d524ee1194edda0ed2b6774d14f199244d5b57`
- `src/modules/reader/pdfSyncManager.ts`: `sha256:7d47192fcdad155450801d1fb9a7111b4a7d442add4a41fa35e6809e626b18bc`
- `src/modules/reader/sendMessageUseCase.ts`: `sha256:a0a3db4cfef0458ff3107c3528ecb45dda61c496dcfcc8b55b8026f3e5c7d4a9`
- `src/modules/reader/ui.ts`: `sha256:ad0c855debdc281c264bcebfa6e5735af161d5ff0e80ad6ae466469737a645b5`
- `src/modules/readerItemPane.d.ts`: `sha256:97ad1b821c4bb61bfd30eb496b540627a68c4e77ad4da6d5b273478b4f9068e6`
- `src/modules/readerPopup.ts`: `sha256:0e69fba5a8d37372c7e400aff46bfa24b739eb04684a2984b538281e7b9c5b33`
- `test/citationRenderService.test.ts`: `sha256:4aceaef2df5b270c4a3049588f6aae72132866c2261622b81c049fef8904c022`
- `test/llmChatToolLoop.test.ts`: `sha256:eb6333e14393e9f3abf63e89385d5f3b6a19aada9a4cf635992c1b4de229390e`
- `test/pdfCitation.test.ts`: `sha256:39405cfc8b906514ad8b504f9157a8c372eecb3525e70fc1c6b38bcd9c4fa288`
- `test/sendMessageUseCase.test.ts`: `sha256:d7a178d3caf2ce8e59dd3033406e989c59e16042b6063802f8bf3ee844fa36bc`
