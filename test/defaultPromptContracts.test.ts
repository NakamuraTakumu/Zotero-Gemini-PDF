import { expect } from "chai";

let defaultPrompts = "";

describe("default prompt contracts", function () {
  before(async function () {
    const nodeFs = await import("node:" + "fs");
    defaultPrompts = nodeFs.readFileSync(
      `${process.cwd()}/addon/prefs.js`,
      "utf8",
    );
  });

  it("defines one visible response grammar with evidence units as its only detailed surface", function () {
    expect(defaultPrompts).to.include("# 5. Final Response Grammar");
    expect(defaultPrompts).to.include(
      "FinalResponse ::= Conclusion EvidenceUnit*",
    );
    expect(defaultPrompts).to.include(
      "Conclusion is a concise Japanese answer for the reader.",
    );
    expect(defaultPrompts).to.include(
      "EvidenceUnit is the complete reader-visible home for one supported point.",
    );
    expect(defaultPrompts).to.include("+++ {Brief claim}");
    expect(defaultPrompts).to.include(
      "{One claim supported by the cited PDF range.}",
    );
    expect(defaultPrompts).to.include(
      "{Commentary explaining what the cited text means for that claim.}",
    );
    expect(defaultPrompts).to.include(
      "All visible final-response content is the conclusion or an evidence unit; there is no independent explanatory body.",
    );
    expect(defaultPrompts).to.not.include("Response Structure Format");
    expect(defaultPrompts).to.not.include("STEP 1: Concise Conclusion");
    expect(defaultPrompts).to.not.include(
      "STEP 2: Grounds and Commentary (Repeat)",
    );
    expect(defaultPrompts).to.not.include(
      "Write the answer as natural Markdown",
    );
  });

  it("gives the visible example the same grammar and excludes a free-form body", function () {
    const visibleAnswer = defaultPrompts.match(
      /Visible answer:\n([\s\S]*?)\n\nOutside fenced code blocks/,
    )?.[1];

    expect(visibleAnswer).to.be.a("string");
    const lines = visibleAnswer!.split("\n");
    const openingIndex = lines.findIndex((line) => line.startsWith("+++ "));
    const closingIndex = lines.findIndex((line) => line === "+++");
    const citationIndex = lines.findIndex((line) =>
      line.startsWith('::: citation {"rangeId":"'),
    );

    expect(lines[0]).to.not.match(/^\+\+\+/);
    expect(openingIndex).to.be.greaterThan(0);
    expect(lines.filter((line) => line.startsWith("+++"))).to.have.length(2);
    expect(citationIndex).to.be.greaterThan(openingIndex);
    expect(lines[citationIndex + 1]).to.equal(":::");
    expect(closingIndex).to.be.greaterThan(citationIndex + 1);
    expect(lines[closingIndex]).to.equal(lines.at(-1));
    expect(visibleAnswer).to.not.match(/^#{1,6}\s/m);
    expect(visibleAnswer).to.not.include("STEP");
  });

  it("keeps the response grammar structural instead of adding output-stage guards", function () {
    expect(defaultPrompts).to.not.include("at most one citation");
    expect(defaultPrompts).to.not.include("Before sending your response");
    expect(defaultPrompts).to.not.include("self-check");
    expect(defaultPrompts).to.not.include("retry the response");
  });

  it("defines citation display text as a Japanese translation", function () {
    expect(defaultPrompts).to.include(
      "The display text is a Japanese translation of rawText, not a quotation.",
    );
    expect(defaultPrompts).to.include(
      "Preserve rawText's meaning and visible boundaries.",
    );
    expect(defaultPrompts).to.not.include(
      "Do not write anything that is not present in rawText.",
    );
    expect(defaultPrompts).to.not.include("Security-critical fidelity:");
  });
});
