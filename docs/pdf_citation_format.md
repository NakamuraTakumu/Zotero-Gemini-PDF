# Ask My Paper PDF 引用形式

この文書は、Ask My Paper が LLM に assistant message 内で出力させる PDF 引用形式と、保存時の canonical 形式を定義する。

## LLM 出力契約

Zotero PDF を引用するとき、LLM は assistant message 本文に citation block を直接書く。

```markdown
::: citation {"rangeId":"r_7k9p2x4q"}
:::
```

開始行では、`citation` の後ろに JSON object を 1 つだけ置く。LLM は block 本文を書かない。block 本文は plugin が保存または表示前に生成する。

LLM は `locator`、offset、`sourceText`、`quote`、`rawText`、`textVersion` を citation block に書かない。`rangeId` は同じ LLM request 内の `register_pdf_quote` が返した値だけを使う。

## Citation Object

LLM が出力する citation block は、次の object を表す。

```ts
interface PdfCitation {
  rangeId: string;
}
```

`rangeId` は、plugin が request ごとに作る推測しにくい一時 ID である。形式は `r_` に短い random token を続けた文字列とする。UI は、保存後の canonical `locator` から人間向けの引用元ラベルを導出する。LLM は `source` field を別に出力してはならない。

## 正規化

Ask My Paper は、assistant message を保存または表示する前に、各 citation block を正規化する。

1. `rangeId` を request 内の range registry から解決する。
2. registry entry の `locator`、`text`、`before`、`after`、`textVersion` を検証する。
3. unknown `rangeId`、空 range、tool 未使用 `rangeId`、stale `textVersion` は citation block ごと drop し、diagnostics warning に残す。
4. citation render LLM に、対象 PDF、registry に登録された原文、前後の周辺文脈を渡して表示用テキストを生成する。
5. citation 開始行を、保存用 canonical `locator` に書き換え、表示用テキストを追加する。

chat history に保存される正規化済み citation block は、次の形式を使う。

```markdown
::: citation {"locator":{"libraryID":1,"attachmentKey":"ABCD1234","textVersion":"sha256:...","start":1203,"end":1264}}
表示用テキスト。数式は必要なら KaTeX で表示できる形にする。
:::
```

`locator` は LLM の責務ではなく、生成または計算してはならない。`textVersion` は `find_pdf_text` から `register_pdf_quote` へ変更せずコピーするためだけに使い、citation block には書かない。plugin は現在の PDF 本文から計算した値を正本として扱う。

## 原文テキストの扱い

LLM 出力は `rawText` と `textVersion` を含まない。

Ask My Paper は、生成時には request-local registry、保存後には canonical `locator` を使って、正確な引用原文を Zotero fulltext data から復元する。これにより、表示される回答を短く保ち、hover text や検証を LLM 生成の raw quotation text ではなく local PDF index に依存させる。

## 表示用テキスト生成

表示用テキストは、主チャット LLM ではなく citation render LLM が生成する。

入力:

- 対象 PDF。provider の file input / document input として渡す。
- `rawText`: `locator` から復元した正確な原文。
- `before` / `after`: `rawText` の前後から固定幅で切り出した周辺文脈。記号、略記、数式表記を解釈するための補助情報であり、追加の引用範囲ではない。

出力:

- citation block 本文に入れる表示用テキストだけ。
- 日本語を基本にする。
- 数式は KaTeX 互換の標準 LaTeX 表記にする。
- citation syntax、JSON、URL、markdown fence、説明文は出力してはならない。

citation render LLM は、添付 PDF を使って `rawText` 内の記号や数式表記を復元してよい。ただし、`rawText` が支えていない主張を追加してはならない。

## 引用位置探索 Tool

LLM は Zotero `attachmentText` 全体を直接受け取らない。PDF 引用が必要なときは、`find_pdf_text` が返すsource textからquoteを選び、`register_pdf_quote` が返した `rangeId` を使ってcitation blockを書く。
toolの入出力にはlocator offsetを含めず、pluginがquoteの完全一致位置から内部locatorを計算する。

### `find_pdf_text`

`find_pdf_text` は、引用したい原文に近い文字列を Zotero `attachmentText` 内で検索する。

```ts
type FindPdfTextArgs = {
  /** 検索対象 PDF attachment を所有する Zotero library ID。 */
  libraryID: number;

  /** 検索対象 PDF attachment の Zotero item key。 */
  attachmentKey: string;

  /** Zotero attachmentText 内で探したい文字列。PDF から引用したい原文にできるだけ近い形にする。 */
  query: string;

  /** 空白、改行、ハイフネーション、Unicode 正規化の差を吸収して検索するか。既定は true。 */
  normalize?: boolean;
};

type FindPdfTextResult = {
  /** plugin が現在の attachmentText から計算した hash。LLM は最終 citation に書かない。 */
  textVersion: string;

  /** 検索候補。 */
  matches: Array<{
    /** 検索一致を含む未変更の連続したPDF原文。 */
    sourceText: string;
  }>;
};
```

