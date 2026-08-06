import { expect } from "chai";
import {
  DEFAULT_CITATION_RENDER_MODEL,
  DEFAULT_TITLE_GENERATION_MODEL,
  PROVIDER_CONFIGS,
  parseModelList,
} from "../src/utils/providerConfig";

describe("provider model defaults", function () {
  it("uses the current catalog defaults for every provider", function () {
    expect(
      parseModelList(PROVIDER_CONFIGS.gemini.currentModelList),
    ).to.deep.equal([
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.1-pro-preview",
    ]);
    expect(PROVIDER_CONFIGS.gemini.defaultModel).to.equal(
      "gemini-3.5-flash-lite",
    );
    expect(PROVIDER_CONFIGS.gemini.defaultTitleModel).to.equal(
      "gemini-3.5-flash-lite",
    );
    expect(
      parseModelList(PROVIDER_CONFIGS.openai.currentModelList),
    ).to.deep.equal([
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.6-luna",
      "gpt-5-mini",
      "gpt-5-nano",
    ]);
    expect(PROVIDER_CONFIGS.openai.defaultModel).to.equal("gpt-5.6-luna");
    expect(PROVIDER_CONFIGS.openai.defaultTitleModel).to.equal("gpt-5.6-luna");
    expect(
      parseModelList(PROVIDER_CONFIGS.anthropic.currentModelList),
    ).to.deep.equal([
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-5",
      "claude-haiku-4-5-20251001",
    ]);
    expect(PROVIDER_CONFIGS.anthropic.defaultModel).to.equal(
      "claude-haiku-4-5-20251001",
    );
    expect(PROVIDER_CONFIGS.anthropic.defaultTitleModel).to.equal(
      "claude-haiku-4-5-20251001",
    );
    expect(DEFAULT_TITLE_GENERATION_MODEL).to.equal("gemini-3.5-flash-lite");
    expect(DEFAULT_CITATION_RENDER_MODEL).to.equal("gemini-3.5-flash-lite");
  });
});
