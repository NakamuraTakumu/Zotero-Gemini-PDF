# PDF Citation Tool Call Position

- Created: 2026-06-08 14:50 UTC
- Updated: 2026-06-14 13:19 UTC
- Model: gpt-5.5
- Reasoning-Effort: low
- Session: 019e970b-9398-7723-bc6d-705e97b2012f
- Repository: /home/nakamura/gemini-pdf
- Related-Commit: none
- Handling: この document の取り扱いは document-workflow に準拠する。

Responsibility: PDF citation の locator 精度問題について、プロジェクト背景、現行実装、試行錯誤、不採用案、残る論点を外部レビュー向けに整理する。

## Background

この repository は Zotero plugin として動く PDF QA / citation 支援ツールである。ユーザーは Zotero 内の PDF について LLM に質問し、回答中に PDF の根拠箇所を citation として表示したい。

現在の citation 表示は、assistant text に含まれる次のような Markdown block を plugin が解釈する形で成立している。

```markdown
::: citation {"locator":{...}}
表示用の引用説明
:::
```

問題は、回答エージェントが作る `locator.start` / `locator.end` が雑になることである。citation render 側が `rawText` に基づいて安全に表示文を作っても、locator そのものが広すぎる、狭すぎる、途中で切れている、別内容を含む、という場合は根拠範囲が壊れる。

この文書は、最初は「`::: citation` を LLM に直接書かせず、citation 用 tool call の位置ログから citation block を生成する」という案を検討するために作られた。その後の議論で、tool call 化だけでは locator の根本問題を解決しないことが明確になったため、ここでは過去案の失敗理由と、より根本的な発想転換の必要性も含めて整理する。

## Result

- **プロジェクト概要**: Zotero plugin 上で PDF を読み、LLM 回答に PDF citation を埋め込む。最終 UI の citation 表示形式は既存の `::: citation {"locator":...}` block を維持したい。
- **根本問題**: LLM が citation locator を自由に作る限り、tool call 化、prompt 強化、render prompt 強化だけでは `start` / `end` の精度を保証できない。
- **現行実装**: `find_pdf_text` / `read_pdf_text_range` tool と `normalizePdfCitationBlocks()` は存在するが、回答本文中の `::: citation` を正規化する設計であり、citation 作成の正本はまだ LLM text 側にある。
- **過去の有力案**: `create_pdf_citation(locator)` tool call を導入し、tool call の発生位置を `::: citation` block に変換する。これは placeholder や block 貼り間違いを減らすが、locator argument を LLM が作るなら根本精度は改善しない。
- **現在の反省**: 「citation をどこに表示するか」と「どの PDF 範囲を根拠にするか」は別問題である。tool call 位置復元は前者への対策であり、後者への対策ではない。
- **発想転換の候補**: LLM に citation 範囲を選ばせるのではなく、retrieval / PDF extraction pipeline が先に exact locator 付き evidence card を作り、LLM はその evidence card だけを使って文章化する。citation は LLM の後付け生成物ではなく、入力 evidence の provenance として自動付与する。
- **外部レビューで見てほしい点**: 既存 UI 形式を保ちながら、LLM に locator を作らせない architecture にできるか。特に、evidence card provenance 方式、quote/match 方式、tool call position 方式のどれを最小実装として選ぶべきか。

## Detail

### Project Overview

この plugin は Zotero desktop 上で動く。PDF の本文を検索・範囲読み取りし、LLM に PDF 内容を踏まえた回答を生成させる。回答には citation block が含まれ、plugin はその block を読み取って、根拠範囲の本文、前後文脈、locator、表示用説明を扱う。

主な関心は論文 PDF である。ユーザーは「回答のどの主張が PDF のどの範囲に支えられているか」を見たい。したがって citation は装飾ではなく、回答の信頼性と検証可能性に直結する。

### Current Citation Workflow

現行 workflow は大まかに次の形である。

