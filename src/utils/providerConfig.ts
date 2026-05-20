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
  legacyModelLists: string[];
  legacySelectedModels: string[];
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
      "gemini-3.5-flash,gemini-3.1-pro-preview,gemini-3.1-flash-lite,gemini-3-flash-preview",
    defaultModel: "gemini-3.5-flash",
    defaultTitleModel: "gemini-3.1-flash-lite",
    legacyModelLists: [
      "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.5-pro,gemini-3-pro-preview,gemini-3-flash-preview",
    ],
    legacySelectedModels: [
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-3-pro-preview",
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    apiKeyPref: PREF_OPENAI_API_KEY,
    modelListPref: PREF_OPENAI_MODEL_LIST,
    selectedModelPref: PREF_OPENAI_SELECTED_MODEL,
    currentModelList:
      "gpt-5.5,gpt-5.5-pro,gpt-5.4,gpt-5.4-pro,gpt-5.4-mini,gpt-5.4-nano",
    defaultModel: "gpt-5.5",
    defaultTitleModel: "gpt-5.4-nano",
    legacyModelLists: [
      "gpt-5.5,gpt-5.4,gpt-5.4-mini,gpt-5.4-nano",
      "gpt-5.2,gpt-5.2-pro,gpt-5.1,gpt-5,gpt-5-mini,gpt-4.1",
    ],
    legacySelectedModels: [
      "gpt-5.2",
      "gpt-5.2-pro",
      "gpt-5.1",
      "gpt-5",
      "gpt-5-mini",
      "gpt-4.1",
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    apiKeyPref: PREF_ANTHROPIC_API_KEY,
    modelListPref: PREF_ANTHROPIC_MODEL_LIST,
    selectedModelPref: PREF_ANTHROPIC_SELECTED_MODEL,
    currentModelList:
      "claude-sonnet-4-5-20250929,claude-haiku-4-5-20251001,claude-opus-4-5-20251101",
    defaultModel: "claude-sonnet-4-5-20250929",
    defaultTitleModel: "claude-haiku-4-5-20251001",
    legacyModelLists: ["claude-sonnet-4-5,claude-haiku-4-5,claude-opus-4-1"],
    legacySelectedModels: [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-opus-4-1",
      "claude-opus-4-1-20250805",
    ],
  },
};

export const DEFAULT_TITLE_GENERATION_MODEL = "gemini-3.1-flash-lite";

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
