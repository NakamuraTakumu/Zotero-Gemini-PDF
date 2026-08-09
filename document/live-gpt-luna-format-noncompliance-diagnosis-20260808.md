---
title: "Live gpt-5.6-luna Citation-Format Noncompliance Diagnosis"
responsibility: "Diagnose the displayed gpt-5.6-luna citation-format failure and implement the approved single-grammar default prompt while preserving the citation tool and display-render contracts."
created: "2026-08-08 11:09 UTC"
updated: "2026-08-08 11:21 UTC"
workspace: "/home/nakamura/gemini-pdf"
related_commit: "none"
model: "gpt-5.6-terra"
reasoning_effort: "high"
session: "019fe0c4-2fcc-7a11-ba1a-0141efd60492"
handling: "document-workflow"
workflow_stage: "completed"
stale: false
summary: "The gpt-5.6-luna failure came from an ambiguous response grammar; the default prompt now defines a conclusion followed only by complete +++ evidence units, with a matching visible example and contract test."
---

# Live gpt-5.6-luna Citation-Format Noncompliance Diagnosis

## Background

The user reported that the live Ask My Paper UI had resumed producing a response that appeared to violate the required citation format after a restart, and asked for the cause to be investigated. The initial investigation was read-only: it examined the current Xpra/Zotero UI, the latest persisted request/result record, and the active source/default-prompt path. After the diagnosis was accepted, the user authorized implementation of a single visible response grammar in the default system prompt. No provider API call or server restart is part of this implementation.

The target workspace is `/home/nakamura/gemini-pdf` (Git repository root). The live UI was inspected in Xpra session `:100` at the configured Tailscale endpoint. The screenshots captured during this investigation are outside the workspace at `/tmp/zotero-live-luna-format-20260808.png` and `/tmp/zotero-live-luna-format-details-expanded-20260808.png`.

## Answer

The live response is from **OpenAI / `gpt-5.6-luna`**, not the earlier `gpt-5.4-mini` model. It partially adopts the revised default prompt: it emits `STEP 1` and valid `+++`/`::: citation {"rangeId":...}` blocks. The primary failure is model-level structural noncompliance: after `STEP 1`, it produces ordinary numbered sections containing many uncited factual claims instead of repeatedly emitting the specified evidence blocks. No visible `STEP 2: Grounds and Commentary (Repeat)` label appears.

The citation pipeline and renderer are working for the citations that the model did emit. Three successful raw range citations were normalized to canonical PDF locators, none was dropped, and the UI renders the first one as a collapsible detail block. The pipeline preserves, rather than causes, the model's missing coverage and extra prose.

The revised default prompt was loaded for this request with strong behavioral evidence, but the exact runtime preference string could not be read directly. The response contains the distinctive new `STEP 1` and `+++` evidence-block constructs; the request was made after the restart; the request builder reads the system-prompt preference per send; and no persisted user override for that preference was found. Its STEP explanation and example nevertheless left the visible grammar ambiguous, which explains why `gpt-5.6-luna` could appear to comply while still failing the intended all-claims-in-blocks format.

The approved implementation replaces that competing STEP/natural-Markdown framing with one visible grammar: a concise Japanese conclusion followed by zero or more complete `+++` evidence units. The grammar terms themselves are not printed. An evidence unit owns its claim, empty `rangeId` citation block, and commentary, so there is no separate ordinary explanatory body. The current-turn `rangeId` contract and the Japanese Citation Render transformation remain unchanged.

## Body

