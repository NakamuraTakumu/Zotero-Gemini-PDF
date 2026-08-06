import { expect } from "chai";
import { getProviderConfig } from "../src/utils/providerConfig";
import { resolveCitationRenderModel } from "../src/modules/llm/citationRenderService";

describe("citation render model selection", function () {
  it("uses a configured model when it belongs to the selected provider", function () {
    expect(
      resolveCitationRenderModel("openai", "gpt-5.6-luna", [
        "gpt-5.6-terra",
        "gpt-5.6-luna",
      ]),
    ).to.equal("gpt-5.6-luna");
  });

  it("rejects a model stored for another provider", function () {
    const defaultModel = getProviderConfig("openai").defaultTitleModel;

    expect(
      resolveCitationRenderModel("openai", "gemini-3.5-flash-lite", [
        "gpt-5.6-terra",
        defaultModel,
      ]),
    ).to.equal(defaultModel);
  });

  it("uses the first configured model when the provider default is unavailable", function () {
    expect(
      resolveCitationRenderModel("anthropic", "gemini-3.5-flash-lite", [
        "claude-sonnet-5",
      ]),
    ).to.equal("claude-sonnet-5");
  });
});
