---
title: "PDF Citation Quote Registration Live Test"
responsibility: "quote登録方式が実プロバイダーでtool callingから引用表示まで動作するかを検証した結果を記録する。"
summary: "OpenAI gpt-5.4-miniはfind_pdf_textを2回実行後、sourceTextを再送せずregister_pdf_quoteへ231文字の完全一致quoteを登録し、引用1件をdropなしで表示した。"
created: "2026-07-28 18:14 UTC"
updated: "2026-07-29 04:49 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "medium"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
stale: false
---

# PDF Citation Quote Registration Live Test

## Background

`find_pdf_text` がoffsetなしのsource textを返し、LLMが選んだquoteを `register_pdf_quote` が完全一致で内部locatorへ変換する実装を、実際のプロバイダー応答で検証した。
単体テストではなく、Zotero readerのChatPaneから送信して、モデル選択、PDF context、tool loop、引用正規化、表示までを通した。

## At a Glance

```text
OpenAI gpt-5.4-mini
  → find_pdf_text: 0件
  → find_pdf_text: 1件、sourceText 512文字
  → register_pdf_quote: quote 231文字、sourceText省略
  → citation 1件をcanonical locatorへ変換
  → drop 0件
```

初回の検索強制、検索失敗後の再検索、原文quoteの登録、自然な日本語回答への引用表示が一つの実リクエストで動作した。
完全一致は、登録されたlocatorでZotero `attachmentText` を再取得して確認した。

## Body

- [試験条件](#試験条件)
- [Tool call](#tool-call)
- [完全一致](#完全一致)
- [結果](#結果)
- [検証範囲](#検証範囲)
- [Referenced File Hashes](#referenced-file-hashes)

### 試験条件

- 対象PDF: “Backprop as Functor: A compositional perspective on supervised learning”
- provider: OpenAI
- model: `gpt-5.4-mini`
- reasoning: Medium
- 入力: `According to this paper, how does it define a supervised learning algorithm? Answer in Japanese and cite the exact PDF evidence.`
- 経路: Xpra上のZotero reader ChatPane

API keyの値は取得または記録していない。

### Tool call

diagnosticsには3回の成功したtool callが保存された。

1. round 1の `find_pdf_text` は169文字のqueryを受け取り、一致0件を返した。
2. round 2の `find_pdf_text` は189文字のqueryを受け取り、一致1件と512文字のsource textを返した。
3. round 3の `register_pdf_quote` は231文字のquoteを受け取り、`rangeId` を返した。

`register_pdf_quote` の引数summaryにsource textはなく、通常経路どおり再送を省略していた。
3回ともstatusはsuccessであり、公開offsetをtool引数またはtool結果に使用していない。

### 完全一致

登録されたcanonical locatorは、attachment key `GN4YERH6` の `[12623, 12854)` を指した。
Zoteroから現在の `attachmentText` を取得して同じ範囲を切り出すと、長さ231の次の原文になった。

> Definition II.1. Let A and B be sets. A supervised learning algorithm, or simply learner, A → B is a tuple (P, I, U, r) where P is a set, and I, U, and r are functions of types:
> I : P × A → B,
> U : P × A × B → P,
> r : P × A × B → A.

diagnosticsの登録quoteも長さ231で、同じ書き出しを持つ。
pluginが保存したlocatorから復元した文字列と、LLMが登録したquoteは一致した。

### 結果

最終回答は日本語の通常Markdownで生成され、固定JSON responseや旧 `+++` wrapperを使用しなかった。
空のrequest-local citation blockはpluginによってcanonical locatorと表示用本文へ変換された。
diagnosticsはPDF citation 1件、drop 0件、warning 0件を記録した。

この試験では、LLMが最初の検索で引用候補を得られなくてもtool利用を中断せず、queryを変えて検索し直してから正確なquoteを登録した。

### 検証範囲

実プロバイダー試験はOpenAI `gpt-5.4-mini` の1リクエストである。
同一quoteがPDF全文に複数ある場合のoptional source text経路は単体テストで検証済みだが、この実リクエストでは発生していない。
GeminiとAnthropicへの実送信は今回の試験範囲に含めていない。

### Referenced File Hashes

- `addon/prefs.js`: `sha256:5399b86bfa619effeecedccfb5fbfb2b3056c9c2d59e3206f32a1c5988265ad5`
- `src/modules/llm/chat.ts`: `sha256:92b4cf442fb775c6929c34550e527a88c92c5e9e81f7f3c12122afbe7e765fe2`
- `src/modules/pdfCitation.ts`: `sha256:08f77bd09a99787ff49133258eb9c41c42c4c9fecf7569c700cd1ca96d5bc377`