source textの前後幅はpluginが固定する。
source textを自然な文章境界へ補正するのではなく、LLMがその中から完全なquoteを選ぶ。

### `register_pdf_quote`

`register_pdf_quote` は、LLMがsource textから原文のまま抜き出したquoteを完全一致検索し、内部locatorへ登録する。
PDF全文でquoteが一意なら `sourceText` を省略する。
同じquoteが複数ある場合だけ、`find_pdf_text` が返した変更前の `sourceText` を追加する。

```ts
type RegisterPdfQuoteArgs = {
  /** 登録対象 PDF attachment を所有する Zotero library ID。 */
  libraryID: number;

  /** 登録対象 PDF attachment の Zotero item key。 */
  attachmentKey: string;

  /** find_pdf_text が返した attachmentText の hash。 */
  textVersion: string;

  /** sourceText から抜き出した未変更の完全な引用原文。 */
  quote: string;

  /** quote が PDF 全文に複数ある場合だけ渡す、find_pdf_text の未変更の sourceText。 */
  sourceText?: string;
};

type RegisterPdfQuoteResult = {
  /** 最終回答の citation block に書く request-local range ID。 */
  rangeId: string;

  /** plugin が現在の attachmentText から計算した hash。LLM は最終 citation に書かない。 */
  textVersion: string;

  /** 登録したquoteと完全一致するPDF原文。 */
  text: string;

  /** 登録範囲の直前文脈。 */
  before: string;

  /** 登録範囲の直後文脈。 */
  after: string;
};
```

source textを省略した場合、pluginはPDF全文でquoteが一度だけ現れる場合に限って登録する。
source textを渡した場合、pluginはPDF全文でsource textが一意であり、その中でquoteが一意である場合に限って登録する。
quoteとsource textの照合には正規化検索を使わない。

### Tool 制限

- `sourceText` の前後文脈: LLM は指定できない。plugin が検索一致の前後160 UTF-16 code unitsを使う。
- `maxMatches`: LLM は指定できない。plugin が固定値 5 を使う。
- `query`: 最大 2000 characters。
- `quote`: 最大 4000 characters。
- optional `sourceText`: 最大 8000 characters。
- tool call 回数が上限に達した場合、LLM は PDF citation なしで回答を続ける。

## Parse 規則

1. parser は、開始行が `::: citation ` で始まり、その後ろに valid JSON object が続く block だけを受け入れる。
2. LLM 生成時の JSON object は `rangeId` を持たなければならない。
3. JSON object は `source` を持ってはならない。引用元ラベルは UI が導出する。
4. 保存される `locator` は、`libraryID`、`attachmentKey`、`start`、`end`、plugin が生成した `textVersion` を持たなければならない。
5. `start` と `end` は non-negative integer でなければならず、`end` は `start` より大きくなければならない。
6. 互換性のため、正規化処理は legacy `{ "locator": ... }` block も受け入れる。ただし新規 LLM 生成の正規形式ではない。
7. LLM が block 本文を書いた場合でも、plugin はそれを信用せず citation render LLM の出力で置き換える。
8. nested citation block は invalid とする。
9. `locator` から Zotero fulltext data の text を復元できない場合、UI は該当 citation の近くに明確な警告を表示し、失敗した locator を log に残す。

## Rendering 規則

- 引用元ラベルは `locator` から導出し、citation header として表示する。
- 表示用テキストは、KaTeX support 付き Markdown として render する。
- hover text は `displayText` ではなく `locator` から復元する。
- renderer は、復元した正確な原文を DOM attribute または popup content に置く前に HTML escape しなければならない。

## Chat History

chat history は、assistant message text に保存用 canonical `::: citation {"locator":...} ... :::` block をそのまま含めて保存する。これにより message を plain text として portable に保ち、citation 用の第二の永続化 schema を避ける。

次 turn の LLM context を作るとき、保存済み locator block は raw のまま渡さない。履歴 adapter は block を marker に置換し、別枠の `Previous PDF evidence` として `evidenceId`、source label、復元した evidence text を渡す。offset JSON は LLM に見せない。

loader と renderer は、必要になった時点で citation block を `PdfCitation` object に parse する。parse 後の object は runtime derived state であり、永続化形式ではない。citation block を parse または validate できない場合でも、元の message text を正本として扱い、UI は該当 citation の近くに明確な警告を表示する。
