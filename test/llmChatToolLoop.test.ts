import { expect } from "chai";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { invokeWithPdfCitationTools } from "../src/modules/llm/chat";

describe("PDF citation tool loop", function () {
  before(function () {
    (globalThis as any).Zotero ||= {
      debug: () => undefined,
      log: () => undefined,
      logError: () => undefined,
    };
  });

  it("asks for a final answer without tools after the max tool rounds", async function () {
    let boundInvokeCount = 0;
    let directInvokeCount = 0;
    let finalMessages: BaseMessage[] = [];
    let finalOptions: Record<string, unknown> = {};

    const chatModel = {
      bindTools: () => ({
        invoke: async () => {
          boundInvokeCount++;
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "read_pdf_text_range",
                args: { libraryID: 1, attachmentKey: "ATTACH1" },
                id: `call_${boundInvokeCount}`,
                type: "tool_call",
              },
            ],
          } as any);
        },
      }),
      invoke: async (
        messages: BaseMessage[],
        options: Record<string, unknown>,
      ) => {
        directInvokeCount++;
        finalMessages = messages;
        finalOptions = options;
        return new AIMessage({
          content:
            'Final answer.\n::: citation {"rangeId":"r_7k9p2x4q"}\n:::\n',
        });
      },
    };

    const { response, localToolCallCount, pdfCitationToolCalls } =
      await invokeWithPdfCitationTools(
        chatModel,
        [new HumanMessage("question")],
        { tools: [{ native: true }], temperature: 0 },
        [
          {
            name: "read_pdf_text_range",
            invoke: async () =>
              JSON.stringify({
                rangeId: "r_7k9p2x4q",
                start: 1,
                end: 12,
                text: "short text",
                before: "before",
                after: "after",
                textVersion: `sha256:${"c".repeat(64)}`,
              }),
          },
        ],
        [{ native: true }],
      );

    expect(boundInvokeCount).to.equal(8);
    expect(directInvokeCount).to.equal(1);
    expect(localToolCallCount).to.equal(8);
    expect(pdfCitationToolCalls).to.have.length(8);
    expect(pdfCitationToolCalls[0]).to.deep.include({
      round: 1,
      toolName: "read_pdf_text_range",
      status: "success",
    });
    expect(pdfCitationToolCalls[0].argsSummary).to.deep.include({
      libraryID: 1,
      attachmentKey: "ATTACH1",
    });
    expect(pdfCitationToolCalls[0].resultSummary).to.deep.include({
      rangeId: "r_7k9p2x4q",
      start: 1,
      end: 12,
      textLength: "short text".length,
      textPreview: "short text",
      beforeLength: "before".length,
      afterLength: "after".length,
      textVersion: "sha256:cccccccccccc",
    });
    expect(response.content).to.contain("Final answer");
    expect(finalOptions).to.deep.equal({ temperature: 0 });
    expect(finalMessages.at(-1)?.content).to.contain(
      "Do not call any more tools.",
    );
  });
});
