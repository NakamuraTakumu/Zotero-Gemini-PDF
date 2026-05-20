import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {
  ChatMessage,
  LlmCitation,
  LlmDiagnostics,
  ParentItemFileMetadata,
  ProviderId,
} from "../../types/chat";
import { PREF_SYSTEM_PROMPT } from "../../utils/constants";
import { getPref } from "../../utils/prefs";
import { stripThoughtsFromText } from "../../utils/thoughts";
import { getEffectiveModel, getSelectedProvider } from "./provider";
import {
  getChatProviderAdapter,
  LlmRequestPolicy,
  getRequestPolicy,
  LangChainContentBlock,
} from "./chatProviderAdapters";

export interface LlmChatResponse {
  provider: ProviderId;
  model: string;
  responseText: string;
  thoughts: string[];
  citations: LlmCitation[];
  groundingMetadata?: any;
  diagnostics?: LlmDiagnostics;
}

interface SendMessageOptions {
  provider?: ProviderId;
  modelName?: string;
  metadata?: ParentItemFileMetadata;
  policy?: Partial<LlmRequestPolicy>;
}

function toLangChainHistory(history: ChatMessage[]): BaseMessage[] {
  return history.map((message) => {
    const rawText = message.parts.map((part) => part.text).join("\n");
    const text =
      message.role === "model"
        ? stripThoughtsFromText(rawText, message.thoughts)
        : rawText;
    return message.role === "user"
      ? new HumanMessage(text)
      : new AIMessage(text);
  });
}

function buildMessages(
  history: ChatMessage[],
  text: string,
  pdfContentBlocks: LangChainContentBlock[],
): BaseMessage[] {
  const messages: BaseMessage[] = [];
  const systemPrompt = getPref(PREF_SYSTEM_PROMPT) as string | undefined;
  if (systemPrompt) {
    messages.push(new SystemMessage(systemPrompt));
  }
  messages.push(...toLangChainHistory(history));

  const contentBlocks = [...pdfContentBlocks, { type: "text", text }];
  messages.push(new HumanMessage({ contentBlocks: contentBlocks as any }));
  return messages;
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
  if (typeof message.content === "string") {
    return message.content;
  }
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

function extractThoughts(message: AIMessage): string[] {
  const blocks = (message as any).contentBlocks;
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block: any) => {
      if (block?.type === "reasoning" && typeof block.reasoning === "string") {
        return block.reasoning;
      }
      if (block?.type === "thinking" && typeof block.thinking === "string") {
        return block.thinking;
      }
      if (block?.type === "reasoning" && typeof block.text === "string") {
        return block.text;
      }
      if (block?.type === "reasoning" && Array.isArray(block.summary)) {
        return block.summary
          .map((part: any) =>
            typeof part === "string"
              ? part
              : typeof part?.text === "string"
                ? part.text
                : "",
          )
          .filter(Boolean)
          .join("\n");
      }
      return undefined;
    })
    .filter((text: unknown): text is string => typeof text === "string");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCitation(
  value: Record<string, any>,
  provider: ProviderId,
): LlmCitation | undefined {
  const web =
    value.web && typeof value.web === "object" ? value.web : undefined;
  const source =
    value.source && typeof value.source === "object" ? value.source : undefined;
  const url =
    asString(value.url) ||
    asString(value.uri) ||
    asString(value.href) ||
    asString(web?.url) ||
    asString(web?.uri) ||
    asString(source?.url) ||
    asString(source?.uri);
  const title =
    asString(value.title) ||
    asString(value.name) ||
    asString(value.label) ||
    asString(web?.title) ||
    asString(source?.title) ||
    url;
  const quote =
    asString(value.quote) ||
    asString(value.cited_text) ||
    asString(value.citedText) ||
    asString(value.text);
  if (!title && !url) return undefined;
  return {
    title: title || url || "Source",
    ...(url ? { url } : {}),
    ...(quote ? { quote } : {}),
    provider,
  };
}

function collectCitationCandidates(
  value: unknown,
  provider: ProviderId,
  citations: LlmCitation[],
  depth = 0,
): void {
  if (depth > 8 || citations.length >= 30 || !value) return;
  if (Array.isArray(value)) {
    value.forEach((item) =>
      collectCitationCandidates(item, provider, citations, depth + 1),
    );
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, any>;
  const type = String(record.type || "").toLowerCase();
  const looksLikeCitation =
    type.includes("citation") ||
    type.includes("web_search_result") ||
    type.includes("web-search-result") ||
    Boolean(record.web) ||
    Boolean(record.url) ||
    Boolean(record.uri);
  if (looksLikeCitation) {
    const citation = normalizeCitation(record, provider);
    if (citation) citations.push(citation);
  }

  Object.values(record).forEach((child) =>
    collectCitationCandidates(child, provider, citations, depth + 1),
  );
}

function dedupeCitations(citations: LlmCitation[]): LlmCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.url || ""}\n${citation.title}\n${citation.quote || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractCitations(
  provider: ProviderId,
  response: AIMessage,
): LlmCitation[] {
  const citations: LlmCitation[] = [];
  collectCitationCandidates(
    (response as any).contentBlocks,
    provider,
    citations,
  );
  collectCitationCandidates(response.content, provider, citations);
  collectCitationCandidates(response.response_metadata, provider, citations);
  return dedupeCitations(citations);
}

export async function sendMessageToLlm(
  history: ChatMessage[],
  text: string,
  options: SendMessageOptions = {},
): Promise<LlmChatResponse> {
  const provider = options.provider || getSelectedProvider();
  const model = getEffectiveModel(provider, options.modelName);
  if (!model) {
    throw new Error(`No model selected for ${provider}.`);
  }

  const adapter = getChatProviderAdapter(provider);
  const policy = { ...getRequestPolicy(), ...options.policy };
  const chatModel = adapter.createModel(model, policy);
  const messages = buildMessages(
    history,
    text,
    adapter.buildPdfContentBlocks(options.metadata),
  );
  const invokeOptions = adapter.buildInvokeOptions(policy);
  const response = (await chatModel.invoke(
    messages,
    invokeOptions,
  )) as AIMessage;
  const thoughts = extractThoughts(response);
  const responseText = stripThoughtsFromText(extractText(response), thoughts);
  const citations = extractCitations(provider, response);
  const diagnostics = adapter.buildDiagnostics(response, thoughts, policy);
  return {
    provider,
    model,
    responseText: responseText || "No response.",
    thoughts,
    citations,
    groundingMetadata: (response.response_metadata as any)?.groundingMetadata,
    diagnostics,
  };
}
