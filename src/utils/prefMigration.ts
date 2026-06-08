import {
  PREF_CITATION_RENDER_MODEL,
  PREF_CITATION_RENDER_PROMPT,
  PREF_CITATION_RENDER_PROVIDER,
  PREF_LLM_PROVIDER,
  PREF_REASONING_MODE,
  PREF_TITLE_GENERATION_MODEL,
  PREF_TITLE_GENERATION_PROVIDER,
} from "./constants";
import {
  DEFAULT_CITATION_RENDER_MODEL,
  DEFAULT_TITLE_GENERATION_MODEL,
  PROVIDER_CONFIGS,
  PROVIDERS,
} from "./providerConfig";
import { clearPref, getPref, setPref } from "./prefs";

export function migrateProviderPrefs(): void {
  if (!getPref(PREF_LLM_PROVIDER)) {
    setPref(PREF_LLM_PROVIDER, "gemini");
  }

  if (!getPref(PREF_TITLE_GENERATION_PROVIDER)) {
    setPref(PREF_TITLE_GENERATION_PROVIDER, "current");
  }

  if (!getPref(PREF_CITATION_RENDER_PROVIDER)) {
    setPref(PREF_CITATION_RENDER_PROVIDER, "gemini");
  }

  PROVIDERS.forEach((provider) => {
    const config = PROVIDER_CONFIGS[provider];
    if (!getPref(config.modelListPref)) {
      setPref(config.modelListPref, config.currentModelList);
    }

    if (!getPref(config.selectedModelPref)) {
      setPref(config.selectedModelPref, config.defaultModel);
    }
  });

  const titleGenerationModel = getPref(PREF_TITLE_GENERATION_MODEL);
  if (!titleGenerationModel) {
    setPref(PREF_TITLE_GENERATION_MODEL, DEFAULT_TITLE_GENERATION_MODEL);
  }

  const citationRenderModel = getPref(PREF_CITATION_RENDER_MODEL);
  if (!citationRenderModel) {
    setPref(PREF_CITATION_RENDER_MODEL, DEFAULT_CITATION_RENDER_MODEL);
  }

  const citationRenderPrompt = getPref(PREF_CITATION_RENDER_PROMPT);
  const oldDefaultCitationRenderPrompt =
    typeof citationRenderPrompt === "string" &&
    citationRenderPrompt.includes(
      "- answerContext: surrounding assistant answer text.",
    );
  const previousPdfContextPrompt =
    typeof citationRenderPrompt === "string" &&
    citationRenderPrompt.includes(
      "- before / after: nearby PDF context for disambiguating notation only.",
    );
  const previousCitationTerminologyPrompt =
    typeof citationRenderPrompt === "string" &&
    (citationRenderPrompt.includes("verified PDF citation") ||
      citationRenderPrompt.includes("Do not output citation blocks") ||
      citationRenderPrompt.includes(
        "Translate or lightly rewrite only rawText; do not add",
      ));
  const previousCitationCompletionPrompt =
    typeof citationRenderPrompt === "string" &&
    citationRenderPrompt.includes(
      "If rawText is fragmentary or incomplete, keep the display text fragmentary or incomplete. Do not complete it from the PDF.",
    ) &&
    !citationRenderPrompt.includes(
      "Do not add conclusions, implications, surrounding context",
    );
  const previousVerboseCitationRenderPrompt =
    typeof citationRenderPrompt === "string" &&
    citationRenderPrompt.includes(
      "You generate display text for one verified PDF passage.",
    );
  const previousJapaneseCitationRenderPrompt =
    typeof citationRenderPrompt === "string" &&
    citationRenderPrompt.includes(
      "あなたの役割はpdf断片であるテキストを翻訳、マークダウン装飾することです。",
    );
  const previousCitationRenderPromptWithoutFidelity =
    typeof citationRenderPrompt === "string" &&
    citationRenderPrompt.includes(
      "Your role is to translate and apply Markdown formatting to text that is a PDF fragment.",
    ) &&
    !citationRenderPrompt.includes("Security-critical fidelity:");
  if (
    !citationRenderPrompt ||
    oldDefaultCitationRenderPrompt ||
    previousPdfContextPrompt ||
    previousCitationTerminologyPrompt ||
    previousCitationCompletionPrompt ||
    previousVerboseCitationRenderPrompt ||
    previousJapaneseCitationRenderPrompt ||
    previousCitationRenderPromptWithoutFidelity
  ) {
    clearPref(PREF_CITATION_RENDER_PROMPT);
  }

  if (!getPref(PREF_REASONING_MODE)) {
    setPref(PREF_REASONING_MODE, "off");
  }
}
