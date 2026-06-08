# Ask My Paper PDF 引用形式

この文書は、Ask My Paper が LLM に assistant message 内で出力させる PDF 引用形式を定義する。

## LLM 出力契約

Zotero PDF を引用するとき、LLM は assistant message 本文に citation block を直接書く。

```markdown
::: citation {"locator":{"libraryID":1,"attachmentKey":"ABCD1234","start":1203,"end":1264}}
:::
```

開始行では、`citation` の後ろに JSON object を 1 つだけ置く。LLM は block 本文を書かない。block 本文は plugin が保存または表示前に生成する。

## Citation Object

LLM が出力する citation block は、次の object を表す。

```ts
interface PdfCitation {
  locator: {
    libraryID: number;
    attachmentKey: string;
    start: number;
    end: number;
  };
}
```

各 field の意味:

- `locator.libraryID`: PDF attachment を所有する Zotero library ID。
- `locator.attachmentKey`: PDF attachment の Zotero item key。
- `locator.start`: 引用範囲が始まる Zotero `attachmentText` 内の 0-based character offset。
- `locator.end`: 引用範囲が終わる Zotero `attachmentText` 内の 0-based character offset。この offset の文字は範囲に含まない。
  UI は、人間向けの引用元ラベルを `locator` から導出する。例えば attachment title または file name を解決して表示する。LLM は `source` field を別に出力してはならない。

## 正規化

Ask My Paper は、assistant message を保存または表示する前に、各 citation block を正規化する。

1. `libraryID` と `attachmentKey` から Zotero PDF attachment を解決する。
2. 現在の Zotero `attachmentText` を読む。
3. `sha256(attachmentText)` など、plugin が所有する hash として `textVersion` を計算する。
4. `start` と `end` が、その `attachmentText` 内の空でない範囲を指すことを検証する。
5. citation render LLM に、対象 PDF、復元した原文、前後の周辺文脈を渡して表示用テキストを生成する。
6. citation 開始行を書き換え、`textVersion` と表示用テキストを追加する。

chat history に保存される正規化済み citation block は、次の形式を使う。

```markdown
::: citation {"locator":{"libraryID":1,"attachmentKey":"ABCD1234","textVersion":"sha256:...","start":1203,"end":1264}}
表示用テキスト。数式は必要なら KaTeX で表示できる形にする。
:::
```

`textVersion` は LLM の責務ではない。LLM はこれを生成、計算、または copy してはならない。tool result が `textVersion` を含む場合でも、plugin は自分で計算した値を正本として扱う。

## 原文テキストの扱い

LLM 出力は `rawText` と `textVersion` を含まない。

Ask My Paper は `locator` を使って、正確な引用原文を Zotero fulltext data から復元する。これにより、表示される回答を短く保ち、hover text や検証を LLM 生成の raw quotation text ではなく local PDF index に依存させる。

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

LLM は Zotero `attachmentText` 全体を直接受け取らない。PDF 引用が必要なときは、tool calling で `attachmentText` 内の引用位置を探索し、最終回答には確定した `start` と `end` を使って citation block を書く。

`start` と `end` は JavaScript string index と同じ UTF-16 code unit offset とする。

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

  /** 返す候補数の上限。既定値と最大値は plugin 側で制限する。 */
  maxMatches?: number;

  /** 各候補範囲の前に追加で返す最大文字数。match start の直前から UTF-16 code unit 数で切り出す。 */
  contextBefore?: number;

  /** 各候補範囲の後に追加で返す最大文字数。match end の直後から UTF-16 code unit 数で切り出す。 */
  contextAfter?: number;
};

