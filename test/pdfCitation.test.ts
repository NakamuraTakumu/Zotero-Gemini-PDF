import { expect } from "chai";
import {
  createPdfCitationTools,
  locateExactPdfQuote,
  PdfCitationRangeRegistry,
  recoverPdfCitationText,
  normalizePdfCitationBlocks,
  summarizePdfCitationToolCall,
} from "../src/modules/pdfCitation";

const pdfFile = {
  libraryID: 1,
  zoteroAttachmentKey: "ATTACH1",
  fileName: "paper.pdf",
  uploads: [],
};

describe("PDF citation rangeId normalization", function () {
  before(function () {
    (globalThis as any).Zotero ||= {
      debug: () => undefined,
      log: () => undefined,
      logError: () => undefined,
      Items: {},
    };
  });

  it("summarizes PDF citation tool calls without saving raw long text", function () {
    const trace = summarizePdfCitationToolCall({
      round: 2,
      toolName: "register_pdf_quote",
      args: {
        libraryID: 1,
        attachmentKey: "ATTACH1",
        textVersion: `sha256:${"a".repeat(64)}`,
        quote: `${"evidence ".repeat(80)}done`,
        sourceText: `${"context ".repeat(100)}end`,
      },
      status: "success",
      result: JSON.stringify({
        rangeId: "r_7k9p2x4q",
        textVersion: `sha256:${"a".repeat(64)}`,
        text: `${"evidence ".repeat(80)}done`,
        before: "before context",
        after: "after context",
      }),
    });

    expect(trace.round).to.equal(2);
    expect(trace.toolName).to.equal("register_pdf_quote");
    expect(trace.argsSummary).to.deep.include({
      libraryID: 1,
      attachmentKey: "ATTACH1",
      quoteLength: `${"evidence ".repeat(80)}done`.length,
      sourceTextLength: `${"context ".repeat(100)}end`.length,
    });
    expect(trace.resultSummary.rangeId).to.equal("r_7k9p2x4q");
    expect(trace.resultSummary.textVersion).to.equal("sha256:aaaaaaaaaaaa");
    expect(trace.resultSummary.textLength).to.equal(
      `${"evidence ".repeat(80)}done`.length,
    );
    expect(trace.argsSummary).to.not.have.property("quotePreview");
    expect(trace.argsSummary).to.not.have.property("sourceTextPreview");
    expect(trace.resultSummary).to.not.have.property("textPreview");
    expect(JSON.stringify(trace)).to.not.contain("done");
  });

  it("summarizes find_pdf_text matches without storing query or match text", function () {
    const trace = summarizePdfCitationToolCall({
      round: 1,
      toolName: "find_pdf_text",
      args: {
        libraryID: 1,
        attachmentKey: "ATTACH1",
        query: `${"query ".repeat(80)}needle`,
      },
      status: "success",
      result: {
        textVersion: `sha256:${"b".repeat(64)}`,
        matches: [
          {
            sourceText: `${"matched text ".repeat(40)}end`,
          },
        ],
      },
    });

    expect(trace.argsSummary.queryLength).to.equal(
      `${"query ".repeat(80)}needle`.length,
    );
    expect(trace.argsSummary).to.not.have.property("queryPreview");
    expect(trace.resultSummary).to.deep.include({
      textVersion: "sha256:bbbbbbbbbbbb",
      matchCount: 1,
    });
    expect((trace.resultSummary.firstMatch as any).sourceTextLength).to.equal(
      `${"matched text ".repeat(40)}end`.length,
    );
    expect(trace.resultSummary.firstMatch).to.not.have.property(
      "sourceTextPreview",
    );
    expect(JSON.stringify(trace)).to.not.contain("needle");
    expect(JSON.stringify(trace)).to.not.contain("matched text");
  });

  it("locates a quote that occurs once in the PDF text", function () {
    expect(
      locateExactPdfQuote(
        "First sentence. Exact supporting sentence. Last sentence.",
        "Exact supporting sentence.",
      ),
    ).to.deep.equal({ start: 16, end: 42 });
  });

  it("requires sourceText when a quote occurs multiple times", function () {
    expect(() =>
      locateExactPdfQuote(
        "Repeated sentence. Middle. Repeated sentence.",
        "Repeated sentence.",
      ),
    ).to.throw(
      "Quote occurs multiple times in the PDF text. Retry with the source text returned by find_pdf_text.",
    );
  });

  it("uses a unique sourceText to disambiguate a repeated quote", function () {
    const text =
      "First context. Repeated sentence. Middle. Second context. Repeated sentence. End.";
    expect(
      locateExactPdfQuote(
        text,
        "Repeated sentence.",
        "Second context. Repeated sentence. End.",
      ),
    ).to.deep.equal({
      start: text.lastIndexOf("Repeated sentence."),
      end: text.lastIndexOf("Repeated sentence.") + "Repeated sentence.".length,
    });
  });

  it("rejects sourceText that is not unique in the PDF text", function () {
    expect(() =>
      locateExactPdfQuote(
        "Same context. Quote. Same context. Quote.",
        "Quote.",
        "Same context. Quote.",
      ),
    ).to.throw(
      "Source text occurs multiple times in the PDF text. Use a longer source text.",
    );
  });

  it("requires an exact quote copied from sourceText", function () {
    expect(() =>
      locateExactPdfQuote(
        "Context. Exact quote. End.",
        "Edited quote.",
        "Context. Exact quote. End.",
      ),
    ).to.throw("Quote is not an exact substring of the supplied source text.");
  });

  it("finds sourceText without offsets and registers an exact quote", async function () {
    const quote = "Repeated evidence.";
    const attachmentText = [
      `First context. ${quote}`,
      "filler ".repeat(80),
      `Second context. ${quote} End.`,
    ].join(" ");
    (globalThis as any).Zotero.Items = {
      getByLibraryAndKeyAsync: async () => ({
        itemType: "attachment",
        attachmentText,
      }),
    };
    const rangeRegistry = new PdfCitationRangeRegistry();
    const tools = createPdfCitationTools({ rangeRegistry });
    const findTool = tools.find(
      (candidate: any) => candidate.name === "find_pdf_text",
    );
    const registerTool = tools.find(
      (candidate: any) => candidate.name === "register_pdf_quote",
    );
    const found = JSON.parse(
      await findTool!.invoke({
        libraryID: 1,
        attachmentKey: "ATTACH1",
        query: "Second context",
      }),
    );
    expect(found.matches).to.have.length(1);
    expect(found.matches[0]).to.have.all.keys("sourceText");
    expect(found.matches[0].sourceText).to.contain(quote);

    let staleVersionError: unknown;
    try {
      await registerTool!.invoke({
        libraryID: 1,
        attachmentKey: "ATTACH1",
        textVersion: `sha256:${"0".repeat(64)}`,
        quote,
      });
    } catch (error) {
      staleVersionError = error;
    }
    expect(String(staleVersionError)).to.contain(
      "PDF text changed after find_pdf_text",
    );

    let duplicateError: unknown;
    try {
      await registerTool!.invoke({
        libraryID: 1,
        attachmentKey: "ATTACH1",
        textVersion: found.textVersion,
        quote,
      });
    } catch (error) {
      duplicateError = error;
    }
    expect(String(duplicateError)).to.contain(
      "Quote occurs multiple times in the PDF text",
    );

    const registered = JSON.parse(
      await registerTool!.invoke({
        libraryID: 1,
        attachmentKey: "ATTACH1",
        textVersion: found.textVersion,
        quote,
        sourceText: found.matches[0].sourceText,
      }),
    );
    expect(registered.rangeId).to.match(
      /^r_[23456789abcdefghijkmnopqrstuvwxyz]{8}$/,
    );
    expect(registered.text).to.equal(quote);
    expect(registered).to.not.have.keys("start", "end");
  });

  it("resolves a rangeId to the saved canonical locator block", async function () {
    const registry = new PdfCitationRangeRegistry();
    const entry = registry.register({
      locator: {
        libraryID: 1,
        attachmentKey: "ATTACH1",
        start: 10,
        end: 42,
      },
      text: "registered evidence text",
      before: "before",
      after: "after",
      textVersion: "sha256:test",
    });
    expect(entry.rangeId).to.match(
      /^r_[23456789abcdefghijkmnopqrstuvwxyz]{8}$/,
    );
    expect(
      registry.register({
        locator: {
          libraryID: 1,
          attachmentKey: "ATTACH1",
          start: 43,
          end: 80,
        },
        text: "another registered evidence text",
        before: "",
        after: "",
        textVersion: "sha256:test",
      }).rangeId,
    ).to.not.equal(entry.rangeId);

    const result = await normalizePdfCitationBlocks(
      `Claim.\n::: citation {"rangeId":"${entry.rangeId}"}\n:::\n`,
      {
        rangeRegistry: registry,
        pdfFiles: [pdfFile],
        getCurrentTextVersion: async () => "sha256:test",
        renderDisplayText: async (input) => `Rendered: ${input.rawText}`,
      },
    );

    expect(result.normalizedCount).to.equal(1);
    expect(result.droppedCount).to.equal(0);
    expect(result.text).to.contain('"locator"');
    expect(result.text).to.contain('"textVersion":"sha256:test"');
    expect(result.text).to.not.contain('"rangeId"');
    expect(result.text).to.contain("Rendered: registered evidence text");
  });

  it("normalizes a rangeId block that starts after prose on the same line", async function () {
    const registry = new PdfCitationRangeRegistry();
    const entry = registry.register({
      locator: {
        libraryID: 1,
        attachmentKey: "ATTACH1",
        start: 10,
        end: 42,
      },
      text: "registered evidence text",
      before: "before",
      after: "after",
      textVersion: "sha256:test",
    });

    const result = await normalizePdfCitationBlocks(
      `Claim. ::: citation {"rangeId":"${entry.rangeId}"}\n:::\n`,
      {
        rangeRegistry: registry,
        pdfFiles: [pdfFile],
        getCurrentTextVersion: async () => "sha256:test",
        renderDisplayText: async (input) => `Rendered: ${input.rawText}`,
      },
    );

    expect(result.normalizedCount).to.equal(1);
    expect(result.droppedCount).to.equal(0);
    expect(result.text).to.contain('Claim. ::: citation {"locator"');
    expect(result.text).to.not.contain('"rangeId"');
    expect(result.text).to.contain("Rendered: registered evidence text");
  });

  it("drops an unknown rangeId", async function () {
    const result = await normalizePdfCitationBlocks(
      'Claim.\n::: citation {"rangeId":"r_missing"}\n:::\n',
      {
        rangeRegistry: new PdfCitationRangeRegistry(),
        pdfFiles: [pdfFile],
        getCurrentTextVersion: async () => "sha256:test",
      },
    );

    expect(result.normalizedCount).to.equal(0);
    expect(result.droppedCount).to.equal(1);
    expect(result.text).to.equal("Claim.\n");
    expect(result.warnings[0]).to.contain("Unknown PDF citation rangeId");
  });

  it("drops a legacy pipe citation from a new assistant response", async function () {
    const result = await normalizePdfCitationBlocks(
      "Claim.\n::: citation legacy source|unverified quote\n:::\n",
    );

    expect(result.normalizedCount).to.equal(0);
    expect(result.droppedCount).to.equal(1);
    expect(result.text).to.equal("Claim.\n");
    expect(result.warnings[0]).to.contain("Legacy PDF citation pipe block");
  });

  it("drops a legacy pipe citation whose source begins with an opening brace", async function () {
    const result = await normalizePdfCitationBlocks(
      "Claim.\n::: citation {legacy source|unverified quote\n:::\n",
    );

    expect(result.normalizedCount).to.equal(0);
    expect(result.droppedCount).to.equal(1);
    expect(result.text).to.equal("Claim.\n");
    expect(result.warnings[0]).to.contain("Legacy PDF citation pipe block");
  });

  it("leaves citation syntax inside fenced code blocks unchanged", async function () {
    const text = [
      "```markdown",
      '::: citation {"rangeId":"r_missing"}',
      ":::",
      "```",
    ].join("\n");

    const result = await normalizePdfCitationBlocks(text);

    expect(result.normalizedCount).to.equal(0);
    expect(result.droppedCount).to.equal(0);
    expect(result.text).to.equal(text);
  });

  it("drops direct locator citations without a textVersion", async function () {
    const result = await normalizePdfCitationBlocks(
      [
        "Claim.",
        '::: citation {"locator":{"libraryID":1,"attachmentKey":"ATTACH1","start":0,"end":5}}',
        ":::",
      ].join("\n"),
    );

    expect(result.normalizedCount).to.equal(0);
    expect(result.droppedCount).to.equal(1);
    expect(result.warnings[0]).to.contain("missing textVersion");
  });

  it("drops direct locator citations with invalid offsets", async function () {
    for (const locator of [
      { start: -1, end: 5 },
      { start: 5, end: 5 },
      { start: 6, end: 5 },
    ]) {
      const result = await normalizePdfCitationBlocks(
        [
          "Claim.",
          `::: citation ${JSON.stringify({
            locator: {
              libraryID: 1,
              attachmentKey: "ATTACH1",
              textVersion: "sha256:test",
              ...locator,
            },
          })}`,
          ":::",
        ].join("\n"),
      );

      expect(result.normalizedCount).to.equal(0);
      expect(result.droppedCount).to.equal(1);
      expect(result.warnings[0]).to.contain("Missing or invalid locator");
    }
  });

  it("drops an unclosed citation block instead of canonicalizing it", async function () {
    const registry = new PdfCitationRangeRegistry();
    const entry = registry.register({
      locator: {
        libraryID: 1,
        attachmentKey: "ATTACH1",
        start: 10,
        end: 42,
      },
      text: "registered evidence text",
      before: "",
      after: "",
      textVersion: "sha256:test",
    });
    const result = await normalizePdfCitationBlocks(
      `Claim.\n::: citation {"rangeId":"${entry.rangeId}"}\n`,
      {
        rangeRegistry: registry,
        pdfFiles: [pdfFile],
        getCurrentTextVersion: async () => "sha256:test",
      },
    );

    expect(result.normalizedCount).to.equal(0);
    expect(result.droppedCount).to.equal(1);
    expect(result.text).to.equal("Claim.\n");
    expect(result.warnings[0]).to.contain("missing its closing marker");
  });

  it("does not return current text at a stale citation locator", async function () {
    (globalThis as any).Zotero.Items = {
      getByLibraryAndKeyAsync: async () => ({
        itemType: "attachment",
        attachmentText: "Current PDF text at the old offsets.",
      }),
    };

    const recovered = await recoverPdfCitationText({
      libraryID: 1,
      attachmentKey: "ATTACH1",
      textVersion: `sha256:${"0".repeat(64)}`,
      start: 0,
      end: 7,
    });

    expect(recovered.isStale).to.equal(true);
    expect(recovered.text).to.equal("");
  });

  it("drops a stale rangeId", async function () {
    const registry = new PdfCitationRangeRegistry();
    const entry = registry.register({
      locator: {
        libraryID: 1,
        attachmentKey: "ATTACH1",
        start: 10,
        end: 42,
      },
      text: "registered evidence text",
      before: "",
      after: "",
      textVersion: "sha256:old",
    });

    const result = await normalizePdfCitationBlocks(
      `Claim.\n::: citation {"rangeId":"${entry.rangeId}"}\n:::\n`,
      {
        rangeRegistry: registry,
        pdfFiles: [pdfFile],
        getCurrentTextVersion: async () => "sha256:new",
      },
    );

    expect(result.normalizedCount).to.equal(0);
    expect(result.droppedCount).to.equal(1);
    expect(result.warnings[0]).to.contain("Stale PDF citation rangeId");
  });

  it("rejects empty registered ranges", function () {
    const registry = new PdfCitationRangeRegistry();

    expect(() =>
      registry.register({
        locator: {
          libraryID: 1,
          attachmentKey: "ATTACH1",
          start: 10,
          end: 42,
        },
        text: "",
        before: "",
        after: "",
        textVersion: "sha256:test",
      }),
    ).to.throw("PDF citation range text is empty");
  });
});
