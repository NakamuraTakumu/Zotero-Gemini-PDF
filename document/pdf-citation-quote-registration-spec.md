---
title: "PDF Citation Quote Registration Specification"
responsibility: "検索結果の本文からLLMが選んだ引用文字列を、元PDFの一意な位置へ登録するtool calling契約を定義する。"
summary: "register_pdf_quoteは通常quoteだけで位置を確定し、PDF全文に同じquoteが複数ある場合だけfind_pdf_textのsource textを追加で受け取る。"
created: "2026-07-28 08:43 UTC"
updated: "2026-07-28 17:32 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "medium"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
---

# PDF Citation Quote Registration Specification

## Background

現行の `read_pdf_text_range` は、LLMがUTF-16 offsetの開始位置と終了位置を指定する。
LLMは原文を読んで自然な引用境界を判断できても、文字位置を正確に計算できないため、文、数式、箇条書きの途中で切れた範囲を登録しやすい。
一方、scriptによる文章分割だけでは、PDFから抽出された数式、段組、OCR、特殊な句読点を自然な単位へ常に分割できない。

この仕様では、文章境界の選択をLLMへ残し、offsetの計算と原文照合をpluginへ移す。
`find_pdf_text` は検索箇所を含むsource textを返す。
LLMはその本文から引用したい原文を文字列として抜き出し、通常はquoteだけを `register_pdf_quote` へ渡す。
PDF全文に同じquoteが複数ある場合だけ、位置を限定するために同じsource textも渡す。

## At a Glance

この仕様は、自然な引用境界をLLMに選ばせながら、原文上の位置をpluginが確定するtool calling契約を定める。
LLMはoffsetを扱わず、`find_pdf_text` が返したsource textからquoteを原文のまま抜き出す。
pluginは完全一致検索によってquoteをlocatorへ変換し、成功したlocatorにだけ `rangeId` を発行する。

通常経路では、source textを `register_pdf_quote` へ再送しない。

```text
find_pdf_text(query)
  → { textVersion, matches: [{ sourceText }] }

register_pdf_quote({ textVersion, quote })
  → PDF全文でquoteが一意
  → { rangeId, textVersion, text, before, after }
```

PDF全文に同じquoteが複数ある場合だけ、位置を限定するためにsource textを追加する。

```text
register_pdf_quote({ textVersion, quote })
  → quoteが複数あり位置を確定できない

register_pdf_quote({ textVersion, quote, sourceText })
  → PDF全文でsourceTextが一意
  → sourceText内でquoteが一意
  → { rangeId, textVersion, text, before, after }
```

この契約では、次の責務を分離する。

- **LLM**：検索queryを作り、source textから主張を直接支える最小の完全なquoteを選び、通常のMarkdown回答へ `rangeId` のcitation blockを置く。
- **plugin**：source textとquoteを原文へ完全一致で照合し、内部locatorのoffsetを計算し、PDF本文のversionと一意性を検証する。

`resultId`、公開offset、回答全体のJSON化、別の検証LLMは導入しない。
source textは曖昧性解消時だけ再送するため、通常のtool callにおけるLLMの出力tokenを抑える。
この方式が機械的に保証するのは、登録したquoteとPDF抽出本文の一致、およびPDF抽出本文内の位置の一意性である。
quoteが主張を十分かつ過不足なく支えるかはLLMの選択に残る。

実装前に確定していない値は、`find_pdf_text` が返すsource textの前後幅である。
実PDF fixtureを使い、完全なquoteを含む割合とtoken量を分けて測定して決める。

## Body