1. 回答エージェントが PDF tool を呼ぶ。
2. 必要に応じて `find_pdf_text` や `read_pdf_text_range` で PDF 本文を取得する。
3. assistant text に `::: citation {"locator":...}` block を書く。
4. plugin が `normalizePdfCitationBlocks()` で citation block を検出し、locator を正規化する。
5. citation render service が locator の `rawText` などを使って表示用本文を生成する。

この構造では、citation render 側がどれだけ安全でも、回答エージェントが書いた locator が間違っていれば根拠範囲は直らない。

### Requirements and Invariants

ユーザー要望として、次の条件は維持したい。

- 最終表示形式は現在の `::: citation {"locator":...}` block を維持する。
- ユーザーに追加操作を要求しない。
- `{{pdf_citation:1}}` のような placeholder を LLM 出力へ導入しない。
- citation 相当の出力が発生したら、その locator の実 `rawText` を後続 LLM context に入れたい。
- citation 作成の authoring protocol は tool call でよいが、display protocol は従来形式のままにしたい。
- tool call の引数は、正規化済み markdown や tool result だけに潰さず、invocation/log として保持したい。
- 可能なら provider 差異、streaming、tool loop の途中応答に耐える設計にしたい。

### Current Implementation Observations

`src/modules/llm/chat.ts` は `invokeWithPdfCitationTools()` で LangChain tool loop を回す。tool call が返ると、`workingMessages` に assistant response と `ToolMessage` を積み、次の `invoke()` に渡す。したがって、同一 tool loop 内では tool call と tool result は LLM context に残る。

最終応答は、最後の `AIMessage` から `extractText(response)` で text だけを抽出し、`normalizePdfCitationBlocks()` に渡す。ここで正規化対象になるのは、LLM が text として書いた `::: citation` block であり、tool call ログ自体ではない。

`src/modules/llm/langChainMessages.ts` の `createAssistantStoredMessage()` は、保存用 `AIMessage` の `content` を `args.responseText` に置き換える。一方で `response.tool_calls` は別 field として保存する。この保存形では、本文中のどこで tool call が発生したかは保持されない。

`src/modules/pdfCitation.ts` は `find_pdf_text` と `read_pdf_text_range` tools を提供し、`normalizePdfCitationBlocks()` が text 内の `::: citation` block を探す。現状では tool call record を citation block へ変換する責務は持っていない。

### Tool Call Position Problem

tool calling では、tool call と tool result は通常 UI に直接表示されない。plugin が表示しなければ、ユーザーに見えるのは最後の assistant text だけである。このため、citation 専用 tool を追加し、その tool call を表示用 citation block の正本にすること自体は可能である。

ただし、標準化後の `AIMessage.tool_calls` は本文中の位置を表さない。概念的には次の raw sequence があっても、

```text
text A
tool_call create_pdf_citation(locator 1)
text B
tool_call create_pdf_citation(locator 2)
text C
```

`AIMessage.tool_calls` だけを見ると次の情報しか残らない。

```text
content: text A + text B + text C
tool_calls: [locator 1, locator 2]
```

この状態では、locator 1 を `text A` の後に置くべきか、`text B` の後に置くべきかを復元できない。

### Provider Ordering Notes

Anthropic は LangChain converter が `content` array 内に `tool_use` block を保持し、stream では `index` を持つため、相対順序を復元しやすい。

Gemini は raw response の `candidate.content.parts` に `text` と `functionCall` が順序付きで入る。LangChain の Gemini converter も複数 part の場合は `content` array へ変換するが、`AIMessage.tool_calls` だけを見ると位置情報は失われる。

OpenAI Responses は raw `response.output` が順序を持つ。ただし LangChain の `convertResponsesMessageToAIMessage()` は `message` content と `function_call` を分け、tool call を `tool_calls` 配列に集約する。`response_metadata.output` に raw output が残る場合は、位置復元にはそこを見る必要がある。

