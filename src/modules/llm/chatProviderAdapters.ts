import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { ChatAnthropic, tools as anthropicTools } from "@langchain/anthropic";
import { ChatGoogle } from "@langchain/google";
import { ChatOpenAI, tools as openAITools } from "@langchain/openai";
import {
  LlmDiagnostics,
  ParentItemFileMetadata,
  ParentItemFileMetadataFile,
  ProviderId,
  ProviderPdfUploadRef,
  ReasoningMode,
} from "../../types/chat";
import { getPref } from "../../utils/prefs";
import {
  PREF_REASONING_MODE,
  PREF_USE_WEB_SEARCH,
} from "../../utils/constants";
import { getProviderApiKey } from "./provider";

export interface LlmRequestPolicy {
  useWebSearch: boolean;
  reasoningMode: ReasoningMode;
}

export interface InvokableChatModel {
  invoke(
    messages: BaseMessage[],
    options: Record<string, unknown>,
  ): Promise<unknown>;
}

export type LangChainContentBlock = Record<string, unknown>;

export interface ChatProviderAdapter {
  readonly provider: ProviderId;
  buildPdfContentBlocks(
    metadata?: ParentItemFileMetadata,
  ): LangChainContentBlock[];
  createModel(model: string, policy: LlmRequestPolicy): InvokableChatModel;
  buildInvokeOptions(policy: LlmRequestPolicy): Record<string, unknown>;
  buildNativeTools(policy: LlmRequestPolicy): unknown[];
  buildDiagnostics(
    response: AIMessage,
    thoughts: string[],
    policy: LlmRequestPolicy,
  ): LlmDiagnostics;
}

function getUploadForProvider(
  file: ParentItemFileMetadataFile,
  provider: ProviderId,
): ProviderPdfUploadRef | undefined {
  return file.uploads?.find((upload) => upload.provider === provider);
}

function requireApiKey(provider: ProviderId): string {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(`${provider} API key is not set.`);
  }
  return apiKey;
}

function getGeminiReasoningConfig(
  mode: ReasoningMode,
  model: string,
): Record<string, unknown> {
  if (mode === "off") {
    return model.includes("gemini-3") && model.includes("flash")
      ? { reasoningEffort: "minimal" }
      : {};
  }

  return {
    reasoningEffort: mode,
    thinkingConfig: {
      includeThoughts: true,
    },
  };
}

function getOpenAIReasoningConfig(
  mode: ReasoningMode,
): Record<string, unknown> {
  if (mode === "off") {
    return {
      reasoning: {
        effort: "none",
      },
    };
  }
  return {
    reasoning: {
      effort: mode,
      summary: "auto",
    },
  };
}

function getAnthropicThinkingBudget(mode: ReasoningMode): number | undefined {
  switch (mode) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 10000;
    case "off":
      return undefined;
  }
}

abstract class BaseChatProviderAdapter implements ChatProviderAdapter {
  abstract readonly provider: ProviderId;

  buildPdfContentBlocks(
    metadata?: ParentItemFileMetadata,
  ): LangChainContentBlock[] {
    if (!metadata) return [];
    return metadata.files
      .map((file) => this.buildPdfContentBlock(file))
      .filter((block): block is LangChainContentBlock => Boolean(block));
  }

  abstract createModel(
    model: string,
    policy: LlmRequestPolicy,
  ): InvokableChatModel;

  abstract buildInvokeOptions(
    policy: LlmRequestPolicy,
  ): Record<string, unknown>;

  buildNativeTools(_policy: LlmRequestPolicy): unknown[] {
    return [];
  }

  abstract buildDiagnostics(
    response: AIMessage,
    thoughts: string[],
    policy: LlmRequestPolicy,
  ): LlmDiagnostics;

  protected abstract buildPdfContentBlock(
    file: ParentItemFileMetadataFile,
  ): LangChainContentBlock | undefined;
}

class GeminiChatProviderAdapter extends BaseChatProviderAdapter {
  readonly provider = "gemini" as const;

