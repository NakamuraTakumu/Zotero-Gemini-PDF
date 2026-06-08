# Ask My Paper rename implementation

- Created: 2026-05-20 14:01 UTC
- Updated: 2026-05-21 15:39 UTC
- Model: gpt-5.5
- Reasoning-Effort: high
- Session: 019e45aa-3d63-7a11-a625-d08c77c27e71
- Repository: /home/nakamura/gemini-pdf
- Related-Commit: 4cdee21cbd6bfe7cafa25fc73b33885ac2417182

Responsibility: Ask My Paper への名称変更で置換した runtime 名と、意図的に残した旧名参照を記録する。

## Background

Gemini PDF から Ask My Paper へ、互換 fallback なしで addon identity、pref key、attachment prefix、UI event/CSS/locale を移行した。

## Result

- Runtime identity: package `ask-my-paper`, addon ID `ask-my-paper@euclpts.com`, addon ref `askmypaper`, addon instance `AskMyPaper`, prefs prefix `extensions.zotero.AskMyPaper` に統一。
- Icon identity: reader pane SVG、inline popup SVG、manifest/ztoolkit PNG icons を paper + question mark motif に統一。
- Generic prefs: `geminiSystemPrompt` は `systemPrompt`、`geminiUseGoogleSearch` は `useWebSearch` に変更し、旧 key fallback は追加しない。
- Attachment prefix: parent item data は `Ask My Paper Data - ` / `ask_my_paper_data_` に統一。per-chat `Ask My Paper Chat - ` は集約 store への移行検出にだけ使う。
- Reader pane section: plugin section ID は Zotero 標準 Info と衝突しない `ask-my-paper-chat` に変更し、locale key は `askmypaper-reader-chat-*` に統一。
- Intentional leftovers: `document/` 内の履歴記録と `AGENTS.md` の workspace/log path は旧 repository 名を含むが、runtime/build contract ではないため対象外。
- Provider-specific leftovers: `geminiApiKey`, `geminiModelList`, `geminiSelectedModel`, provider id `gemini`, Gemini model names, Gemini File API references are provider configuration and remain valid.
- Message metadata: provider raw metadata remains in LangChain `response_metadata`; `response_metadata.askMyPaper` stores only Ask My Paper UI metadata.
- Chat session storage: per-session JSON attachment は廃止し、親 item ごとの aggregate data attachment の `chatSessions` に保存する。

## Detail

- Verification: `npm run lint:check` passed after Prettier formatting; `npm run build` passed.
- Residual search: runtime/build scope had no matches for `Gemini Chat`, `Plugin Template`, `reader-item-info`, or template `example` locale IDs after the section ID fix.
- UI verification: Zotero 9.0.3 under Xpra loaded the plugin as a temporary add-on; runtime DOM contained one `.chat-container`, an `item-pane-custom-section` headed `Ask My Paper Chat`, and no `Gemini Chat` / `Plugin Template` matches. Chat sessions are stored in the parent aggregate data attachment as schema v2 records with `messages`.
- Implementation note: preference observers now use `getPrefPath()` so they follow `package.json` `config.prefsPrefix` instead of hard-coded prefix strings.

## References
