# Chat Rendering XHTML Sanitizer

- Created: 2026-06-05 13:16 UTC
- Updated: 2026-06-05 13:16 UTC
- Model: gpt-5.5
- Reasoning-Effort: high
- Session: 019e970b-9398-7723-bc6d-705e97b2012f
- Repository: /home/nakamura/gemini-pdf
- Related-Commit: none
- Handling: この document の取り扱いは document-workflow に準拠する。

Responsibility: `### Referenced File Hashes` の hash に対応する chat rendering の XHTML sanitizer 問題と修正境界を記録する。

## Background

Ask My Paper Chat で保存済み assistant message の `+++`、`::: citation {...}`、LaTeX が raw text として表示されたため、renderer と sanitizer の境界を再調査した。

## Result

- **原因**: `DOMPurify.sanitize()` が XHTML self-closing tag を HTML void tag へ再シリアライズし、Zotero の `application/xhtml+xml` document で `innerHTML` 代入が失敗していた。
- **修正境界**: MarkdownIt は HTML 生成だけを担当し、最終挿入点 `setMessageHtml()` が `RETURN_DOM_FRAGMENT` 付き DOMPurify と `replaceChildren()` で sanitize 済み DOM を挿入する。
- **セキュリティ境界**: sanitizer allowlist は MathML、citation data attribute、details/link metadata に必要な属性へ限定し、`style` と SVG 系 attribute は採用しない。
- **検証**: `npm run build` は成功し、対象 session `d3c63eca-0a76-41db-bc5f-b3cb46a29546` の live DOM は citation 4 件、details 5 件、KaTeX 59 件を持ち、raw `::: citation` と `+++` を含まない。

## Detail

対象 session の raw 表示は、MarkdownIt の parser 失敗ではなかった。`fullRenderer.render()` が生成した HTML は Zotero の XHTML document へ直接入るが、`DOMPurify.sanitize()` 後の文字列を `innerHTML` へ入れると `SyntaxError: An invalid or illegal string was specified` が出た。

最小再現は `<p>a<br>b</p>` で、`<p>a<br />b</p>` は成功する。MarkdownIt は `xhtmlOut: true` により `<br />` を出すが、DOMPurify の文字列返却は `<br>` へ戻すため、XHTML parser が拒否する。この失敗を `setMessageHtml()` が catch し、`element.textContent = fallbackText` を実行したため、message 全体が raw Markdown として表示された。

採用した修正は、DOMPurify に `RETURN_DOM_FRAGMENT: true` を渡し、戻り値の `DocumentFragment` を `element.replaceChildren(fragment)` で入れる方式である。これにより HTML 文字列の再パースと XHTML void tag 形式の問題を避ける。`renderMarkdown()` 内の段階的 fallback は削除し、render 失敗時は log して例外を投げ、最終挿入点の fallback だけを残した。

Xpra screenshot は HTML client 切断後に stale backing store を表示することがあった。debugger で bot message に一時 style を付けても screenshot に反映されなかったため、今回の可視検証では live DOM と Zotero error buffer を正本にした。

### Referenced File Hashes

- `addon/content/chat.css`: `sha256:a0236484a3afc48d17ddccf4f5a279ed2fde6cffad905e9dc1efcab626817032`
- `src/modules/reader/ui.ts`: `sha256:ea6e43e933d97e19395b48890bf1f50e3b8acf6ac0e53e91fef6d4f361bf684c`

## References

