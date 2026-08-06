import { expect } from "chai";
import { normalizeAssistantMarkdown } from "../src/modules/llm/assistantMarkdown";

describe("assistant Markdown normalization", function () {
  it("removes plain, indented, and repeated blockquote markers", function () {
    expect(normalizeAssistantMarkdown("> one\n  > two\n> > three")).to.equal(
      "one\ntwo\nthree",
    );
  });

  it("leaves non-leading markers unchanged", function () {
    expect(normalizeAssistantMarkdown("a > b\ntext > quote")).to.equal(
      "a > b\ntext > quote",
    );
  });

  it("preserves content inside backtick and tilde fences", function () {
    const input = [
      "> outside",
      "```ts",
      "> inside backticks",
      "```",
      "> after",
      "~~~",
      "> inside tildes",
      "~~~",
    ].join("\n");
    expect(normalizeAssistantMarkdown(input)).to.equal(
      [
        "outside",
        "```ts",
        "> inside backticks",
        "```",
        "after",
        "~~~",
        "> inside tildes",
        "~~~",
      ].join("\n"),
    );
  });

  it("normalizes blockquoted citation syntax before parsing", function () {
    const input = '> ::: citation {"rangeId":"r_test"}\n> :::\n> after';
    expect(normalizeAssistantMarkdown(input)).to.equal(
      '::: citation {"rangeId":"r_test"}\n:::\nafter',
    );
  });

  it("preserves CRLF line endings", function () {
    expect(normalizeAssistantMarkdown("> one\r\n> two\r\n")).to.equal(
      "one\r\ntwo\r\n",
    );
  });

  it("normalizes persisted assistant display text without changing citations or fences", function () {
    const persistedDisplayText = [
      '> ::: citation {"rangeId":"history"}',
      "> quoted history",
      "> :::",
      "```ts",
      "> inside fence",
      "```",
    ].join("\n");
    expect(normalizeAssistantMarkdown(persistedDisplayText)).to.equal(
      [
        '::: citation {"rangeId":"history"}',
        "quoted history",
        ":::",
        "```ts",
        "> inside fence",
        "```",
      ].join("\n"),
    );
  });

  it("normalizes live assistant response text while retaining fenced code", function () {
    const liveResponseText = [
      "> live answer",
      "```python",
      "> return 1",
      "```",
    ].join("\n");
    expect(normalizeAssistantMarkdown(liveResponseText)).to.equal(
      ["live answer", "```python", "> return 1", "```"].join("\n"),
    );
  });
});
