import { expect } from "chai";
import { AIMessage } from "@langchain/core/messages";
import {
  ASK_MY_PAPER_MESSAGE_METADATA_KEY,
  createAssistantStoredMessage,
  getMessageText,
  toLangChainMessagesForLlmContext,
} from "../src/modules/llm/langChainMessages";

describe("LLM history PDF citation adapter", function () {
  it("stores PDF citation tool call trace in assistant message metadata", function () {
    const stored = createAssistantStoredMessage(
      new AIMessage({ content: "Answer" }),
      {
        provider: "gemini",
        model: "gemini-test",
        responseText: "Answer",
        thoughts: [],
        citations: [],
        diagnostics: {
          searchRequested: false,
          searchUsed: false,
          thinkingRequested: false,
          thinkingUsed: false,
          thoughtCount: 0,
          pdfCitationToolCallCount: 1,
          pdfCitationToolCalls: [
            {
              round: 1,
              toolName: "find_pdf_text",
              argsSummary: {
                libraryID: 1,
                attachmentKey: "ATTACH1",
                queryPreview: "fixed point theorem",
              },
              status: "success",
              resultSummary: {
                matchCount: 2,
                firstMatch: {
                  start: 10,
                  end: 29,
                  textPreview: "fixed point theorem",
                },
              },
            },
          ],
        },
      },
    );

    const metadata = (stored.data.response_metadata as any)[
      ASK_MY_PAPER_MESSAGE_METADATA_KEY
    ];
    expect(metadata.llmDiagnostics.pdfCitationToolCalls).to.deep.equal([
      {
        round: 1,
        toolName: "find_pdf_text",
        argsSummary: {
          libraryID: 1,
          attachmentKey: "ATTACH1",
          queryPreview: "fixed point theorem",
        },
        status: "success",
        resultSummary: {
          matchCount: 2,
          firstMatch: {
            start: 10,
            end: 29,
            textPreview: "fixed point theorem",
          },
        },
      },
    ]);
  });

  it("converts saved assistant tool-call messages to text-only AI messages", async function () {
    const stored = new AIMessage({
      content: "No response.",
      additional_kwargs: {
        function_call: { name: "read_pdf_text_range", arguments: "{}" },
        __openai_function_call_ids__: {
          call_1: "fc_1",
        },
      },
      tool_calls: [
        {
          name: "read_pdf_text_range",
          args: { libraryID: 1, attachmentKey: "ATTACH1" },
          id: "call_1",
          type: "tool_call",
        },
      ],
      invalid_tool_calls: [
        {
          name: "read_pdf_text_range",
          args: "{}",
          id: "bad_call_1",
          error: "bad args",
          type: "invalid_tool_call",
        },
      ],
    } as any).toDict();

    const result = await toLangChainMessagesForLlmContext([stored]);
    const message = result.messages[0] as any;

    expect(getMessageText(message)).to.equal("No response.");
    expect(message.tool_calls || []).to.deep.equal([]);
    expect(message.invalid_tool_calls || []).to.deep.equal([]);
    expect(message.additional_kwargs || {}).to.not.have.property(
      "function_call",
    );
    expect(message.additional_kwargs || {}).to.not.have.property(
      "__openai_function_call_ids__",
    );
  });

  it("replaces saved locator blocks with Previous PDF evidence context", async function () {
    const stored = new AIMessage({
      content:
        'Answer.\n::: citation {"locator":{"libraryID":1,"attachmentKey":"ATTACH1","textVersion":"sha256:test","start":10,"end":42}}\nDisplay text\n:::\nNext.',
    }).toDict();

    const result = await toLangChainMessagesForLlmContext([stored], {
      recoverPdfEvidenceText: async () => ({
        text: "raw evidence recovered from Zotero attachmentText",
      }),
      formatPdfEvidenceSource: () => "paper.pdf",
    });

    const messageText = getMessageText(result.messages[0]);
    expect(messageText).to.contain("[Previous PDF evidence: e_1]");
    expect(messageText).to.not.contain('"locator"');
    expect(messageText).to.not.contain('"start"');
    expect(result.previousPdfEvidenceContext).to.contain(
      "Previous PDF evidence:",
    );
    expect(result.previousPdfEvidenceContext).to.contain("evidenceId: e_1");
    expect(result.previousPdfEvidenceContext).to.contain("source: paper.pdf");
    expect(result.previousPdfEvidenceContext).to.contain(
      "raw evidence recovered from Zotero attachmentText",
    );
    expect(result.previousPdfEvidenceContext).to.not.contain('"locator"');
    expect(result.previousPdfEvidenceContext).to.not.contain('"start"');
    expect(result.previousPdfEvidenceContext).to.not.contain("ATTACH1");
  });
});
