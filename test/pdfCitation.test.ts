import { expect } from "chai";
import {
  PdfCitationRangeRegistry,
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
  it("summarizes PDF citation tool calls without saving raw long text", function () {
    const trace = summarizePdfCitationToolCall({
      round: 2,
      toolName: "read_pdf_text_range",
      args: {
        libraryID: 1,
        attachmentKey: "ATTACH1",
        start: 10,
        end: 500,
      },
      status: "success",
      result: JSON.stringify({
        rangeId: "r_7k9p2x4q",
        textVersion: `sha256:${"a".repeat(64)}`,
        start: 10,
        end: 500,
        text: `${"evidence ".repeat(80)}done`,
        before: "before context",
        after: "after context",
      }),
    });

    expect(trace.round).to.equal(2);
    expect(trace.toolName).to.equal("read_pdf_text_range");
    expect(trace.argsSummary).to.deep.equal({
      libraryID: 1,
      attachmentKey: "ATTACH1",
      start: 10,
      end: 500,
    });
    expect(trace.resultSummary.rangeId).to.equal("r_7k9p2x4q");
    expect(trace.resultSummary.textVersion).to.equal("sha256:aaaaaaaaaaaa");
    expect(trace.resultSummary.textLength).to.equal(
      `${"evidence ".repeat(80)}done`.length,
    );
    expect(String(trace.resultSummary.textPreview)).to.have.length.lessThan(
      170,
    );
    expect(JSON.stringify(trace)).to.not.contain("done");
  });

  it("summarizes find_pdf_text matches with query and match previews", function () {
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
            start: 100,
            end: 130,
            text: `${"matched text ".repeat(40)}end`,
          },
        ],
      },
    });

    expect(trace.argsSummary.queryLength).to.equal(
      `${"query ".repeat(80)}needle`.length,
    );
    expect(String(trace.argsSummary.queryPreview)).to.have.length.lessThan(170);
    expect(trace.resultSummary).to.deep.include({
      textVersion: "sha256:bbbbbbbbbbbb",
      matchCount: 1,
    });
    expect((trace.resultSummary.firstMatch as any).start).to.equal(100);
    expect((trace.resultSummary.firstMatch as any).end).to.equal(130);
    expect(JSON.stringify(trace)).to.not.contain("needle");
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
