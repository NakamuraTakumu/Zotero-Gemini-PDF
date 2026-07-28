---
title: "PDF Citation Evidence Card Design"
responsibility: "PDF citation要件を満たすための解決方式と、実装前に確定すべき契約を提案する。"
summary: "pluginが完全な根拠単位をEvidenceCardとして確定し、LLMは主張とevidenceIdだけを対応付ける方式を提案する。"
created: "2026-07-28 07:46 UTC"
updated: "2026-07-28 07:46 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "medium"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
---

# PDF Citation Evidence Card Design

## Background

現行実装では、LLMが `read_pdf_text_range` に開始位置と終了位置を渡し、pluginが返却範囲を `rangeId` に登録する。
この方式は最終回答に未登録のlocatorを混入させる問題を防ぐが、LLMが不正確な範囲を選ぶ問題は防がない。
表示用citationを別のLLMで生成する処理、request内だけに存在するregistry、保存後に同じoffsetを読み直す処理も、本文忠実性と事後追跡を弱めている。

解くべき問題は、PDF範囲の同定、回答中の主張と根拠の対応、処理境界をまたぐ根拠情報の保持に分かれる。
citationの表示位置だけを直しても、ほかの二つは解決しない。
この文書は三つの問題を別々の契約として扱い、実装順序と検証条件を提案する。

## At a Glance

- **提案**：pluginがPDF本文から完全な根拠単位を `EvidenceCard` として発行し、LLMはlocatorではなく `evidenceId` を回答単位へ対応付ける。
- **機械的に保証する範囲**：locatorの真正性、原文の忠実性、境界単位の完全性、保存後の追跡可能性、citationの表示位置をpluginが保証する。
- **評価で管理する範囲**：主張を根拠が意味的に支えるか、根拠が過不足ないかは完全には機械判定できないため、検証段階とgold setで管理する。
- **失敗時の規則**：citation生成に失敗した主張だけを残してはならない。
  回答を未検証として明示するか、該当主張を回答から除く。
- **実装前の確認**：Zotero ReaderでPDF本文位置へ移動できる `viewerAnchor` の取得方法を実PDFで検証する。
  attachment textのoffsetだけでは、PDF上の根拠箇所をユーザーが確認できるとは限らない。

この提案は設計案であり、実装の承認を表さない。

## Body

