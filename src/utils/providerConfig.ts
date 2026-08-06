import type { ProviderId } from "../types/chat";
import {
  PREF_ANTHROPIC_API_KEY,
  PREF_ANTHROPIC_MODEL_LIST,
  PREF_ANTHROPIC_SELECTED_MODEL,
  PREF_GEMINI_API_KEY,
  PREF_GEMINI_MODEL_LIST,
  PREF_GEMINI_SELECTED_MODEL,
  PREF_OPENAI_API_KEY,
  PREF_OPENAI_MODEL_LIST,
  PREF_OPENAI_SELECTED_MODEL,
} from "./constants";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];
type StringPrefKey = {
  [K in keyof PluginPrefsMap]: PluginPrefsMap[K] extends string ? K : never;
}[keyof PluginPrefsMap];

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  apiKeyPref: StringPrefKey;
  modelListPref: StringPrefKey;
  selectedModelPref: StringPrefKey;
  currentModelList: string;
  defaultModel: string;
  defaultTitleModel: string;
}

export const PROVIDERS: readonly ProviderId[] = [
  "gemini",
  "openai",
  "anthropic",
];

export const PROVIDER_CONFIGS: Record<ProviderId, ProviderConfig> = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    apiKeyPref: PREF_GEMINI_API_KEY,
    modelListPref: PREF_GEMINI_MODEL_LIST,
    selectedModelPref: PREF_GEMINI_SELECTED_MODEL,
    currentModelList:
      "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.1-pro-preview",
    defaultModel: "gemini-3.5-flash-lite",
    defaultTitleModel: "gemini-3.5-flash-lite",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    apiKeyPref: PREF_OPENAI_API_KEY,
    modelListPref: PREF_OPENAI_MODEL_LIST,
    selectedModelPref: PREF_OPENAI_SELECTED_MODEL,
    currentModelList:
      "gpt-5.6-terra,gpt-5.6-sol,gpt-5.6-luna,gpt-5-mini,gpt-5-nano",
    defaultModel: "gpt-5.6-luna",
    defaultTitleModel: "gpt-5.6-luna",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    apiKeyPref: PREF_ANTHROPIC_API_KEY,
    modelListPref: PREF_ANTHROPIC_MODEL_LIST,
    selectedModelPref: PREF_ANTHROPIC_SELECTED_MODEL,
    currentModelList:
      "claude-sonnet-5,claude-fable-5,claude-opus-5,claude-haiku-4-5-20251001",
    defaultModel: "claude-haiku-4-5-20251001",
    defaultTitleModel: "claude-haiku-4-5-20251001",
  },
};

export const DEFAULT_TITLE_GENERATION_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_CITATION_RENDER_MODEL = "gemini-3.5-flash-lite";

export function getProviderConfig(provider: ProviderId): ProviderConfig {
  return PROVIDER_CONFIGS[provider];
}

export function parseModelList(raw: unknown): string[] {
  return typeof raw === "string"
    ? raw
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
    : [];
}