  protected buildPdfContentBlock(
    file: ParentItemFileMetadataFile,
  ): LangChainContentBlock | undefined {
    const upload = getUploadForProvider(file, this.provider);
    if (!upload || upload.provider !== "gemini") return undefined;
    return {
      type: "file",
      url: upload.fileUri,
      mimeType: "application/pdf",
      metadata: { filename: file.fileName },
    };
  }

  createModel(model: string, policy: LlmRequestPolicy) {
    return new ChatGoogle({
      apiKey: requireApiKey(this.provider),
      model,
      ...getGeminiReasoningConfig(policy.reasoningMode, model),
    } as any);
  }

  buildInvokeOptions(policy: LlmRequestPolicy): Record<string, unknown> {
    const tools = this.buildNativeTools(policy);
    return tools.length > 0 ? { tools } : {};
  }

  buildNativeTools(policy: LlmRequestPolicy): unknown[] {
    if (!policy.useWebSearch) return [];
    return [{ urlContext: {} }, { googleSearch: {} }];
  }

  buildDiagnostics(
    response: AIMessage,
    thoughts: string[],
    policy: LlmRequestPolicy,
  ): LlmDiagnostics {
    const groundingMetadata = (response.response_metadata as any)
      ?.groundingMetadata;
    const contentBlocks = (response as any).contentBlocks;
    return {
      searchRequested: policy.useWebSearch,
      searchUsed: Boolean(
        groundingMetadata?.webSearchQueries?.length ||
          groundingMetadata?.groundingChunks?.length,
      ),
      thinkingRequested: policy.reasoningMode !== "off",
      thinkingUsed: thoughts.length > 0,
      thoughtCount: thoughts.length,
      groundingChunkCount: groundingMetadata?.groundingChunks?.length || 0,
      webSearchQueryCount: groundingMetadata?.webSearchQueries?.length || 0,
      contentBlockTypes: Array.isArray(contentBlocks)
        ? contentBlocks.map((block: any) => String(block?.type || "unknown"))
        : [],
    };
  }
}

class OpenAIChatProviderAdapter extends BaseChatProviderAdapter {
  readonly provider = "openai" as const;

  protected buildPdfContentBlock(
    file: ParentItemFileMetadataFile,
  ): LangChainContentBlock | undefined {
    const upload = getUploadForProvider(file, this.provider);
    if (!upload || upload.provider !== "openai") return undefined;
    return {
      type: "file",
      fileId: upload.fileId,
      mimeType: "application/pdf",
    };
  }

  createModel(model: string, policy: LlmRequestPolicy) {
    return new ChatOpenAI({
      apiKey: requireApiKey(this.provider),
      model,
      useResponsesApi: true,
      configuration: { dangerouslyAllowBrowser: true },
      ...getOpenAIReasoningConfig(policy.reasoningMode),
    });
  }

  buildInvokeOptions(policy: LlmRequestPolicy): Record<string, unknown> {
    const tools = this.buildNativeTools(policy);
    return tools.length > 0 ? { tools } : {};
  }

  buildNativeTools(policy: LlmRequestPolicy): unknown[] {
    if (!policy.useWebSearch) return [];
    return [openAITools.webSearch()];
  }

  buildDiagnostics(
    response: AIMessage,
    thoughts: string[],
    policy: LlmRequestPolicy,
  ): LlmDiagnostics {
    const responseMetadata = response.response_metadata as any;
    const output = responseMetadata?.output;
    const contentBlocks = (response as any).contentBlocks;
    const outputTypes = Array.isArray(output)
      ? output.map((item: any) => String(item?.type || "unknown"))
      : [];
    const reasoningItems = Array.isArray(output)
      ? output.filter((item: any) => item?.type === "reasoning")
      : [];
    return {
      searchRequested: policy.useWebSearch,
      searchUsed: outputTypes.includes("web_search_call"),
      thinkingRequested: policy.reasoningMode !== "off",
      thinkingUsed:
        thoughts.length > 0 ||
        reasoningItems.length > 0 ||
        Boolean(
          responseMetadata?.usage?.output_tokens_details?.reasoning_tokens,
        ),
      thoughtCount: thoughts.length,
      responseOutputTypes: outputTypes,
      contentBlockTypes: Array.isArray(contentBlocks)
        ? contentBlocks.map((block: any) => String(block?.type || "unknown"))
        : [],
      webSearchCallCount: outputTypes.filter(
        (type) => type === "web_search_call",
      ).length,
      reasoningItemCount: reasoningItems.length,
      reasoningTokenCount:
        responseMetadata?.usage?.output_tokens_details?.reasoning_tokens || 0,
    };
  }
}