`contentBlocks` は provider 横断の安全な正本ではない。LangChain の標準 translator には、text block を先に出して tool calls を末尾へ追加する実装があるため、相対順序が壊れる可能性がある。

### Attempts and Failure Modes

| 案 | 狙い | 失敗理由 / 残る問題 |
| --- | --- | --- |
| Prompt-only locator discipline | `read_pdf_text_range` を必ず使うよう system prompt で強める | LLM は tool 使用指示を必ず守らない。locator を LLM が作る構造は残る。 |
| Citation render prompt hardening | citation render 側で `rawText` にない内容を補わないよう制約する | 表示用説明の過剰補完は抑えられるが、locator の `start` / `end` 自体は直らない。 |
| Hidden continuation / segmented generation | `::: citation` 出力後に app が生成を止め、`rawText` を追加して続きを生成する | 会話履歴としては続くが、乱数状態、KV cache、未出力候補、非公開 reasoning は連続しない。自然な生成途中の割り込みではない。 |
| Cancel marker after emitted citation | citation 後に `rawText` を見せ、必要なら直前 citation を取り消す | hidden continuation と同じ断絶を持つ。取り消し protocol も複雑になる。 |
| Placeholder insertion | `{{pdf_citation:1}}` などを本文に置かせ、plugin が展開する | ユーザーが placeholder 導入を望んでいない。表示形式以外の出力契約が増える。 |
| Completed citation block returned by tool | tool が完成済み `::: citation` block を返し、LLM が貼る | LLM が貼り間違える余地が残る。invocation/log を正本にしたい要望より弱い。 |
| `create_pdf_citation(locator)` tool call | citation したい位置で tool を呼ばせ、tool call log を citation block に変換する | citation の表示位置問題は改善するが、locator argument を LLM が作るなら locator 精度問題は残る。 |
| Quote / match based citation tool | LLM は locator ではなく quote を渡し、plugin が exact range を検索する | locator の数値生成は避けられるが、どの quote がどの主張を支えるかは LLM が選ぶ。曖昧一致、重複出現、短すぎる quote の問題もある。 |
| Claim-evidence JSON planning | LLM に主張と根拠候補の対応を構造化させる | 構造化しても、対応づけ自体が LLM 判断なら幻覚や過剰対応は残る。 |
| Evidence-card provenance | retrieval / extraction が exact locator 付き evidence card を先に作り、LLM はその card だけで回答する | LLM に自由な citation 範囲を選ばせない点は新しいが、citation 粒度が粗くなり得る。retrieval 品質が回答範囲を制約する。 |

### Current Reframing

これまでの案は、多くが「LLM が citation したいと判断した後で、どうやって citation block を安全に出すか」を扱っていた。しかし根本問題は、LLM が根拠範囲を自由に作る点にある。

発想転換として、citation を LLM output から生成するのではなく、LLM input の provenance として扱う。具体的には次の流れである。

1. PDF retrieval / extraction pipeline が、回答生成前に exact locator 付き evidence card を作る。
2. evidence card には `evidenceId`, `locator`, `rawText`, `before`, `after`, `sourcePdf`, `page`, `confidence`, `retrievalReason` などを持たせる。
3. LLM には evidence card の範囲内だけで回答させる。
4. LLM が citation locator を作るのではなく、回答単位、段落単位、または sentence 単位に使った evidence card ID を選ばせる。
5. plugin は selected evidence card ID から既知の exact locator を引き、最終表示だけを `::: citation {"locator":...}` に変換する。

この方式では、LLM が数値 locator を作らない。citation は「生成後に LLM が書いた Markdown」ではなく、「回答生成に与えた evidence の provenance」になる。

ただし、この方式も完全ではない。LLM が evidence card の内容を過剰一般化する可能性は残る。また、retrieval が必要な evidence を拾えなければ回答できない。さらに、sentence-level に厳密な citation を付けたい場合は、LLM が sentence と evidence card の対応を選ぶ必要があり、そこにはまだ LLM 判断が残る。