- [1. Live UI and latest saved-message evidence](#1-live-ui-and-latest-saved-message-evidence)
- [2. Exact deviations from the requested output contract](#2-exact-deviations-from-the-requested-output-contract)
- [3. Citation-tool normalization and UI-rendering result](#3-citation-tool-normalization-and-ui-rendering-result)
- [4. Runtime-prompt uptake and competing causes](#4-runtime-prompt-uptake-and-competing-causes)
- [5. Cause classification and bounded follow-up](#5-cause-classification-and-bounded-follow-up)
- [6. Implemented single response grammar](#6-implemented-single-response-grammar)

### 1. Live UI and latest saved-message evidence

The current Xpra screenshot shows the Ask My Paper panel with Provider `OpenAI` and Model `gpt-5.6-luna`. The visible answer starts with `STEP 1: 結論`, then presents a Japanese conclusion and bullet list. Directly below it, `Para の基本的な意味` is rendered as a collapsed `+++` details block; this is positive evidence that the UI recognizes the generated evidence-block syntax. The screenshot also visibly continues with the ordinary heading `1. 射は「パラメータ付き関数」`, rather than a visible STEP 2 heading or a repeated sequence of details-only blocks.

The latest persisted chat session is record 71 in `.scaffold/data/storage/4BJH3L5B/hGWXqgGM-ask_my_paper_data_PL72N49G.json`. Its request timestamp is `2026-08-08T11:04:07.107Z`; it contains only the user message `*Regarding the question: "Para"*` and this assistant message, so prior chat history did not supply an older output contract. The assistant metadata identifies `provider: openai` and `model: gpt-5.6-luna`.

The stored raw final output begins with `## STEP 1: 結論` and then uses a valid block with `+++ Para の基本的な意味`, a standalone `::: citation {"rangeId":"r_2h4w9wss"}`, `:::`, commentary, and a standalone closing `+++`. It later emits ordinary `## 1` through `## 5` sections. Two more valid `+++` citation blocks occur among those sections, all using the same registered range ID. The raw response contains no `STEP 2` heading.

### 2. Exact deviations from the requested output contract

The intended format separates a concise, reader-facing STEP 1 conclusion from repeated STEP 2 evidence blocks, each consisting of one supported claim, an empty range-ID citation block, and commentary. The latest output satisfies the syntax of the three citation blocks it has, but does not satisfy the intended response-level contract:

- It does not emit the named `STEP 2: Grounds and Commentary (Repeat)` section at all.
- It emits five ordinary explanatory sections after STEP 1. Those sections contain definitions, equations, composition statements, and claims about learning, gradient descent, and backpropagation outside the required evidence blocks.
- Only three citation blocks are present, so the many important claims in the five sections are not covered by one claim-and-citation evidence unit each.
- The same range ID is used for all three citation blocks. The prompt permits only successfully registered current-turn IDs but does not expressly require a distinct range per block. Reuse is therefore weak evidence of semantic mismatch, not a literal syntax breach.

Conversely, the raw citation syntax is compliant: every `::: citation` starts at the beginning of its own line and is contained within a `+++` block. The apparent citation-placement oddity—commentary follows the empty citation container rather than preceding it—is exactly the supplied block template. It is not a parser or renderer failure.

### 3. Citation-tool normalization and UI-rendering result

The latest assistant metadata records six PDF citation-tool calls. Three `find_pdf_text` calls succeeded. Registration first had two recoverable failures, then one successful `register_pdf_quote` call produced `r_2h4w9wss`; the model reused that one successful ID. The tool trace contains no additional successful range ID for the later prose.

Normalization converted all three raw range-ID blocks to canonical locator blocks. Metadata records `pdfCitationCount: 3`, `pdfCitationDroppedCount: 0`, and no citation warnings. The citation display renderer completed using the configured Gemini renderer and returned Japanese display text for each locator. Thus no citation is missing because of a normalizer rejection, lost registry entry, renderer exception, or malformed marker.

The UI path is likewise functioning for the structured parts. The screenshot shows the first `+++` section rendered as a collapsible detail panel. The normalizer and UI are intentionally structural: they resolve a valid registered ID and render the corresponding container, but they do not assess whether every surrounding statement is supported or whether the model obeyed the complete STEP 2 coverage rule. The renderer therefore faithfully preserves the model's partial compliance.

### 4. Runtime-prompt uptake and competing causes

The actual default prompt in `addon/prefs.js` introduces the distinct requirements that citations belong in STEP 2 evidence blocks, STEP 1 is their reader-facing conclusion, and the model should repeat an explanation block for each important point. The active request builder obtains `PREF_SYSTEM_PROMPT` at send time and places it in the system message. The latest session began after the restarted server and contains the exact new prompt signatures: the visible `STEP 1` label and three `+++` evidence blocks. These are strong behavioral evidence that the revised default prompt was active for this request.

An exact dump of the live preference value was not available through the inspected persistence files, so this is not direct byte-for-byte proof of the runtime string. However, no persisted user override for the system-prompt preference was found, and the code path has no migration that replaces the system prompt. The remaining possibility of an unseen override is lower confidence than the direct output signatures.

The prompt itself permits the observed shape through several competing signals:

- `## STEP 1` and `## STEP 2` are Markdown headings inside the _system-prompt instructions_, immediately after “Construct the response using the following steps.” Neither step says “print this heading literally in the final answer.” STEP 1 only says to state the answer at the beginning; STEP 2 says to repeat a block for each important point. Hence the literal `STEP 2` label is an intended design convention, but not an unambiguous final-output requirement.
- The simultaneously retained instruction to “write the answer as natural Markdown” competes with the new step structure. It leaves ordinary `##` headings, explanatory prose, lists, and equations as apparently valid response syntax. The model resolves that conflict by treating the STEP structure as an outline and then using conventional Markdown sections for the detailed explanation.
- The visible example is stronger demonstration than the prose: it has no printed STEP 1 or STEP 2 labels, gives a plain conclusion, and follows it with one `+++` block. This teaches “conclusion plus optional evidence detail” rather than an exclusive two-section grammar with total claim coverage.
- The new prompt moved citations away from the old, direct “next to the claim it supports” rule into STEP 2 blocks. It did not add a prohibition on claims outside STEP 2 or a check that each ordinary section is represented by a block. This weakens the old local adjacency rule while failing to establish a hard global containment rule.
- The phrase “for each important point” delegates scope to the model. The terse question `Para` is open-ended, so the model expands it into several natural teaching topics (definition, morphisms, composition, categorical role, monoidal structure, and neural-network connection). Once it has chosen that multi-topic answer plan, the prompt provides no mandatory mapping from each topic to a distinct complete block. Three registered snippets then become details attached to an otherwise conventional five-section answer.

The template also describes a claim/citation/commentary unit while placing the only explicit claim-like text after the citation, which can encourage the model to treat details blocks as optional side notes. It does not say that each claim must have a unique range ID or that the model must run a coverage check before answering.

### 5. Cause classification and bounded follow-up

The direct cause of the visible format failure is **model structural noncompliance enabled by an underspecified response grammar**. The model chooses general explanatory sections outside the repeated evidence units. The prompt was not absent: its new structural vocabulary is visibly reflected in the answer. The model simultaneously complies with the easy local grammar of individual citation blocks and fails the intended global coverage/sectioning rule.

Prompt ambiguity is a necessary contributing cause, not merely a secondary observation: neither the instruction heading nor the example makes the desired output grammar exclusive or objectively checkable, and it does not define range-ID reuse as invalid. Compared with the old prompt, the revision correctly introduces details blocks but changes a simple local “citation next to the claim” rule into a higher-level STEP-2 convention without establishing a matching hard boundary. The citation pipeline and renderer are not causal for this failure: their recorded outcome is three successful normalizations and visible details rendering. They lack a semantic or coverage validator, so they cannot repair a response that contains valid local markers but invalid global structure.

The approved corrective direction is to define the visible output as a single grammar rather than attach additional guard rules. A concise conclusion is followed directly by zero or more complete `+++` evidence units; each unit owns one supported claim, its citation block, and its commentary. The grammar has no ordinary explanatory-body production, so it removes the competing Markdown-section surface instead of trying to detect or suppress it after generation.

### 6. Implemented single response grammar

`addon/prefs.js` now defines `FinalResponse ::= Conclusion EvidenceUnit*`. It describes `Conclusion` and `EvidenceUnit` as grammar terms rather than visible labels, and supplies a complete evidence-unit template in the required order: brief claim, explicit one-claim line, empty `::: citation {"rangeId":"..."}` block, commentary, and a standalone `+++` close. The grammar states that all visible response content is either the conclusion or an evidence unit; it does not leave a third ordinary explanatory body.

The tool-use visible answer is rewritten to follow that exact grammar, including the claim line before the range-ID citation. It no longer demonstrates STEP labels or conventional numbered Markdown sections. This aligns the prose definition, syntax template, and single visible example without changing the existing `register_pdf_quote` or Citation Render translation contracts.

`test/defaultPromptContracts.test.ts` verifies the grammar symbol, its one-surface definition, the evidence-unit ordering, and the structural properties of the visible example without copying its prose verbatim. The example assertion rejects the observed Luna shape of a free-form `## 1` body beside auxiliary details blocks. The test also retains the contract that the design is structural rather than based on at-most-one, self-check, retry, or other output-stage guards.

### Referenced File Hashes

- `addon/prefs.js`: `sha256:d5082edb94570de81818d921c9c398db694e5b661c71b39dda1cfd64c881b662`
- `node_modules/markdown-it-container/index.mjs`: `sha256:feb3d6b617707b4d0f49bc2cda740541875a8dbe74faed9c5b4bd5992ce5840c`
- `src/hooks.ts`: `sha256:32eddfcc804b7b72a006f7bbbd91b72680bd3cbb9531530ac1df4d4803dfa153`
- `src/modules/llm/chat.ts`: `sha256:658414f912f87918f99327466b7747b447c09dae88a78b968cdd9abebed0f635`
- `src/modules/pdfCitation.ts`: `sha256:83abf887a3fd5183f87963a03fbe18855c440f6afeef6a0fcc44fb8817be9822`
- `src/modules/reader/ui.ts`: `sha256:497ea6ab104c9e3d9577da2f814a032bf8b57407de73b4b1674891ddffc3d179`
- `src/utils/prefMigration.ts`: `sha256:c0ceb154eab070ceb27432949529972f2fa0ec1ab1b547b0518d03a5b8d3aa29`
- `test/defaultPromptContracts.test.ts`: `sha256:c8d4bb952f47277aa25ba1690ba4ce77a1f2ea9bd65132299b6c252e491b2e43`