class AnthropicChatProviderAdapter extends BaseChatProviderAdapter {
  readonly provider = "anthropic" as const;

  protected buildPdfContentBlock(
    file: ParentItemFileMetadataFile,
  ): LangChainContentBlock | undefined {
    const upload = getUploadForProvider(file, this.provider);
    if (!upload || upload.provider !== "anthropic") return undefined;
    return {
      type: "file",
      fileId: upload.fileId,
      mimeType: "application/pdf",
      metadata: { title: file.fileName },
    };
  }

  createModel(model: string, policy: LlmRequestPolicy) {
    const thinkingBudget = getAnthropicThinkingBudget(policy.reasoningMode);
    return new ChatAnthropic({
      apiKey: requireApiKey(this.provider),
      model,
      maxTokens: thinkingBudget ? Math.max(4096, thinkingBudget + 2048) : 4096,
      ...(thinkingBudget
        ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } }
        : {}),
      betas: ["files-api-2025-04-14"] as any,
    });
  }

  buildInvokeOptions(policy: LlmRequestPolicy): Record<string, unknown> {
    const tools = this.buildNativeTools(policy);
    return tools.length > 0 ? { tools } : {};
  }

  buildNativeTools(policy: LlmRequestPolicy): unknown[] {
    if (!policy.useWebSearch) return [];
    return [anthropicTools.webSearch_20250305({ maxUses: 5 })];
  }

  buildDiagnostics(
    response: AIMessage,
    thoughts: string[],
    policy: LlmRequestPolicy,
  ): LlmDiagnostics {
    const responseMetadata = response.response_metadata as any;
    const contentBlocks = (response as any).contentBlocks;
    const contentBlockTypes = Array.isArray(contentBlocks)
      ? contentBlocks.map((block: any) => String(block?.type || "unknown"))
      : [];
    return {
      searchRequested: policy.useWebSearch,
      searchUsed: Boolean(
        responseMetadata?.usage?.server_tool_use?.web_search_requests ||
          contentBlockTypes.includes("server_tool_call") ||
          contentBlockTypes.includes("server_tool_result"),
      ),
      thinkingRequested: policy.reasoningMode !== "off",
      thinkingUsed:
        thoughts.length > 0 ||
        contentBlockTypes.includes("reasoning") ||
        contentBlockTypes.includes("thinking"),
      thoughtCount: thoughts.length,
      contentBlockTypes,
      anthropicContentTypes: contentBlockTypes,
      anthropicWebSearchRequestCount:
        responseMetadata?.usage?.server_tool_use?.web_search_requests || 0,
    };
  }
}

const adapters: Record<ProviderId, ChatProviderAdapter> = {
  gemini: new GeminiChatProviderAdapter(),
  openai: new OpenAIChatProviderAdapter(),
  anthropic: new AnthropicChatProviderAdapter(),
};

export function getRequestPolicy(): LlmRequestPolicy {
  const mode = getPref(PREF_REASONING_MODE);
  const reasoningMode =
    mode === "low" || mode === "medium" || mode === "high" ? mode : "off";
  return {
    useWebSearch: Boolean(getPref(PREF_USE_WEB_SEARCH)),
    reasoningMode,
  };
}

export function getChatProviderAdapter(
  provider: ProviderId,
): ChatProviderAdapter {
  return adapters[provider];
}
