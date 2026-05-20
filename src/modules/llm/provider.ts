import {
  PREF_LLM_PROVIDER,
  PREF_TITLE_GENERATION_PROVIDER,
} from "../../utils/constants";
import {
  getProviderConfig,
  parseModelList,
  PROVIDERS,
} from "../../utils/providerConfig";
import { getPref, setPref } from "../../utils/prefs";
import { ProviderId } from "../../types/chat";

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDERS.includes(value as ProviderId);
}

export function getSelectedProvider(): ProviderId {
  const provider = getPref(PREF_LLM_PROVIDER);
  return isProviderId(provider) ? provider : "gemini";
}

export function setSelectedProvider(provider: ProviderId): void {
  setPref(PREF_LLM_PROVIDER, provider);
}

export function getTitleGenerationProvider(): ProviderId {
  const value = getPref(PREF_TITLE_GENERATION_PROVIDER);
  return isProviderId(value) ? value : getSelectedProvider();
}

export function getProviderApiKey(provider: ProviderId): string {
  return (getPref(getProviderConfig(provider).apiKeyPref) as string) || "";
}

export function getProviderModelList(provider: ProviderId): string[] {
  const config = getProviderConfig(provider);
  return parseModelList(
    getPref(config.modelListPref) || config.currentModelList,
  );
}

export function getSelectedModel(provider: ProviderId): string {
  return (
    (getPref(getProviderConfig(provider).selectedModelPref) as string) || ""
  );
}

export function setSelectedModel(provider: ProviderId, model: string): void {
  setPref(getProviderConfig(provider).selectedModelPref, model);
}

export function getEffectiveModel(provider: ProviderId, override?: string) {
  if (override) return override;
  const selected = getSelectedModel(provider);
  if (selected) return selected;
  return getProviderModelList(provider)[0] || "";
}
