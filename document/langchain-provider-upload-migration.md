# LangChain Provider PDF Upload Migration

- Created: 2026-05-19 17:28 UTC
- Updated: 2026-05-20 05:23 UTC
- Model: gpt-5.5
- Reasoning-Effort: high
- Session: 019e4058-db50-7f81-8590-c7f52f42528d
- Repository: /home/nakamura/gemini-pdf
- Related-Commit: none

Responsibility: LangChain 移行と provider 別 PDF upload 実装の構成、判断、検証結果を記録する。

## Background

Zotero-Gemini-PDF で Gemini 以外の provider を使うため、既存の PDF upload metadata 設計を維持しながら LangChain と provider adapter へ移行した。

## Result

### 実装構成

- PDF upload metadata は旧 attachment 名 `Gemini File Metadata - {parentItemKey}` を維持し、各 PDF の `uploads` に provider 別 ref を保存する。
- 旧 `geminiFileUri` は引き継がない。PDF upload metadata は再生成可能なので、新形式の `uploads` がなければ再 upload する。
- PDF upload は `PdfUploadAdapter` で provider ごとに分け、chat 本体は `sendMessageToLlm` に集約した。
- Gemini / OpenAI / Anthropic の chat は LangChain 経由に統一した。Anthropic SDK の credential chain が参照する `node:fs` / `node:path` は Zotero browser bundle では使わないため、esbuild plugin で空 module に解決する。
- Web Search と Thinking は provider 共通 UI とし、provider ごとの API tool / reasoning parameter へ変換する。

### Provider 別 PDF 参照

- Gemini: File API upload 結果の `fileUri` を LangChain standard file block の `url` として渡し、Google adapter 側で `fileData.fileUri` に変換する。
- OpenAI: Files API upload 結果の `fileId` を LangChain standard file block の `fileId` として渡し、OpenAI Responses adapter 側で `input_file.file_id` に変換する。
- Anthropic: Files API upload 結果の `fileId` を LangChain standard file block の `fileId` として渡し、Anthropic adapter 側で `document.source.file_id` に変換する。

### LangChain 共通化の現状

- 共通化できている範囲: Gemini / OpenAI / Anthropic の model 呼び出し、`ChatMessage` から LangChain message への変換、system prompt、履歴の thinking 除去、通常 response text / thoughts 抽出、PDF file block の大部分。
- 共通化できていない範囲: provider 別 model constructor、Web Search tool 形式、Thinking parameter、diagnostics 抽出、citation / grounding metadata 抽出。Gemini の uploaded file URI だけは `fileId` ではなく `url` として渡す。
- PDF upload は `PdfUploadAdapter` で provider 別責務に分離できている。upload ref の保存、再利用、期限切れ確認、provider 切替時の追加 upload は `PdfFileSyncManager` が共通 orchestration として扱う。
- Chat 実行は `src/modules/llm/chat.ts` を orchestration、`src/modules/llm/chatProviderAdapters.ts` を provider 固有差分の境界として分けた。direct Anthropic fetch は削除済みで、model constructor、PDF content block、Web Search tool 注入、Thinking parameter、diagnostics builder は `ChatProviderAdapter` が所有する。

### 設計整理方針

