# API Cost Burst Audit

- Created: 2026-05-20 05:38 UTC
- Updated: 2026-05-20 05:41 UTC
- Model: gpt-5.5
- Reasoning-Effort: high
- Session: 019e43df-137b-74c3-8db0-d5844d53e6e4
- Repository: /home/nakamura/gemini-pdf
- Related-Commit: none

Responsibility: API リクエスト爆増につながる reader/LLM 経路と今回の抑止修正を記録する。

## Background

API 使用料が通常単価ではなく、ループ、再入、重複イベント、非同期タイトル生成、PDF upload retry、web search/thinking の意図しない反復で極端に大きくなる可能性を監査した。

## Result

- `src/modules/reader/sendMessageUseCase.ts`: 同一 parent item / chat session の in-flight guard を追加し、複数 pane から同じ session へ並列送信される経路を抑止した。
- `src/modules/reader/chatPane.ts` と `src/modules/readerPopup.ts`: popup action に `paneId` を載せ、対象 pane だけが処理するようにして、同一 item の複数 pane が 1 click を全員処理する経路を抑止した。
- `src/modules/reader/chatSession.ts`: 初回タイトル生成の in-flight promise を持ち、同じ session の自動タイトル生成が同時に複数走らないようにした。
- `src/modules/reader/pdfSyncManager.ts`: 同一 parent item / provider の PDF sync promise を共有し、並列 sync による重複 upload を抑止した。
- `src/modules/reader/pdfSyncManager.ts`: PDF upload の部分成功後に他の upload が失敗しても、成功分の metadata を保存してから失敗を返すようにした。
- `src/modules/reader/pdfSyncManager.ts`: metadata 保存失敗を握りつぶさず throw し、upload 済み情報が永続化されないまま sync complete と扱われる経路を止めた。
- `src/modules/llm/pdfUploadAdapters.ts`: availability check は not found 系だけを re-upload 判定にし、network、429、5xx、auth などの不確定エラーでは再 upload へ進まないようにした。
- `src/modules/llm/chat.ts` と `src/modules/reader/titleGenerationService.ts`: title generation は `policy` override で web search off / reasoning off にし、通常 chat の search/thinking 設定が自動タイトル生成へ乗る経路を止めた。
- `src/modules/reader/titleGenerationService.ts` と `src/utils/providerConfig.ts`: `titleGenerationProvider=current` でもチャット本文の選択モデルを流用せず、provider ごとの軽量 title model を使うようにした。
- `src/modules/reader/ui.ts` と `addon/content/chat.css`: assistant message の本文後に単一の `details.message-details` を置き、provider/model、thinking、参照元を同じ detail にまとめた。

## Detail

- 無限ループは確認していない。主なリスクは、複数 pane、部分成功未保存、availability check の過広な false 判定、title generation の追加 LLM request による有限回の多重化だった。
- `sendMessageToLlm` 自体にアプリ側 retry loop は見当たらず、通常 chat の実送信は `chatModel.invoke` 1 回だった。
- `readerPopup.ts` の request-status listener は popup 作成ごとに蓄積するが、API request へ戻る経路ではないため今回の最小修正対象外にした。
- 以前の title generation は `titleGenerationProvider=current` の場合、現在選択中の chat model を使うため、ユーザーが本文用に pro/opus 系を選ぶと title 生成にも同じ高コスト model が使われる可能性があった。現在は `gemini-3.1-flash-lite`、`gpt-5.4-nano`、`claude-haiku-4-5-20251001` を provider ごとの title default にしている。
- 実 API 呼び出しは行っていない。API key 値は表示、記録していない。

## References
