# PDF Citation Live Test

- Created: 2026-06-06 02:20 UTC
- Updated: 2026-06-06 02:20 UTC
- Model: gpt-5.5
- Reasoning-Effort: low
- Session: 019e970b-9398-7723-bc6d-705e97b2012f
- Repository: /home/nakamura/gemini-pdf
- Related-Commit: none
- Handling: この document の取り扱いは document-workflow に準拠する。

Responsibility: `### Referenced File Hashes` の hash に対応する PDF citation の live test 結果を記録する。

## Background

PDF citation が実際に動作しているかを、実行中 Zotero の UI 経路で確認した。

## Result

- **結論**: PDF citation の表示・保存経路は動作したが、locator は過剰範囲を含んでおり、位置指定の精度は不合格。
- **新規 chatId**: `a57d4609-bfc6-42bc-9059-c466b82faadf`。
- **UI 表示**: `.citation-container` は 1 件、raw `::: citation` と raw `+++` は表示されなかった。
- **保存 diagnostics**: `pdfCitationToolCallCount: 2`, `pdfCitationCount: 1`, `pdfCitationDroppedCount: 0`, `citationRenderProvider: gemini`, `citationRenderModel: gemini-3.1-flash-lite`。
- **Locator**: `attachmentKey: GN4YERH6`, `start: 42`, `end: 120`, `textVersion: sha256:18dbeb0efcbb3c28660f450627036cac53993a19e0c190763402f064e2b164f1`。
- **Scope mismatch**: locator raw text は末尾に `Brenda` を含むが、render body はそれを表示していない。render は内容を補ってはいないが、過剰 locator を隠している。

## Detail

### Test Input

- **Parent item**: `PL72N49G`。
- **PDF attachment**: `GN4YERH6`。
- **Provider/model**: OpenAI `gpt-5.4-mini` for chat generation; Gemini `gemini-3.1-flash-lite` for citation render.
- **Prompt**: `PDF citation の動作テストです。このPDFのタイトルを、PDF本文から1箇所だけ citation block を使って示し、その後に日本語で1文だけ説明してください。`

### Stored Result

保存先は `.scaffold/data/storage/4BJH3L5B/hGWXqgGM-ask_my_paper_data_PL72N49G.json`。対象 chat は `chatSessions[43]`。

Assistant message は、通常 content に正規化済み citation block を保持していた。

```text
::: citation {"locator":{"libraryID":1,"attachmentKey":"GN4YERH6","textVersion":"sha256:18dbeb0efcbb3c28660f450627036cac53993a19e0c190763402f064e2b164f1","start":42,"end":120}}
Backprop as Functor:
A compositional perspective on supervised
learning
:::
```

`response_metadata.askMyPaper.llmDiagnostics` は PDF citation tool call、citation count、render provider/model を保持していた。

Locator の raw text と render body を比較すると、render body は raw text の prefix に一致するが、raw text の末尾 `\nBrenda` が表示から落ちていた。

```text
raw:    "Backprop as Functor:\nA compositional perspective on supervised\nlearning\nBrenda"
render: "Backprop as Functor:\nA compositional perspective on supervised\nlearning"
```

このため、この live test は citation render が周辺内容を追加した例ではない。ただし、locator の過剰範囲を render が表示上隠すため、ユーザーが UI だけを見ても locator の不正確さに気づけない。

### UI Result

Remote debugger で Zotero main window DOM を確認した。

- **session**: `a57d4609-bfc6-42bc-9059-c466b82faadf`。
- **title**: `PDFタイトルを引用表示するテスト`。
- **citation containers**: 1。
- **container source**: `Preprint PDF`。
- **container body**: `Backprop as Functor: A compositional perspective on supervised learning`。
- **rawCitation**: false。
- **rawPlus**: false。

### Referenced File Hashes

- `.scaffold/data/storage/4BJH3L5B/hGWXqgGM-ask_my_paper_data_PL72N49G.json`: `sha256:13d2f2f576508dba94034db7a864725f7b01d1436d59625ade0dd8a9ae75bd35`
- `src/modules/llm/chat.ts`: `sha256:2976c924a22d0a552e6645ef4e1dc8dff004f350162d4c8b5d59ef2d8dab2b77`
- `src/modules/pdfCitation.ts`: `sha256:bdde77e372c70c36f37ec43a775457d2d314712450dfb6d19a3e1e7a0cf612b3`
- `src/modules/reader/ui.ts`: `sha256:ea6e43e933d97e19395b48890bf1f50e3b8acf6ac0e53e91fef6d4f361bf684c`

## References
