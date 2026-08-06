---
title: "Typing Placeholder Layout Lifecycle"
responsibility: "Ask My Paper の Typing placeholder と assistant/error message の layout lifecycle、class境界、および検証結果を記録する。"
summary: "Typing placeholder専用のcompact幅を成功・エラー更新時に解除し、assistant/error messageを全幅へ戻すclass lifecycleと検証結果を記録する。"
created: "2026-08-06 09:55 UTC"
updated: "2026-08-06 09:55 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-luna"
reasoning_effort: "low"
session: "019fd67e-9e62-77d0-9374-ad21941ef54e"
handling: "document-workflow"
workflow_stage: "completed"
stale: false
---

# Typing Placeholder Layout Lifecycle

## Background

送信中の `Typing...` placeholder だけを内容幅に縮め、応答確定後またはエラー時には通常の assistant message と同じ全幅レイアウトへ戻す必要があった。修正対象は表示状態の class lifecycle に限定し、session routing や応答内容の処理は変更しない。

## At a Glance

- **原因**: `typing-message` の `width: fit-content` が応答確定後も残ると、assistant/error message が全幅にならない。
- **修正契約**: placeholder 作成時だけ `typing-message` を付与し、成功・エラーの両更新経路で `message bot-message` に戻す。通常の assistant/error は `bot-message` の全幅規則を使う。
- **検証**: `npm test` 49件成功（`test/uiMessageLifecycle.test.ts` を含む）、TypeScript、対象 ESLint、CSS Prettier、`git diff --check` が成功。DOM-level success/error class-removal test は DOM harness 不足のため未実施。

## Body

- [Scope and lifecycle](#scope-and-lifecycle)
- [Verification and limits](#verification-and-limits)

### Scope and lifecycle

`SendMessageUseCase` は origin session の送信中に `addBotMessage("Typing...", "bot-message typing-message")` を一度だけ作る。応答成功時は `updateBotMessage` が `typing-message` を除去して `message bot-message` に戻してから Markdown、details、citation を挿入する。エラー時も同じ update 経路で class を戻し、安全なエラーテキストを挿入する。

`addon/content/chat.css` の `typing-message` 規則は placeholder 専用であり、通常の `bot-message` / `model-message` の `width: 100%` を上書きする。したがって専用 class を両更新経路で除去することが layout 修正の境界である。session 切替時の routing、保存、provider 呼び出し、Markdown sanitizer の責務は本記録の対象外とする。

### Verification and limits

ソース経路を確認し、`test/uiMessageLifecycle.test.ts` を含む `npm test`（49 passed）、`npx tsc --noEmit`、`npx eslint src/modules/reader/sendMessageUseCase.ts src/modules/reader/ui.ts`、`npx prettier --check addon/content/chat.css`、`git diff --check` を実行して成功した。DOM-level success/error class-removal test は DOM harness がないため実施できず、runtime live UI A/B も未実施である。

### Referenced File Hashes

- `addon/content/chat.css`: `sha256:bf9094dd425ede3c5f8026ce775b8a17e2a35c0c5868087a4176f5c77bafb821`
- `src/modules/reader/sendMessageUseCase.ts`: `sha256:2cfa93cd515c04d9823ed2dc8eead14a38a1465f79fa56c9c5400b6c721cf42f`
- `src/modules/reader/ui.ts`: `sha256:497ea6ab104c9e3d9577da2f814a032bf8b57407de73b4b1674891ddffc3d179`
- `test/uiMessageLifecycle.test.ts`: `sha256:b2e2ee2293bf7a28303dbd770bb583da26acb6efd217643ea709e350ed40a677`
