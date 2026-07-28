---
title: "Host-driven PDF Citation Design"
responsibility: "LLMのtool callに依存せず、PDF本文を正確な文章境界で引用する方式を定義する。"
summary: "hostが検索と文章境界確定を必ず実行し、LLMは事前生成したEvidenceCardを回答単位へ対応付けるだけの方式を採用する。"
created: "2026-07-28 08:02 UTC"
updated: "2026-07-28 08:02 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-sol"
reasoning_effort: "medium"
session: "019fa7ad-42be-7f70-a76e-7e1fe3e04ef8"
handling: "document-workflow"
---

# Host-driven PDF Citation Design

## Background

PDF citationの難所は、PDF本文を過不足のない文章境界で切り取ることと、LLMがcitation toolを呼ばないことにある。
現行実装はLLMのtool選択を `auto` にしており、tool callがない回答を正常終了として受け入れる。
範囲取得toolもLLMが指定したoffsetをclampするだけで、文章境界を確定しない。

先行するEvidenceCard案には、tool対応providerではLLMに検索toolを呼ばせる経路が残っていた。
この経路を廃止し、全providerでhostが引用処理を必ず実行する単一pipelineへ置き換える。

## At a Glance

- LLMへcitation toolを渡さない。
- hostが回答生成前にPDF snapshotを取得し、検索、文章分割、候補作成を必ず実行する。
- LLMは候補の `evidenceId` を回答単位へ対応付けるだけにする。
- 文章境界を確定できないPDF部分は引用しない。
- citation生成に失敗した場合は、citationだけを消して主張を残さない。

## Body

- [処理の所有者](#処理の所有者)
- [Host-driven pipeline](#host-driven-pipeline)
- [文章境界の確定](#文章境界の確定)
- [LLMの役割](#llmの役割)
- [失敗時の規則](#失敗時の規則)
- [検証順序](#検証順序)
- [Referenced File Hashes](#referenced-file-hashes)

### 処理の所有者

検索と引用をLLMの自発的なtool callへ依存させない。
ユーザーがPDFについて質問した時点で、application codeがcitation pipelineを常に起動する。

hostはPDF snapshot、検索、文章境界、locator、原文、version、citation描画を所有する。
LLMは質問への回答文と、hostが発行した根拠IDの選択だけを所有する。

### Host-driven pipeline

1. hostが対象attachmentの `attachmentText` を一度だけ取得し、immutableなsnapshotと `textVersion` を作る。
2. hostがsnapshotをparagraph、list item、sentence、table cellなどの `DocumentUnit` へ分割する。
3. hostがユーザーの質問を使ってlexical retrievalを必ず実行する。
4. hostが上位の完全な `DocumentUnit` だけを `EvidenceCard` として発行する。
5. hostが質問とcard一覧を、toolなしでLLMへ渡す。
6. LLMが回答単位と `evidenceId` の対応を構造化出力する。
7. hostがID、version、回答単位のcitation有無を検証する。
8. hostが保存済み原文からcitationを決定的に描画する。
9. hostが回答、card、検索過程、検証結果を一緒に保存する。

retrievalは最低限、Unicode正規化したtokenによるBM25を使用する。
日本語など空白区切りが安定しない本文には文字n-gramを併用する。
embedding rerankは候補順位を改善できるが、必須経路にしない。

### 文章境界の確定

固定文字数のchunkをcitationとして使わない。
固定長chunkは単語や文を切断し、無関係な隣接文を含めるためである。

文章境界は次の優先順位で確定する。

1. 空行や抽出器のblock情報によるparagraph境界。
2. bulletまたは番号によるlist item境界。
3. 句点、終止符、疑問符、感嘆符によるsentence境界。
4. layout情報を取得できる場合のtable cell境界。

sentence splitterは括弧と引用符のnesting、略語、小数、DOI、URL、文献参照を考慮する。
段落内のsentence境界が曖昧な場合は、段落全体をcardにする。
段落全体では無関係な内容を含みすぎる場合、cardを発行しない。

OCR崩れ、段組の読順崩壊、linear textへ崩れた表は、attachment textだけから正しい文章境界を一般には確定できない。
PDF extractorからpage、block、line、span、座標を取得できる場合だけ、その情報を使ってcardを作る。
取得できなければcitation不能として拒否する。

各cardについて、次の関係を機械検査する。

```ts
card.rawText === snapshot.slice(card.start, card.end)
```

この一致は原文忠実性を保証する。
そのcardが回答中の主張を意味的に支えるかは別の品質であり、gold setとclaim-evidence検証で評価する。

### LLMの役割

LLMへcitation tool、offset、locator、citation Markdownを与えない。
LLMは次の形式だけを返す。

```json
{
  "units": [
    {
      "text": "回答中の主張",
      "kind": "pdf-claim",
      "evidenceIds": ["e_17"]
    }
  ]
}
```

`pdf-claim` は一つ以上の有効な `evidenceId` を必要とする。
候補に根拠がなければ、LLMは具体的なPDF由来の主張を書かない。
structured outputに対応しないproviderでは、厳格なparserと一回だけの修復呼出しで同じ契約を適用する。

### 失敗時の規則

snapshot取得、文章分割、retrieval、ID検証、原文照合のいずれかが失敗した場合、verifiedなPDF回答を生成しない。
「PDF本文から検証可能な引用範囲を確定できない」と表示する。

LLMがIDを返さない場合もtoolへfallbackしない。
一回だけ構造修復を要求し、再び失敗したら回答本文を表示しない。

保存後にPDF本文が変わった場合、保存した原文を表示してcitationをstaleとする。
現在の同じoffsetを保存時の根拠として読み直さない。

### 検証順序

1. 実PDFから正解の開始位置と終了位置を人手で付けたfixtureを作る。
2. paragraph、list item、sentenceの境界抽出をpure functionとして検証する。
3. OCR、段組、表を誤ってcard化せずrejectできるか確認する。
4. ユーザー質問だけを使うhost retrievalの候補再現率を測る。
5. tool listなしのLLM呼出しと構造検証を統合する。
6. 保存、再読込、hover、Reader移動で同じ原文とanchorへ到達するか検証する。
7. provider、streaming、複数の内部処理で同じpipelineを通ることを確認する。

実装は境界抽出のfixtureとReader anchorの実験から始める。
この二つが成立する前にLLM integrationを変更しても、正確な引用を検証できない。

### Referenced File Hashes

- `document/pdf-citation-evidence-card-design.md`: `sha256:ce7ab0fdceb1b7e2ccf79146a60c6963b6aea827f7a681b53b5dac38dfb343df`
- `document/pdf-citation-requirements.md`: `sha256:43837ead062bede81768e60e232d31b5d255a8249a9870961cd9a8e4d4ba039e`
- `src/modules/llm/chat.ts`: `sha256:08e06bcf64621b1bca2fdeaba73237950317208b0eb8f9a85e433d1b5a70a392`
- `src/modules/llm/citationRenderService.ts`: `sha256:13177e699c6719f090f9e1759fb39e40329c8f71e026455082354a6733ef9ef1`
- `src/modules/llm/langChainMessages.ts`: `sha256:7b912f35c86d65d2872dc2e615c4fbfea971970f4d3445a7d0c256c5bc235346`
- `src/modules/pdfCitation.ts`: `sha256:b00f6ac9e362469811940995190d1fcb3ac5e2713dfc43cb3ecb2bb91dc47391`
- `test/pdfCitation.test.ts`: `sha256:33a944beb2b68f64adff20d82b5bef5e5990b2b8446d5ea2225ecc6289f4195e`