- [用語](#用語)
- [Toolの処理順序](#toolの処理順序)
- [`find_pdf_text`](#find_pdf_text)
  - [入力](#入力)
  - [出力](#出力)
  - [検索規則](#検索規則)
- [`register_pdf_quote`](#register_pdf_quote)
  - [入力契約](#入力契約)
  - [検証規則](#検証規則)
  - [位置の計算](#位置の計算)
  - [出力契約](#出力契約)
- [LLMの回答契約](#llmの回答契約)
- [失敗時の処理](#失敗時の処理)
- [Tool呼出し方針](#tool呼出し方針)
- [受入基準](#受入基準)
- [実装変更](#実装変更)
- [Referenced File Hashes](#referenced-file-hashes)

### 用語

この仕様では、検索結果に含める広い原文を**source text**と呼ぶ。
source textは、Zotero `attachmentText` の連続した範囲を一切変更せずに切り出した文字列である。

LLMがsource textから選んだ引用原文を**quote**と呼ぶ。
quoteはsource textの連続した部分文字列であり、要約、翻訳、空白正規化、数式変換を行っていない文字列である。

### Toolの処理順序

1. LLMが `find_pdf_text` で引用候補を検索する。
2. `find_pdf_text` が検索一致とsource textを返す。
3. LLMがsource textから、主張を直接支える最小の完全なquoteを選ぶ。
4. LLMがquoteを `register_pdf_quote` へ渡す。
5. pluginが現在の `attachmentText` 全体からquoteを完全一致検索する。
6. quoteが一度だけ見つかれば、pluginがglobal offsetとrequest-localな `rangeId` を発行する。
7. quoteが複数見つかった場合だけ、LLMが `find_pdf_text` のsource textを変更せず追加して再実行する。
8. pluginがPDF全文におけるsource textの位置と、その中のquoteの位置を計算し、`rangeId` を発行する。
9. LLMが通常のMarkdown回答へ `rangeId` のcitation blockを置く。

### `find_pdf_text`

#### 入力

```ts
interface FindPdfTextArgs {
  libraryID: number;
  attachmentKey: string;
  query: string;
  normalize?: boolean;
}
```

| field | 規則 |
| --- | --- |
| `libraryID` | PDF attachmentを所有するZotero library ID |
| `attachmentKey` | PDF attachmentのZotero item key |
| `query` | PDF本文から探す原文または原文に近い文字列 |
| `normalize` | 省略時は `true` とし、検索時だけ空白、改行、ハイフネーション、Unicode表記の差を吸収する |

`query` の最大長は2000 UTF-16 code unitsとする。
検索結果は最大5件とする。

#### 出力

```ts
interface FindPdfTextResult {
  textVersion: string;
  matches: Array<{
    sourceText: string;
  }>;
}
```

例を示す。

```json
{
  "textVersion": "sha256:...",
  "matches": [
    {
      "sourceText": "前の文。The squared loss is used because it gives a smooth objective. 次の文。"
    }
  ]
}
```

`sourceText` は検索queryに一致した箇所を含み、LLMが完全な文、数式、定義、箇条書きを選べる広さを持つ。

source textの前後幅はpluginが固定し、LLMから指定できないようにする。
固定値は実PDF fixtureで、必要なquoteを含む割合とtoken量を測って決める。
source textの開始位置と終了位置を自然な文章境界へ補正する必要はなく、そのoffsetをLLMへ返す必要もない。
自然な引用境界はLLMがsource text内から選ぶ。

#### 検索規則

検索時の正規化は、候補位置を見つけるためだけに使う。
返す `sourceText` は、常に元の `attachmentText` から切り出した未変更の文字列とする。

次の関係を満たさなければならない。

```ts
attachmentText.includes(sourceText);
```

### `register_pdf_quote`

`read_pdf_text_range` は廃止し、その責務を `register_pdf_quote` へ置き換える。
`register_pdf_quote` はoffset範囲をLLMから受け取らない。

#### 入力契約

```ts
interface RegisterPdfQuoteArgs {
  libraryID: number;
  attachmentKey: string;
  textVersion: string;
  quote: string;
  sourceText?: string;
}
```

通常の呼出しではsource textを省略する。

```json
{
  "libraryID": 1,
  "attachmentKey": "ABCD1234",
  "textVersion": "sha256:...",
  "quote": "The squared loss is used because it gives a smooth objective."
}
```

PDF全文に同じquoteが複数あるというerrorを受け取った場合だけ、`find_pdf_text` のsource textを追加して再実行する。

```json
{
  "libraryID": 1,
  "attachmentKey": "ABCD1234",
  "textVersion": "sha256:...",
  "sourceText": "前の文。The squared loss is used because it gives a smooth objective. 次の文。",
  "quote": "The squared loss is used because it gives a smooth objective."
}
```

LLMは `textVersion` を `find_pdf_text` の返却値から変更せずにコピーする。
source textを追加する場合、その文字列も同じ返却値から変更せずにコピーする。
LLMが引用内容として判断して作るfieldは `quote` だけとする。

quoteには、source textから連続したまま抜き出した原文を指定する。
quoteを要約、翻訳、補正、正規化してはならない。

#### 検証規則

pluginは次の順序で入力を検証する。

1. `libraryID` と `attachmentKey` が現在のPDF attachmentを指す。
2. 現在の `attachmentText` から計算したhashが `textVersion` と一致する。
3. `quote` が空文字列または空白だけではない。
4. quoteの長さがcitationの最大長を超えない。
5. source textを省略した場合、`quote` が現在の `attachmentText` 全体に完全一致で一度だけ含まれる。
6. source textを渡した場合、`sourceText` が現在の `attachmentText` 全体に完全一致で一度だけ含まれる。
7. source textを渡した場合、`quote` が `sourceText` に完全一致で一度だけ含まれる。

空白、改行、ハイフネーション、Unicode表記の正規化一致を `register_pdf_quote` で使用しない。
完全一致しないquoteを受け入れると、LLMが変更した文字列とPDF原文とのどちらを正本にするかが曖昧になるためである。

#### 位置の計算

source textを省略した場合、pluginはPDF全文からquoteの位置を求める。

```ts
const start = attachmentText.indexOf(quote);
const end = start + quote.length;
```

同じquoteがPDF全文に複数ある場合、この呼出しでは位置を確定せず、source textを追加するようerrorを返す。

source textを渡した場合、pluginはPDF全文におけるsource textの位置と、その中のquoteの位置を求める。

```ts
const sourceStart = attachmentText.indexOf(sourceText);
const localStart = sourceText.indexOf(quote);
const start = sourceStart + localStart;
const end = start + quote.length;
```

どちらの経路でも、計算後に次の関係を再検証する。

```ts
quote === attachmentText.slice(start, end);
```

通常はsource textをtool引数として再送しないため、LLMの出力tokenを抑えられる。
PDF全体に同じquoteが複数存在する場合も、source text内の出現が一回であれば位置を一意に確定できる。

#### 出力契約

```ts
interface RegisterPdfQuoteResult {
  rangeId: string;
  textVersion: string;
  text: string;
  before: string;
  after: string;
}
```

`rangeId` は現在のrequestだけで有効な推測困難なIDとする。
`text` は登録したquoteと完全一致しなければならない。
`before` と `after` は表示、確認、再試行のための固定幅文脈とする。

LLMが最終citation blockへ書くのは `rangeId` だけである。
pluginが計算したoffsetはrequest-local registryのlocatorにだけ保存する。
offset、source text、quote、textVersionは最終回答へ書かない。

### LLMの回答契約

LLMの回答全体をJSONまたは回答unitの配列にしない。
LLMは通常のMarkdownで自然に回答する。

PDF本文に基づく主張の近くへ、登録済み `rangeId` を使った空のcitation blockを置く。

```markdown
二乗誤差は、目的関数を滑らかにして勾配計算を扱いやすくするために採用されています。

::: citation {"rangeId":"r_b6n3t9wy"}
:::
```

citation blockの表示本文とcanonical locatorはpluginが生成する。

### 失敗時の処理

`register_pdf_quote` は検証に失敗したrangeを登録しない。
失敗理由をtool errorとしてLLMへ返し、quoteの選び直しまたは検索のやり直しを促す。

| 条件 | error |
| --- | --- |
| PDF本文が更新された | `PDF text changed after find_pdf_text. Search again.` |
| source text省略時にquoteがPDF全文にない | `Quote was not found in the PDF text.` |
| source text省略時にquoteがPDF全文に複数ある | `Quote occurs multiple times in the PDF text. Retry with the source text returned by find_pdf_text.` |
| source textがPDF全文にない | `Source text was not found in the PDF text.` |
| source textがPDF全文に複数ある | `Source text occurs multiple times in the PDF text. Use a longer source text.` |
| quoteがsource textにない | `Quote is not an exact substring of the supplied source text.` |
| quoteがsource textに複数回ある | `Quote occurs multiple times in the supplied source text. Use a narrower source or a longer exact quote.` |
| quoteが空 | `Quote is empty.` |
| quoteが長すぎる | `Quote exceeds the maximum citation length.` |

quoteがPDF全文に複数回あることは、source textを追加する条件であり、quote自体を不必要に長くする条件ではない。
quoteがsource textにも複数回ある場合だけ、別の `find_pdf_text` 結果を使うか、主張を直接支える範囲を保ったまま一意になる長さのquoteを選び直す。
どちらの場合もresult IDは導入しない。

### Tool呼出し方針

PDF本文に基づく回答では、最初の検索をpromptだけへ依存させない。
providerが特定toolの強制をサポートする場合、最初のroundで `find_pdf_text` を指定する。

`find_pdf_text` の実行後は、LLMが追加検索、`register_pdf_quote`、最終回答を選ぶ。
この仕様は自然な回答生成を優先し、回答全体の構造化出力や別の検証LLMを導入しない。

`register_pdf_quote` が一度も成功していない場合、LLMはPDF citation blockを出力できない。
既存のnormalizerは未登録 `rangeId` を拒否する。

### 受入基準

- `find_pdf_text` が返す `sourceText` は、現在の `attachmentText` に含まれる未変更の連続部分文字列である。
- `find_pdf_text` と `register_pdf_quote` はLLMへoffsetを返さず、LLMからoffsetを受け取らない。
- PDF全文でquoteが一意なら、source textを省略して登録できる。
- PDF全文でquoteが複数ある場合だけ、source textの追加を要求する。
- `register_pdf_quote` はPDF全文にsource textがない場合と、二回以上ある場合を拒否する。
- `register_pdf_quote` はsource text内にquoteがない場合と、二回以上ある場合を拒否する。
- 成功時の `text` は入力quoteおよびPDF原文のsliceと完全一致する。
- PDF全体に同じquoteが複数あっても、source text内で一意なら正しいglobal offsetを登録できる。
- `find_pdf_text` と `register_pdf_quote` の間にPDF本文が変わった場合、古い本文に基づく位置を登録しない。
- 最終回答は通常のMarkdownとして生成され、citationのために回答全体をJSON化しない。
- citation blockは成功した `register_pdf_quote` の `rangeId` だけを受け入れる。

### 実装変更

主な変更対象は次のとおりである。

1. `find_pdf_text` の返却値を、offset付きmatchからoffsetを持たない `sourceText` の候補へ変更する。
2. `read_pdf_text_range` を `register_pdf_quote` へ置き換える。
3. `register_pdf_quote` の `sourceText` をoptionalにし、省略時はPDF全文、指定時はsource text内でquoteの一意性を検証する。
4. system promptのoffset指定例を、source textからquoteを抜き出すtool call例へ変更する。
5. tool call diagnosticsへsource長、quote長、quote照合結果を記録する。
6. 既存の `rangeId` 正規化、canonical locator、citation表示処理は維持する。

### Referenced File Hashes

- `addon/prefs.js`: `sha256:feace5630e578488855859de55f450f28d5dd6adcd741ee2e6cede9cba87995e`
- `docs/pdf_citation_format.md`: `sha256:aca2a325035b1a9d8fd002efa2a353f9547b935d9ea137de12512a83b2af0cd4`
- `document/pdf-citation-requirements.md`: `sha256:43837ead062bede81768e60e232d31b5d255a8249a9870961cd9a8e4d4ba039e`
- `src/modules/llm/chat.ts`: `sha256:08e06bcf64621b1bca2fdeaba73237950317208b0eb8f9a85e433d1b5a70a392`
- `src/modules/pdfCitation.ts`: `sha256:b00f6ac9e362469811940995190d1fcb3ac5e2713dfc43cb3ecb2bb91dc47391`
- `test/llmChatToolLoop.test.ts`: `sha256:5a30e3d5a520b4e94cb1f4a479149fcbc502a5d9800fb1d6289774e04e9aeedb`
- `test/pdfCitation.test.ts`: `sha256:33a944beb2b68f64adff20d82b5bef5e5990b2b8446d5ea2225ecc6289f4195e`