type FindPdfTextResult = {
  /** plugin が現在の attachmentText から計算した hash。LLM は最終 citation に書かない。 */
  textVersion: string;

  /** 検索候補。 */
  matches: Array<{
    /** 候補範囲の開始 offset。UTF-16 code unit index。 */
    start: number;

    /** 候補範囲の終了 offset。UTF-16 code unit index。この offset の文字は含まない。 */
    end: number;

    /** 候補範囲の原文。 */
    text: string;

    /** 候補範囲の直前文脈。contextBefore に従い、match start の直前から切り出す。 */
    before: string;

    /** 候補範囲の直後文脈。contextAfter に従い、match end の直後から切り出す。 */
    after: string;
  }>;
};
```

### `read_pdf_text_range`

`read_pdf_text_range` は、指定された `start` と `end` の範囲を Zotero `attachmentText` から読み、必要に応じて前後の固定幅文脈も返す。

```ts
type ReadPdfTextRangeArgs = {
  /** 読み取り対象 PDF attachment を所有する Zotero library ID。 */
  libraryID: number;

  /** 読み取り対象 PDF attachment の Zotero item key。 */
  attachmentKey: string;

  /** 読み取りたい範囲の開始 offset。UTF-16 code unit index。 */
  start: number;

  /** 読み取りたい範囲の終了 offset。UTF-16 code unit index。この offset の文字は含まない。 */
  end: number;

  /** 範囲の前に追加で返す最大文字数。start の直前から UTF-16 code unit 数で切り出す。 */
  contextBefore?: number;

  /** 範囲の後に追加で返す最大文字数。end の直後から UTF-16 code unit 数で切り出す。 */
  contextAfter?: number;
};

type ReadPdfTextRangeResult = {
  /** plugin が現在の attachmentText から計算した hash。LLM は最終 citation に書かない。 */
  textVersion: string;

  /** 実際に返した主範囲の開始 offset。範囲外指定の場合は plugin 側で clamp される。 */
  start: number;

  /** 実際に返した主範囲の終了 offset。この offset の文字は含まない。範囲外指定の場合は plugin 側で clamp される。 */
  end: number;

  /** 指定範囲の原文。 */
  text: string;

  /** 指定範囲の直前文脈。contextBefore に従い、start の直前から切り出す。 */
  before: string;

  /** 指定範囲の直後文脈。contextAfter に従い、end の直後から切り出す。 */
  after: string;
};
```

### Tool 制限

- `contextBefore` / `contextAfter`: 既定値は 160、最大値は 800。
- `maxMatches`: 既定値は 5、最大値は 20。
- `query`: 最大 2000 characters。
- `read_pdf_text_range` の `end - start`: 最大 4000 characters。
- tool call 回数が上限に達した場合、LLM は PDF citation なしで回答を続ける。

## Parse 規則

1. parser は、開始行が `::: citation ` で始まり、その後ろに valid JSON object が続く block だけを受け入れる。
2. JSON object は `locator` を持たなければならない。
3. JSON object は `source` を持ってはならない。引用元ラベルは UI が導出する。
4. LLM が出力する `locator` は、`libraryID`、`attachmentKey`、`start`、`end` を持たなければならない。
5. 保存される `locator` は、plugin が生成した `textVersion` も持たなければならない。
6. `start` と `end` は non-negative integer でなければならず、`end` は `start` より大きくなければならない。
7. LLM が block 本文を書いた場合でも、plugin はそれを信用せず citation render LLM の出力で置き換える。
8. nested citation block は invalid とする。
9. `locator` から Zotero fulltext data の text を復元できない場合、UI は該当 citation の近くに明確な警告を表示し、失敗した locator を log に残す。

## Rendering 規則

- 引用元ラベルは `locator` から導出し、citation header として表示する。
- 表示用テキストは、KaTeX support 付き Markdown として render する。
- hover text は `displayText` ではなく `locator` から復元する。
- renderer は、復元した正確な原文を DOM attribute または popup content に置く前に HTML escape しなければならない。

## Chat History

chat history は、assistant message text に `::: citation ... :::` block をそのまま含めて保存する。これにより message を plain text として portable に保ち、citation 用の第二の永続化 schema を避ける。

loader と renderer は、必要になった時点で citation block を `PdfCitation` object に parse する。parse 後の object は runtime derived state であり、永続化形式ではない。citation block を parse または validate できない場合でも、元の message text を正本として扱い、UI は該当 citation の近くに明確な警告を表示する。