- `sendMessageToLlm` は provider 選択、model 解決、request policy 解決、共通 history 構築、LangChain invoke、共通 output assembly だけを持つ薄い orchestration に寄せた。
- `ChatProviderAdapter` を導入し、`gemini`, `openai`, `anthropic` の adapter が provider 固有の model constructor、PDF content block、tool 形状、thinking 形状、raw response diagnostics 解析を所有する。
- `LlmChatResponse` と `LlmDiagnostics` は provider adapter の共通 output contract として残す。provider raw metadata は adapter 内で正規化し、UI / session 層には直接漏らさない。
- PDF upload adapter は現状の責務分離を維持し、chat adapter には upload 済み ref を message content block に変換する責務だけを置く。
- `ProviderConfig` registry を `src/utils/providerConfig.ts` に置き、provider label、API key pref、model list pref、selected model pref、current model list、default model、legacy migration target を 1 箇所で定義する。
- provider 追加時は、`ProviderConfig`, `PdfUploadAdapter`, `ChatProviderAdapter`, UI provider select の 4 箇所を増やす構造にする。`reader` 層には provider 固有分岐を増やさない。
- Reader item pane の Zotero 登録責務と XHTML markup 生成責務を分ける。`ReaderItemPaneFactory` は lifecycle 登録と pane registry を持ち、`itemPaneMarkup.ts` が provider registry から UI option を生成する。
- `GlobalChatManager` の session event は typed `EventEmitter` で固定し、`session-added`, `session-deleted`, `session-updated`, `sessions-loaded` の payload shape を source 上の contract として扱う。
- Zotero preference window script は browser global script として扱い、`Zotero`, `addon`, `window` の global contract を ESLint directive で明示する。
- Chat session は domain state と orchestration に寄せ、Zotero attachment 永続化は `ChatSessionRepository`、タイトル生成は `TitleGenerationService`、send button 由来の UI 送信手順は `SendMessageUseCase` が所有する。

### 追加設計調査: 共通化候補

- LangChain でさらに自動的に共通化できる範囲は限定的。共通化すべき主対象は、LangChain API 呼び出しそのものではなく、provider 固有差分を隠す repository 側の境界である。
- `ChatProviderAdapter` を導入し、`createModel`, `buildPdfContentBlocks`, `buildInvokeOptions`, diagnostics を provider ごとの adapter に移した。`sendMessageToLlm` は adapter を呼ぶ薄い use case として残す。
- `ProviderConfig` registry を追加し、provider label、API key pref、model list pref、selected model pref、default model、current / legacy model list を 1 箇所で定義した。`provider.ts`, `prefMigration.ts`, reader pane の model pref observer を registry 参照へ寄せた。provider select の XHTML option は現状 static のまま残す。
- `itemPaneMarkup.ts` を追加し、provider select の XHTML option も `ProviderConfig` registry から生成するようにした。
- `EventEmitter` を generic 化し、`GlobalChatManagerEvents` で session event payload を型として固定した。
- `addon/content/preferences.js` に Zotero preference window の global script contract を明示し、repository-wide lint 対象として扱えるようにした。
- `ChatSessionRepository` を追加し、chat JSON attachment の load / find-or-create / save / delete / title update を `ChatSession` から分離した。
- `TitleGenerationService` を追加し、title prompt 構築、title provider/model 解決、title LLM request、title cleanup を `ChatSession` から分離した。
- `SendMessageUseCase` を追加し、PDF sync、user message 保存、typing placeholder、LLM response UI update、error UI update、request-in-progress state 更新を `ChatPane` から分離した。
- `LlmRequestPolicy` を導入し、Web Search と Thinking を global prefs から各 helper が直接読む構造をやめる。通常 chat、title generation、将来の batch 処理ごとに `webSearch` と `reasoningMode` を明示できるようにする。
- `LlmDiagnostics` は provider raw field の寄せ集めから、`search`, `thinking`, `contentBlockTypes`, `providerDetails` のような正規化構造へ寄せる。保存済み chat log は tolerant read にして、旧 field は当面読み捨て可能にする。
- citation / grounding は Gemini raw metadata を UI へ漏らさず、`LlmCitation` のような共通型へ正規化する。OpenAI / Anthropic の Web Search result や PDF citation を同じ UI 部品で扱えるようにする。
- PDF upload adapter は現状の境界を維持する。追加で共通化するなら、adapter instance cache、upload availability check の共通 wrapper、provider 別 upload error logging の共通 helper に留める。

### Provider 別 Web Search / Thinking

- Web Search: Gemini は `googleSearch` / `urlContext`、OpenAI は Responses API の `web_search`、Anthropic は Messages API の `web_search_20250305` に変換する。
- Thinking: 共通 `reasoningMode` を `off | low | medium | high` として保存する。
- Gemini: `reasoningEffort` と `thinkingConfig.includeThoughts` へ変換し、thinking summary を `thoughts` に保存する。
- OpenAI: `reasoning.effort` と `reasoning.summary` へ変換し、reasoning summary を `thoughts` に保存する。
- Anthropic: `thinking.type=enabled` と `budget_tokens` へ変換し、`thinking` content block を `thoughts` に保存する。

