import { expect } from "chai";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  invokeWithPdfCitationTools,
  renderPdfCitationDisplayTextForNormalization,
  scopePdfCitationTools,
} from "../src/modules/llm/chat";
import {
  normalizePdfCitationBlocks,
  PdfCitationRangeRegistry,
} from "../src/modules/pdfCitation";
import { createAssistantStoredMessage } from "../src/modules/llm/langChainMessages";

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
    const toolChoices: unknown[] = [];

    const chatModel = {
      bindTools: (_tools: unknown[], options: Record<string, unknown>) => ({
        invoke: async () => {
          toolChoices.push(options.tool_choice);
          boundInvokeCount++;
          const isSearchRound = boundInvokeCount === 1;
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                name: isSearchRound ? "find_pdf_text" : "register_pdf_quote",
                args: isSearchRound
                  ? {
                      libraryID: 1,
                      attachmentKey: "ATTACH1",
                      query: "short text",
                    }
                  : {
                      libraryID: 1,
                      attachmentKey: "ATTACH1",
                      textVersion: `sha256:${"c".repeat(64)}`,
                      quote: "short text",
                    },
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
            name: "find_pdf_text",
            invoke: async () =>
              JSON.stringify({
                textVersion: `sha256:${"c".repeat(64)}`,
                matches: [{ sourceText: "short text" }],
              }),
          },
          {
            name: "register_pdf_quote",
            invoke: async () =>
              JSON.stringify({
                rangeId: "r_7k9p2x4q",
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
    expect(toolChoices).to.deep.equal([
      "find_pdf_text",
      "auto",
      "auto",
      "auto",
      "auto",
      "auto",
      "auto",
      "auto",
    ]);
    expect(directInvokeCount).to.equal(1);
    expect(localToolCallCount).to.equal(8);
    expect(pdfCitationToolCalls).to.have.length(8);
    expect(pdfCitationToolCalls[0]).to.deep.include({
      round: 1,
      toolName: "find_pdf_text",
      status: "success",
    });
    expect(pdfCitationToolCalls[0].argsSummary).to.deep.include({
      libraryID: 1,
      attachmentKey: "ATTACH1",
      queryLength: "short text".length,
    });
    expect(pdfCitationToolCalls[0].resultSummary).to.deep.include({
      matchCount: 1,
      textVersion: "sha256:cccccccccccc",
    });
    expect(pdfCitationToolCalls[1]).to.deep.include({
      round: 2,
      toolName: "register_pdf_quote",
      status: "success",
    });
    expect(pdfCitationToolCalls[1].resultSummary).to.deep.include({
      rangeId: "r_7k9p2x4q",
      textLength: "short text".length,
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

  it("rejects citation tool access outside the request attachment allowlist", async function () {
    const invokedArgs: unknown[] = [];
    const [tool] = scopePdfCitationTools(
      [
        {
          name: "find_pdf_text",
          invoke: async (args) => {
            invokedArgs.push(args);
            return "ok";
          },
        },
      ],
      [
        {
          libraryID: 1,
          zoteroAttachmentKey: "ATTACH1",
          fileName: "paper.pdf",
          uploads: [],
        },
      ],
    );

    let rejection: unknown;
    try {
      await tool.invoke({
        libraryID: 1,
        attachmentKey: "OTHER",
        query: "text",
      });
    } catch (error) {
      rejection = error;
    }
    expect(String(rejection)).to.contain(
      "PDF citation attachment is not available",
    );
    expect(invokedArgs).to.deep.equal([]);

    expect(
      await tool.invoke({
        libraryID: 1,
        attachmentKey: "ATTACH1",
        query: "text",
      }),
    ).to.equal("ok");
    expect(invokedArgs).to.have.length(1);
  });

  it("redacts SDK errors from citation rendering and local tool diagnostics", async function () {
    const sentinel = "SDK_SECRET_DO_NOT_PERSIST";
    const logMessages: string[] = [];
    (globalThis as any).Zotero.logError = (error: Error) => {
      logMessages.push(error.message);
    };

    const registry = new PdfCitationRangeRegistry();
    const entry = registry.register({
      locator: {
        libraryID: 1,
        attachmentKey: "ATTACH1",
        start: 0,
        end: 8,
      },
      text: "evidence",
      before: "",
      after: "",
      textVersion: "sha256:test",
    });
    const normalized = await normalizePdfCitationBlocks(
      `::: citation {"rangeId":"${entry.rangeId}"}\n:::`,
      {
        rangeRegistry: registry,
        pdfFiles: [
          {
            libraryID: 1,
            zoteroAttachmentKey: "ATTACH1",
            fileName: "paper.pdf",
            uploads: [],
          },
        ],
        getCurrentTextVersion: async () => "sha256:test",
        renderDisplayText: (input) =>
          renderPdfCitationDisplayTextForNormalization(input, async () => {
            throw new Error(sentinel);
          }),
      },
    );

    expect(normalized.warnings).to.deep.equal([
      "PDF citation display rendering failed. The citation was removed.",
    ]);
    expect(JSON.stringify(normalized)).to.not.contain(sentinel);
    expect(logMessages.join("\n")).to.not.contain(sentinel);
    const stored = createAssistantStoredMessage(
      new AIMessage({ content: normalized.text }),
      {
        provider: "gemini",
        model: "gemini-test",
        responseText: normalized.text,
        thoughts: [],
        citations: [],
        diagnostics: {
          searchRequested: false,
          searchUsed: false,
          thinkingRequested: false,
          thinkingUsed: false,
          thoughtCount: 0,
          pdfCitationWarnings: normalized.warnings,
        },
      },
    );
    expect(JSON.stringify(stored)).to.not.contain(sentinel);

    let boundInvokeCount = 0;
    let toolMessageText = "";
    const chatModel = {
      bindTools: () => ({
        invoke: async (messages: BaseMessage[]) => {
          boundInvokeCount++;
          if (boundInvokeCount === 2) {
            toolMessageText = String(messages.at(-1)?.content || "");
            return new AIMessage({ content: "Final answer." });
          }
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "find_pdf_text",
                args: { libraryID: 1, attachmentKey: "ATTACH1", query: "text" },
                id: "call_redaction",
                type: "tool_call",
              },
            ],
          } as any);
        },
      }),
      invoke: async () => new AIMessage({ content: "Final answer." }),
    };
    const { pdfCitationToolCalls } = await invokeWithPdfCitationTools(
      chatModel,
      [new HumanMessage("question")],
      {},
      [
        {
          name: "find_pdf_text",
          invoke: async () => {
            throw new Error(sentinel);
          },
        },
      ],
      [],
    );

    expect(toolMessageText).to.equal(
      "PDF citation tool request could not be completed. Check the current PDF citation context and retry.",
    );
    expect(JSON.stringify(pdfCitationToolCalls)).to.not.contain(sentinel);
    expect(logMessages.join("\n")).to.not.contain(sentinel);
  });
});