- [問題の分解](#問題の分解)
- [現行方式の失敗機構](#現行方式の失敗機構)
- [EvidenceCard方式](#evidencecard方式)
  - [根拠の検索](#根拠の検索)
  - [根拠単位の契約](#根拠単位の契約)
  - [回答単位の契約](#回答単位の契約)
  - [citationの確定](#citationの確定)
  - [保存と再表示](#保存と再表示)
- [保証の境界](#保証の境界)
- [代替案の評価](#代替案の評価)
- [段階的な実装](#段階的な実装)
- [受入基準](#受入基準)
- [実装前の判断事項](#実装前の判断事項)
- [Referenced File Hashes](#referenced-file-hashes)

### 問題の分解

PDF citationには、別々に検証すべき三つの対応がある。

1. **原文対応**：根拠IDが、特定versionのPDF抽出本文と一意の範囲に対応する。
2. **主張対応**：回答単位が、それを直接支える根拠IDに対応する。
3. **表示対応**：回答単位の直後に表示したcitationから、保存時の原文とPDF Reader上の位置へ到達できる。

原文対応はpluginのデータ処理で保証できる。
主張対応には意味判定が含まれるため、自動検証で誤りを減らせても完全な保証はできない。
表示対応にはattachment textのoffsetだけでなく、Zotero Readerが解釈できる位置情報が必要になる。

### 現行方式の失敗機構

現行の `rangeId` はpluginが発行するが、その登録内容を決める開始位置と終了位置はLLMが指定する。
`read_pdf_text_range` は不正なoffsetをclampし、長い範囲を切り詰めるだけで、文境界への補正や主張との対応検査を行わない。
したがって、未登録locatorの混入を防げても、狭すぎる範囲、広すぎる範囲、文途中で切れた範囲を防げない。

最終citationの表示本文は別のLLM呼出しで生成される。
生成後の検査は構文と長さを中心としており、表示本文と保存した原文の完全一致を確かめない。
rendererが失敗するとcitation blockだけを削除するため、根拠を必要とする主張がcitationなしで残る。

registryはrequest内だけに存在し、保存するassistant messageには完全な根拠記録が残らない。
次のturnとhoverでは保存済みoffsetから現在のattachment textを読み直す。
PDF本文のversionが変わった場合、同じoffsetが別の本文を指しても、その本文を根拠として後続処理へ渡す可能性がある。

canonical citationのUI処理はhover表示だけを実装している。
citationからPDFを開き、該当位置へ移動または選択するclick処理は存在しない。
この状態では、hover本文を確認できても、PDF上の根拠箇所を確認できるという要件を満たしたとは判定できない。

### EvidenceCard方式

#### 根拠の検索

検索処理はLLMへ任せてもよいが、範囲の確定はpluginが行う。
toolを利用できるproviderでは、LLMが検索queryを指定し、pluginが検索結果を完全な根拠単位へ変換して `EvidenceCard` を返す。
toolを利用できないproviderでは、pluginがユーザー質問から事前検索し、同じ `EvidenceCard` をcontextへ渡す。
どちらの経路でも、LLMへoffsetの指定権を渡さない。

検索結果を一つの固定長chunkとしてそのまま根拠にしない。
pluginは抽出本文を文、段落、箇条書き項目、表セルなどの型付き単位へ分け、境界を確定できた単位だけをcardとして発行する。
一つの主張に複数の隣接単位が必要な場合は、LLMがoffsetを拡張するのではなく、複数の `evidenceId` を選ぶ。

#### 根拠単位の契約

最小の `EvidenceCard` は次の情報を持つ。

```ts
type EvidenceCard = {
  evidenceId: string;
  locator: {
    libraryID: number;
    attachmentKey: string;
    start: number;
    end: number;
    textVersion: string;
    viewerAnchor?: PdfViewerAnchor;
  };
  rawText: string;
  rawTextHash: string;
  boundaryKind: "sentence" | "paragraph" | "list-item" | "table-cell";
  boundaryAlgorithmVersion: string;
  retrieval: {
    query: string;
    matchOrChunkId: string;
  };
  before: string;
  after: string;
};
```

`rawText` は保存時の抽出本文を示す正本とする。
表示用本文をLLMに書き換えさせない。
整形が必要な場合は、改行の表示やHTML escapeなど、原文を変更しない決定的な変換だけを適用する。

境界を確定できない抽出結果からcardを作らない。
OCR、段組、数式、表などを安全に扱えない場合は、citation不能として上位処理へ返す。
不正確なcitationを生成するより回答可能範囲を狭める。

#### 回答単位の契約

LLMはMarkdownへcitation blockを直接書かない。
LLMは、回答単位の本文と `evidenceId` の対応だけを返す。

```ts
type AnswerDraft = {
  units: Array<{
    text: string;
    evidenceIds: string[];
    kind: "pdf-claim" | "reasoning" | "conversation";
  }>;
};
```

`pdf-claim` の `evidenceIds` は空にできない。
registryに存在しないID、別requestのID、textVersionが一致しないIDを含む回答は確定しない。
structured outputを利用できないproviderでは、厳格なparserと一回の修復処理を使い、修復できなければ未検証回答として扱う。

`kind` は、citationを必要とする主張の境界を曖昧なままにしないための分類である。
ただし、LLM自身に `kind` を選ばせるだけではcitationの回避を防げない。
pluginはPDF card由来の具体的な事実を含むunitを検査し、必要に応じて回答全体を再生成または未検証扱いにする。

#### citationの確定

pluginは検証済み `AnswerDraft` からMarkdownを決定的に組み立てる。
各unitの直後へ、そのunitに対応するcardからcanonical citation blockを挿入する。
tool callのprovider固有の出現位置を復元する必要はない。

citation生成の一部が失敗した場合、citationだけを削除して主張を残さない。
次のいずれかをmessage全体の状態として明示する。

- **verified**：すべての `pdf-claim` が有効なcardを参照する。
- **partially-verified**：未検証unitをUIで区別し、citationがないことを明示する。
- **rejected**：構造または根拠対応を復旧できず、回答本文を表示しない。

既定は `verified` または `rejected` とする。
`partially-verified` を許可するかは、UI表現と合わせて実装前に決める。

#### 保存と再表示

assistant messageには表示Markdownだけでなく、利用した `EvidenceCard`、unitとcardの対応、検索event、検証結果を保存する。
providerの生応答を無制限に保存する必要はないが、citationを再現できる入力と変換結果は縮約しない。

保存後のhoverは現在のoffsetを読み直した本文ではなく、保存した `rawText` を表示する。
現在のattachment textと `textVersion` が一致する場合だけ、locatorをcurrentとして扱う。
一致しない場合はstaleと表示し、現在の同じoffsetを保存時の根拠として扱わない。

再アンカーは、保存した `rawText` と前後文脈が現在本文中の一箇所だけに一致する場合に限り、派生locatorとして提案できる。
自動的に正本locatorを書き換えない。
クリックによるReader移動には、card作成時に取得した `viewerAnchor` を使用する。

### 保証の境界

EvidenceCard方式は、locatorと原文の対応、原文の無改変、完全な抽出単位、処理後の追跡を機械的に検査できる形へ変える。
providerやstreaming方式が変わっても、plugin内のcardと回答単位の契約は変わらない。

一方、cardが主張を意味的に直接支えることと、複数cardの集合が過不足ないことは、一般の自然言語について完全には機械判定できない。
この性質を保証済みと表現してはならない。
独立したclaim-evidence検証、失敗時の再生成、gold setによる継続評価を組み合わせ、許容水準を受入基準として定める。

streamingでは、未確定のunitをユーザーへ公開しない。
unit本文とcard対応の検証が終わった時点で、unitとcitationを一緒に追加する。
token単位の低遅延表示よりcitationの完全性を優先する。

### 代替案の評価

| 方式 | 改善する問題 | 残る破綻 | 判断 |
| --- | --- | --- | --- |
| 現行 `rangeId` の強化 | 未登録locator、offsetの範囲外指定 | LLMによる不適切な範囲選択、主張との誤対応 | 採用しない |
| 文境界へのsnap | 文途中の切断 | 誤った位置、過大な範囲、表や段組の境界 | 補助処理としてだけ使う |
| quoteと曖昧検索 | offsetの直接生成 | 重複表現、OCR差、短すぎるquote、誤ったquote | card検索の内部処理としてだけ使う |
| tool call位置からのcitation注入 | citationの表示位置 | locatorと主張の正しさ、provider横断のordered content | 主方式にしない |
| EvidenceCard | locator所有、完全単位、主張対応、永続化 | retrieval漏れ、意味的な過剰一般化 | 提案方式 |

tool call位置の復元案は、citationを表示する場所と根拠範囲を決める処理を結合する。
EvidenceCard方式では回答unitが表示位置を持つため、このprovider固有処理を必須にしない。

### 段階的な実装

一度に置き換えると、範囲抽出、LLM契約、永続化、UIのどこで失敗したか判別しにくい。
次の段階ごとに受入試験を通してから次へ進む。

1. **viewer anchorの実験**：実PDFからattachment textの範囲とReader上の位置を対応付け、clickで移動または選択できるか確認する。
2. **境界抽出**：実PDF fixtureから型付き根拠単位を作り、境界を確定できない入力をrejectする。
3. **EvidenceCard registry**：cardからlocatorと `rawText` を再現し、hashとtextVersionを検証する。
4. **回答契約**：LLM出力を `AnswerDraft` へ制限し、不正ID、空ID、別request IDをrejectする。
5. **決定的な描画**：pluginがunitの直後へcitationを挿入し、表示本文が `rawText` と一致することを検査する。
6. **永続化とstale処理**：保存、再読込、次turn、hoverで同じcardを利用し、version不一致時に現在offsetを使わない。
7. **provider経路**：tool対応と非対応のprovider、通常応答とstreaming、複数tool roundで同じ中間契約を通す。
8. **意味品質の評価**：gold setでcitation coverage、主張支持率、範囲妥当率、citation不能時の安全な拒否率を別々に測る。

最初の実装対象を段階3以降にしてはならない。
viewer anchorと境界抽出が成立しなければ、後段を実装してもユーザーが検証できるcitationにはならない。

### 受入基準

- LLMがoffset、locator、canonical citation blockを生成する経路がない。
- すべての表示citationは、同じmessageに保存した `EvidenceCard` から再現できる。
- citation本文は保存した `rawText` とbyte単位または定義済みUnicode正規化後に一致する。
- `pdf-claim` は有効な `evidenceId` を一つ以上持ち、citation生成失敗時に主張だけが表示されない。
- sentence、paragraph、list itemのfixtureで範囲が語や文を途中で切らない。
- table、段組、OCR崩れなど境界を確定できないfixtureは不正確なcardを作らずrejectされる。
- 保存後にPDF本文が変わるとcitationはstaleになり、現在の同じoffsetの本文を保存時の根拠として表示しない。
- citationをclickすると、対応PDFを開き、保存した根拠位置へ移動または選択できる。
- provider、非streaming、streaming、複数tool roundのfixtureが同じ `EvidenceCard` と `AnswerDraft` のvalidationを通る。
- gold setの品質閾値を実装開始前に決め、locator整合性と意味的な主張支持率を混ぜずに測定する。

### 実装前の判断事項

次の判断は、実装の規模と失敗時のUIを変えるため、着手前にユーザーの承認が必要である。

1. `partially-verified` を許可するか、citation不能時は回答全体をrejectするか。
2. 保存した `rawText` をmessage metadataへ複製するか、content-addressedな別storeへ置くか。
3. gold setで要求するcitation coverage、主張支持率、範囲妥当率の閾値。
4. Zotero Readerで利用する `viewerAnchor` の形式と、取得できないPDFの扱い。
5. 既存の `::: citation` 表示形式を互換性条件として維持するか。

### Referenced File Hashes

- `document/pdf-citation-requirements.md`: `sha256:43837ead062bede81768e60e232d31b5d255a8249a9870961cd9a8e4d4ba039e`
- `document/pdf-citation-tool-call-position.md`: `sha256:5230b362c1f5e1d34654b5e927d92be48810a128b524433f44f8261e69816857`
- `src/modules/llm/chat.ts`: `sha256:08e06bcf64621b1bca2fdeaba73237950317208b0eb8f9a85e433d1b5a70a392`
- `src/modules/llm/langChainMessages.ts`: `sha256:7b912f35c86d65d2872dc2e615c4fbfea971970f4d3445a7d0c256c5bc235346`
- `src/modules/pdfCitation.ts`: `sha256:b00f6ac9e362469811940995190d1fcb3ac5e2713dfc43cb3ecb2bb91dc47391`
- `src/modules/reader/ui.ts`: `sha256:ea6e43e933d97e19395b48890bf1f50e3b8acf6ac0e53e91fef6d4f361bf684c`
- `src/types/chat.d.ts`: `sha256:f786605f22659b0cff7bc77971a845f94d3046d9de02e42751a41cabd5a91071`
- `test/langChainMessages.test.ts`: `sha256:9acbaa7981b722686d5eafea24890946a1c809b5d4c35aa70626ca39d616f730`
- `test/llmChatToolLoop.test.ts`: `sha256:5a30e3d5a520b4e94cb1f4a479149fcbc502a5d9800fb1d6289774e04e9aeedb`
- `test/pdfCitation.test.ts`: `sha256:33a944beb2b68f64adff20d82b5bef5e5990b2b8446d5ea2225ecc6289f4195e`