### 検証結果

- `npm run build` は成功した。locale ID 不足 warning は残るが bundle は完了する。
- 今回変更した file の Prettier check は成功した。
- 今回変更した TypeScript file の ESLint は error なし。`typings/prefs.d.ts` は既存 lint ignore により warning のみ。
- `npm run lint:check` は repository 全体の既存 Prettier 差分で失敗する。対象は `src/addon.d.ts`, `src/modules/globalChatManager.ts`, `src/modules/reader/chatSessionManager.ts`, `src/utils/eventEmitter.ts`。
- 2026-05-20 04:05 UTC 時点で、`npm run build` と `npx eslint src/modules/llm/chat.ts zotero-plugin.config.ts` は成功した。`npm run lint:check` は上記 4 file の既存 Prettier 差分で失敗する。
- 2026-05-20 05:01 UTC 時点で、`ChatProviderAdapter` 分離後の `npm run build` と `npx eslint src/modules/llm/chat.ts src/modules/llm/chatProviderAdapters.ts` は成功した。
- 2026-05-20 05:07 UTC 時点で、`ProviderConfig` registry 化後の `npm run build`, `npx eslint src/modules/llm/chat.ts src/modules/llm/chatProviderAdapters.ts src/modules/llm/provider.ts src/modules/reader/ui.ts src/utils/prefMigration.ts src/utils/providerConfig.ts`, targeted Prettier check は成功した。
- 2026-05-20 05:11 UTC 時点で、reader item pane markup 分離後の `npm run build`, `npx eslint src/modules/reader/itemPaneMarkup.ts src/modules/readerItemPane.ts src/modules/reader/chatPane.ts src/modules/readerPopup.ts src/modules/globalChatManager.ts src/modules/reader/chatSession.ts src/modules/reader/chatSessionManager.ts src/utils/providerConfig.ts`, targeted Prettier check は成功した。
- 2026-05-20 05:12 UTC 時点で、typed `EventEmitter` 導入後の `npm run build`, `npx eslint src/utils/eventEmitter.ts src/modules/globalChatManager.ts src/modules/reader/chatSessionManager.ts`, targeted Prettier check は成功した。
- 2026-05-20 05:14 UTC 時点で、repository-wide `npm run lint:check` と `npm run build` は成功した。build の locale ID 不足 warning は残る。
- 2026-05-20 05:22 UTC 時点で、`ChatSessionRepository`, `TitleGenerationService`, `SendMessageUseCase` 分離後の repository-wide `npm run lint:check` と `npm run build` は成功した。build の locale ID 不足 warning は残る。
- Xpra/Zotero UI から新規セッションを作成し、PDF 付き item で Gemini / OpenAI / Anthropic を送信テストした。
  - Gemini `gemini-3-flash-preview`: PDF title を読めた。Web Search は `searchUsed: true`。Thinking Low では `thinkingUsed: false` だったが、Thinking High では `thoughtCount: 2`, `thinkingUsed: true`。
  - OpenAI `gpt-5.4-mini`: PDF title を読めた。Web Search は `webSearchCallCount: 2`, `searchUsed: true`。Thinking は `thoughtCount: 1`, `thinkingUsed: true`。
  - Anthropic `claude-sonnet-4-5-20250929`: PDF title を読めた。Web Search は `anthropicWebSearchRequestCount: 1`, `searchUsed: true`。Thinking は `thoughtCount: 1`, `thinkingUsed: true`。

### Runtime 修正

