import {
  PREF_LLM_PROVIDER,
  PREF_REASONING_MODE,
  PREF_TITLE_GENERATION_MODEL,
  PREF_TITLE_GENERATION_PROVIDER,
} from "./constants";
import {
  DEFAULT_TITLE_GENERATION_MODEL,
  PROVIDER_CONFIGS,
  PROVIDERS,
} from "./providerConfig";
import { getPref, setPref } from "./prefs";

export function migrateProviderPrefs(): void {
  if (!getPref(PREF_LLM_PROVIDER)) {
    setPref(PREF_LLM_PROVIDER, "gemini");
  }

  if (!getPref(PREF_TITLE_GENERATION_PROVIDER)) {
    setPref(PREF_TITLE_GENERATION_PROVIDER, "current");
  }

  PROVIDERS.forEach((provider) => {
    const config = PROVIDER_CONFIGS[provider];
    const modelList = getPref(config.modelListPref);
    const shouldRefreshModelList =
      !modelList || config.legacyModelLists.includes(modelList);
    if (shouldRefreshModelList) {
      setPref(config.modelListPref, config.currentModelList);
    }

    const selectedModel = getPref(config.selectedModelPref);
    if (
      !selectedModel ||
      shouldRefreshModelList ||
      config.legacySelectedModels.includes(selectedModel)
    ) {
      setPref(config.selectedModelPref, config.defaultModel);
    }
  });

  const titleGenerationModel = getPref(PREF_TITLE_GENERATION_MODEL);
  if (!titleGenerationModel || titleGenerationModel === "gemini-2.5-flash") {
    setPref(PREF_TITLE_GENERATION_MODEL, DEFAULT_TITLE_GENERATION_MODEL);
  }

  if (!getPref(PREF_REASONING_MODE)) {
    setPref(PREF_REASONING_MODE, "off");
  }
}
