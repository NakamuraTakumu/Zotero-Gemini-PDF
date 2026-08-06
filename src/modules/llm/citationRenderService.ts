import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  PREF_CITATION_RENDER_MODEL,
  PREF_CITATION_RENDER_PROMPT,
} from "../../utils/constants";
import { getPref } from "../../utils/prefs";
import { getProviderConfig } from "../../utils/providerConfig";
import { getCitationRenderProvider, getProviderModelList } from "./provider";
import { getChatProviderAdapter } from "./chatProviderAdapters";
import type {
  ParentItemFileMetadata,
  ParentItemFileMetadataFile,
  ProviderId,
} from "../../types/chat";

export interface CitationRenderInput {
  rawText: string;
  pdfFile: ParentItemFileMetadataFile;
}

const MAX_RENDER_OUTPUT_CHARS = 1200;

export function resolveCitationRenderModel(
  provider: ProviderId,
  configuredModel: string,
  availableModels = getProviderModelList(provider),
): string {
  const model = configuredModel.trim();
  if (model && availableModels.includes(model)) {
    return model;
  }

  const defaultModel = getProviderConfig(provider).defaultTitleModel;
  if (availableModels.includes(defaultModel)) {
    return defaultModel;
  }

  return availableModels[0] || defaultModel;
}

function extractText(message: AIMessage): string {
  const contentBlocks = (message as any).contentBlocks;
  if (Array.isArray(contentBlocks)) {
    const text = contentBlocks
      .map((block: any) =>
        block?.type === "text" && typeof block.text === "string"
          ? block.text
          : "",
      )
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((block: any) => {
        if (typeof block === "string") return block;
        if (typeof block?.text === "string") return block.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function validateCitationRenderText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error("Citation render output is empty.");
  }
  if (normalized.length > MAX_RENDER_OUTPUT_CHARS) {
    throw new Error(
      `Citation render output is too long: ${normalized.length} chars.`,
    );
  }
  if (/(^|\n)\s*:::/m.test(normalized)) {
    throw new Error("Citation render output contains container syntax.");
  }
  if (/(^|\n)\s*\+\+\+/m.test(normalized)) {
    throw new Error("Citation render output contains collapsible syntax.");
  }
  if (/https?:\/\//i.test(normalized)) {
    throw new Error("Citation render output contains a URL.");
  }
  if (/"locator"\s*:/.test(normalized)) {
    throw new Error("Citation render output contains locator JSON.");
  }
  if (/^```|```$/m.test(normalized)) {
    throw new Error("Citation render output contains a markdown fence.");
  }
  return normalized;
}

export async function renderPdfCitationDisplayText(
  input: CitationRenderInput,
): Promise<{
  provider: string;
  model: string;
  displayText: string;
}> {
  const provider = getCitationRenderProvider();
  const model = resolveCitationRenderModel(
    provider,
    (getPref(PREF_CITATION_RENDER_MODEL) as string) || "",
  );
  const prompt = (
    (getPref(PREF_CITATION_RENDER_PROMPT) as string) || ""
  ).trim();
  if (!prompt) {
    throw new Error("Citation render prompt preference is missing.");
  }
  const adapter = getChatProviderAdapter(provider);
  const pdfMetadata: ParentItemFileMetadata = {
    zoteroParentItemKey: "",
    files: [input.pdfFile],
    chatSessions: [],
  };
  const pdfContentBlocks = adapter.buildPdfContentBlocks(pdfMetadata);
  if (pdfContentBlocks.length === 0) {
    throw new Error(`Citation render PDF upload is missing for ${provider}.`);
  }
  const policy = { useWebSearch: false, reasoningMode: "off" as const };
  const chatModel = adapter.createModel(model, policy);
  const messages = [
    new SystemMessage(prompt),
    new HumanMessage({
      contentBlocks: [
        ...pdfContentBlocks,
        {
          type: "text",
          text: JSON.stringify({
            rawText: input.rawText,
          }),
        },
      ] as any,
    }),
  ];
  const response = (await chatModel.invoke(
    messages,
    adapter.buildInvokeOptions(policy),
  )) as AIMessage;
  return {
    provider,
    model,
    displayText: validateCitationRenderText(extractText(response)),
  };
}
