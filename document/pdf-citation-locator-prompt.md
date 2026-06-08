# PDF Citation Locator Prompt Minimum Change

- Created: 2026-06-05 13:37 UTC
- Updated: 2026-06-05 13:37 UTC
- Model: gpt-5.5
- Reasoning-Effort: low
- Session: 019e970b-9398-7723-bc6d-705e97b2012f
- Repository: /home/nakamura/gemini-pdf
- Related-Commit: none
- Handling: この document の取り扱いは document-workflow に準拠する。

Responsibility: `### Referenced File Hashes` の hash に対応する PDF citation locator prompt の最小変更範囲と検証結果を記録する。

## Background

PDF citation の locator が不正確になり、display text も周辺文脈を補完して過剰になる問題に対して、まず prompt だけの最小変更を試すことにした。

## Result

- **Locator 指示**: system prompt と runtime citation attachment context に、最小の完全な evidence unit を選ぶ制約を追加した。
- **Render 指示**: citation render prompt に、結論、含意、周辺文脈、theorem/proof continuation、欠けた文の補完を禁止する制約を追加した。
- **Migration**: 旧既定 citation render prompt だけを新 default へ寄せる判定を追加した。任意の custom prompt を無差別には置換しない。
- **検証**: `npm run build` は成功した。実行中 Zotero の watcher reload と profile 内 `citationRenderPrompt` 反映を確認した。

## Detail

### Change Scope

- `addon/prefs.js`: 既定 system prompt に `Locator Range Rules` と `Each block must make one claim supported by its citation range.` を追加した。既定 citation render prompt に補完禁止行を追加した。
- `src/modules/llm/chat.ts`: `buildCitationAttachmentContext()` の locator 指示を、`find_pdf_text` 後に必要なら `read_pdf_text_range` を使い、1 claim を支える最小の完全単位を選ぶ内容へ置換した。
- `src/utils/providerConfig.ts`: `DEFAULT_CITATION_RENDER_PROMPT` に補完禁止行を追加した。
- `src/utils/prefMigration.ts`: 旧 default 相当の citation render prompt だけを新 default へ更新する条件を追加した。

### Verification

- `npm run build`: 成功。
- `/tmp/xpra-gemini-pdf.log`: watcher が `addon/prefs.js`、`src/utils/providerConfig.ts`、`src/utils/prefMigration.ts`、`src/modules/llm/chat.ts` を検知し、2026-06-05 13:36:56 UTC までに reload した。
- `.scaffold/profile/prefs.js`: `extensions.zotero.AskMyPaper.citationRenderPrompt` に補完禁止行が保存されていた。

### Referenced File Hashes

- `addon/prefs.js`: `sha256:16fedb7e7750d734daf2138ac438a70c3b9347283b2e9d7fcbf019fcc7d2fb50`
- `src/modules/llm/chat.ts`: `sha256:2976c924a22d0a552e6645ef4e1dc8dff004f350162d4c8b5d59ef2d8dab2b77`
- `src/utils/prefMigration.ts`: `sha256:0318733ae5d02debabf8b4e0a0737541d6628629e61351a81fb47d0afc74f393`
- `src/utils/providerConfig.ts`: `sha256:57099f3f95d11193a36590c9dd6c358a6098ef88f0ac79e686b1648646b1702c`

## References
