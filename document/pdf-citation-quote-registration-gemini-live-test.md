---
title: "PDF Citation Quote Registration Gemini Live Test"
responsibility: "quote登録方式がGeminiの実tool callingから引用表示まで動作するかを検証した結果を記録する。"
summary: "Gemini 3.1 Flash Liteはfind_pdf_textを1回実行後、sourceTextを再送せずregister_pdf_quoteへ192文字の完全一致quoteを登録し、引用1件をdropなしで表示した。"
created: "2026-07-29 04:15 UTC"
updated: "2026-07-29 04:49 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "medium"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
stale: false
---

# PDF Citation Quote Registration Gemini Live Test

## Background

offsetを公開しない `find_pdf_text` と、LLMが選んだ原文quoteを完全一致で登録する `register_pdf_quote` の組合せを、Geminiの実応答で検証した。
Zotero readerのChatPaneから送信し、Gemini adapter、tool loop、引用正規化、表示までを通した。

## At a Glance

```text
Gemini 3.1 Flash Lite
  → find_pdf_text: 1件、sourceText 512文字
  → register_pdf_quote: quote 192文字、sourceText省略
  → citation 1件をcanonical locatorへ変換
  → drop 0件、warning 0件
```

初回の検索強制からquote登録まで、追加検索なしの2回のtool callで完了した。
登録quoteはcanonical locatorからZotero `attachmentText` を再取得して完全一致を確認した。

## Body

- [試験条件](#試験条件)
- [Tool call](#tool-call)
- [完全一致](#完全一致)
- [結果](#結果)
- [検証範囲](#検証範囲)
- [Referenced File Hashes](#referenced-file-hashes)

### 試験条件

- 対象PDF: “Backprop as Functor: A compositional perspective on supervised learning”
- provider: Gemini
- model: `gemini-3.1-flash-lite`
- reasoning: Medium
- 入力: `According to this paper, how does it define a supervised learning algorithm? Answer in Japanese and cite the exact PDF evidence.`
- 経路: Xpra上のZotero reader ChatPane

API keyの値は取得または記録していない。

### Tool call

diagnosticsには2回の成功したtool callが保存された。

1. round 1の `find_pdf_text` は188文字のqueryを受け取り、一致1件と512文字のsource textを返した。
2. round 2の `register_pdf_quote` は192文字のquoteを受け取り、`rangeId` を返した。

`register_pdf_quote` の引数summaryにsource textはなく、通常経路どおり再送を省略していた。
両方のstatusはsuccessであり、公開offsetをtool引数またはtool結果に使用していない。

### 完全一致

登録されたcanonical locatorは、attachment key `GN4YERH6` の `[12661, 12853)` を指した。
Zoteroから現在の `attachmentText` を取得して同じ範囲を切り出すと、長さ192の次の原文になった。

> A supervised learning algorithm, or simply learner, A → B is a tuple (P, I, U, r) where P is a set, and I, U, and r are functions of types:
> I : P × A → B,
> U : P × A × B → P,
> r : P × A × B → A.

diagnosticsの登録quoteも長さ192で、同じ原文を持つ。
pluginが保存したlocatorから復元した文字列と、Geminiが登録したquoteは一致した。

### 結果

最終回答は日本語の通常Markdownで生成され、教師あり学習器をタプル $(P,I,U,r)$ として説明した。
request-local citation blockはpluginによってcanonical locatorと表示用本文へ変換された。
diagnosticsはPDF citation 1件、drop 0件、warning 0件を記録した。

Geminiは初回の強制 `find_pdf_text` に従い、その検索結果から完全な定義本文を選び、次roundで `register_pdf_quote` を呼んだ。

### 検証範囲

実プロバイダー試験はGemini `gemini-3.1-flash-lite` の1リクエストである。
同一quoteがPDF全文に複数ある場合のoptional source text経路は単体テストで検証済みだが、この実リクエストでは発生していない。

### Referenced File Hashes

- `addon/prefs.js`: `sha256:5399b86bfa619effeecedccfb5fbfb2b3056c9c2d59e3206f32a1c5988265ad5`
- `src/modules/llm/chat.ts`: `sha256:92b4cf442fb775c6929c34550e527a88c92c5e9e81f7f3c12122afbe7e765fe2`
- `src/modules/pdfCitation.ts`: `sha256:08f77bd09a99787ff49133258eb9c41c42c4c9fecf7569c700cd1ca96d5bc377`