- OpenAI upload で出た `performance is not defined` は、Zotero plugin sandbox に Web API global が不足し、LangChain の retry utility が `performance.now()` を参照したことが原因だった。
- `bootstrap.js` で `fetch`, stream, `crypto`, `performance` などの Web API global を sandbox に注入し、`performance` が取れない場合は `Date.now()` fallback を与える。
- OpenAI upload は Files API の開始、成功、失敗を `Zotero.log` / `Zotero.logError` に出す。PDF sync 側でも upload 失敗を握りつぶさず、chat UI に error message を出して送信処理を止める。
- OpenAI / Gemini には `temperature` を送らない。OpenAI `gpt-5.4-mini` で `temperature` 付き request が 400 になることを確認した。
- assistant 応答本文に thinking summary が混入しないよう、表示、保存、履歴再送信で `<think>` / `Thinking:` 系 block を除去する。
- thinking summary は本文へ混ぜず、存在する場合だけ assistant message の先頭に `Thinking` details として表示する。
- Web Search の参照元は Gemini `groundingMetadata` だけに依存せず、LangChain response の `contentBlocks`, `content`, `response_metadata` から URL citation / web search result を抽出し、provider 共通 `citations` として保存、表示する。
- assistant message には、実際の LLM response から返った `provider` と `model` を小さな metadata 行として表示する。UI selector の現在値は使わない。
- OpenAI の LangChain PDF content block は standard `{ type: "file", fileId, mimeType }` を使う。`HumanMessage({ contentBlocks })` により `output_version: "v1"` を付け、LangChain OpenAI adapter の standard converter に `input_file.file_id` へ変換させる。
- OpenAI standard file block に `metadata.filename` を付けると LangChain converter が `input_file.file_id` と `filename` の両方を送り、Responses API が `400 Mutually exclusive parameters` を返す。OpenAI では `metadata.filename` を付けない。
- 実 PDF での provider テストでは、Gemini File API upload + file URI 参照、OpenAI Files API upload + LangChain standard file block、Anthropic Files API upload + LangChain standard file block が成功した。

## Detail

- 旧 Gemini 専用 chat module `src/modules/geminiApi.ts` は未参照になったため削除した。Gemini File API upload は `src/modules/llm/pdfUploadAdapters.ts` に残している。
- Anthropic chat は `@langchain/anthropic` の `ChatAnthropic` を使う。Files API beta は constructor の `betas: ["files-api-2025-04-14"]` で指定する。Anthropic SDK は browser access を内部で許可しているが、bundle 時の unused credential file loader 参照は `zotero-plugin.config.ts` の esbuild plugin で空 module に解決する。
- System prompt は既存 `geminiSystemPrompt` を provider 共通 prompt としてそのまま使う。名前だけの変更は保留する。
- 既定 model list は 2026-05-19 時点の公式 docs に合わせ、Gemini は `gemini-3.5-flash`、OpenAI は `gpt-5.5`、Anthropic は `claude-sonnet-4-5-20250929` を既定にした。OpenAI の選択肢には `gpt-5.5-pro` と `gpt-5.4-pro` も含める。既存 profile に旧デフォルトの model list が保存されている場合は、起動時 migration で現行リストへ置換する。
- provider を reader pane で切り替えた場合、送信前に現在 provider の PDF upload ref があるか確認し、なければ同じ Zotero PDF に別 provider の upload ref を追加する。
- `bootstrap.js` のような startup 時にだけ効く修正は、extension reload だけでは古い sandbox が残る場合がある。Xpra 上の Zotero 本体と `zotero-plugin serve` を揃えて再起動し、`pgrep -af 'zotero|zotero-bin|zotero-plugin|npm start'` で孤児 process が残っていないことを確認する。
- Xpra 親プロセスの command line には `--start-child` の Zotero 起動コマンドが含まれる。`pkill -f` の広い pattern は Xpra 親も巻き込むため、GUI 再起動時は PID を確認して個別に kill する。

## References

- OpenAI PDF file inputs: https://platform.openai.com/docs/guides/pdf-files
- OpenAI models: https://developers.openai.com/api/docs/models
- Claude PDF support: https://docs.claude.com/en/docs/build-with-claude/pdf-support
- Claude models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Gemini document processing: https://ai.google.dev/gemini-api/docs/document-processing
- Gemini models: https://ai.google.dev/gemini-api/docs/models