重要な違いは、失敗時の性質である。従来方式は locator そのものが壊れる。evidence-card provenance 方式では locator は plugin が保持する exact value なので、壊れるのは「どの evidence を使ったと主張するか」の対応づけである。これは検証・制約・UI 表示で扱いやすい。

### Candidate Architectures for Review

**1. Tool-call-position pipeline**

LLM が `create_pdf_citation(locator)` を呼び、plugin が ordered transcript から text と citation tool call の順序を復元して `::: citation` block を生成する。

利点は、現在の `::: citation` 手書きや completed block 貼り付けをやめられること。`rawText` を tool result として後続 context に入れやすいこと。

弱点は、locator を LLM が作る限り根本精度が直らないこと。さらに provider raw ordered blocks を扱う必要があり、実装が複雑になる。

**2. Quote / match locator-computation pipeline**

LLM は locator ではなく引用したい exact quote または surrounding text を渡し、plugin が PDF text 上で検索して locator を確定する。

利点は、数値 offset を LLM に作らせないこと。tool call position pipeline と組み合わせれば表示位置も扱える。

弱点は、quote 選択が LLM 依存であること。PDF text normalization、重複出現、短い quote、OCR ゆらぎ、改行や hyphenation の扱いが難しい。

**3. Evidence-card provenance pipeline**

回答生成前に exact locator 付き evidence card を作り、LLM は evidence card から回答する。最終 citation は selected evidence card ID から plugin が付与する。

利点は、LLM に locator を作らせないこと。tool call position 復元、placeholder、completed block paste の問題から離れられること。citation の正本が input evidence になり、監査しやすいこと。

弱点は、retrieval / extraction の設計品質に依存すること。細かい sentence-level citation を求める場合、LLM に evidence ID 対応を選ばせる余地が残ること。

### Questions for External Review

ChatGPT Pro など外部モデルに読ませる場合、次を重点的に見てほしい。

1. この問題設定では、`create_pdf_citation(locator)` tool call を実装する価値はまだあるか。それとも locator 問題を解かないため後回しにすべきか。
2. LLM に locator を作らせない最小 architecture は何か。quote/match 方式で十分か、evidence-card provenance 方式まで進むべきか。
3. 既存 UI の `::: citation {"locator":...}` 表示形式を維持しながら、内部 authoring protocol を evidence provenance に変える設計は妥当か。
4. answer text と evidence card の対応づけをどこまで LLM に任せてよいか。paragraph-level、sentence-level、claim-level のどれが現実的か。
5. retrieval が拾った evidence 以外について LLM が答えようとする場合、拒否・追加検索・低信頼表示のどれがよいか。
6. provider 差異を吸収するために ordered transcript を整備する価値は、evidence-card provenance 方式でも残るか。
7. 実装するなら、既存 `find_pdf_text` / `read_pdf_text_range` / `normalizePdfCitationBlocks()` をどう段階的に移行するのが安全か。

### Referenced File Hashes

次の hash は、この文書が最初に参照した実装 snapshot を示す。現在の repository state と一致するとは限らないため、外部レビューでは構造理解の補助として扱う。

- `package.json`: `sha256:ede04188c77f9912caea8b0c0362acb6a140eef1e771b345252952d9264627e3`
- `src/modules/llm/chat.ts`: `sha256:2976c924a22d0a552e6645ef4e1dc8dff004f350162d4c8b5d59ef2d8dab2b77`
- `src/modules/llm/chatProviderAdapters.ts`: `sha256:52cd86dd75955ea36ec89f41d07535e5d5f3327ca307e1ee1d172e79a87f096b`
- `src/modules/llm/langChainMessages.ts`: `sha256:03dba022262e274bc286d3b83c47bbe1f96a3b7e0382e72aed00f0dee4e7624b`
- `src/modules/pdfCitation.ts`: `sha256:bdde77e372c70c36f37ec43a775457d2d314712450dfb6d19a3e1e7a0cf612b3`

## References
