import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  StoredMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  LlmCitation,
  LlmDiagnostics,
  ParentItemFileMetadata,
  PdfCitationToolCallTrace,
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
import {
  createAssistantStoredMessage,
  toLangChainMessagesForLlmContext,
} from "./langChainMessages";
import {
  createPdfCitationTools,
  PdfCitationRangeRegistry,
  normalizePdfCitationBlocks,
  summarizePdfCitationToolCall,
} from "../pdfCitation";
import { renderPdfCitationDisplayText } from "./citationRenderService";

const PDF_CITATION_FINALIZATION_PROMPT = [
  "The PDF citation tool round limit has been reached.",
  "Do not call any more tools.",
  "Answer the user's question now using only the tool results already provided.",
  'When citing PDF evidence, use only rangeId values already returned by read_pdf_text_range in empty blocks such as ::: citation {"rangeId":"r_7k9p2x4q"}\n:::.',
].join("\n");

export interface LlmChatResponse {
  provider: ProviderId;
  model: string;
  responseText: string;
  storedMessage: StoredMessage;
  thoughts: string[];
  citations: LlmCitation[];
  diagnostics?: LlmDiagnostics;
}

interface SendMessageOptions {
  provider?: ProviderId;
  modelName?: string;
  metadata?: ParentItemFileMetadata;
  policy?: Partial<LlmRequestPolicy>;
}

async function buildMessages(
  history: StoredMessage[],
  text: string,
  pdfContentBlocks: LangChainContentBlock[],
  citationContext?: string,
): Promise<BaseMessage[]> {
  const messages: BaseMessage[] = [];
  const systemPrompt = getPref(PREF_SYSTEM_PROMPT) as string | undefined;
  if (systemPrompt) {
    messages.push(new SystemMessage(systemPrompt));
  }
  const historyContext = await toLangChainMessagesForLlmContext(history);
  messages.push(...historyContext.messages);

  const contentBlocks = [
    ...pdfContentBlocks,
    ...(historyContext.previousPdfEvidenceContext
      ? [{ type: "text", text: historyContext.previousPdfEvidenceContext }]
      : []),
    ...(citationContext ? [{ type: "text", text: citationContext }] : []),
    { type: "text", text },
  ];
  messages.push(new HumanMessage({ contentBlocks: contentBlocks as any }));
  return messages;
}

function buildCitationAttachmentContext(
  metadata?: ParentItemFileMetadata,
): string | undefined {
  const files = (metadata?.files || []).filter(
    (file) => typeof file.libraryID === "number" && file.zoteroAttachmentKey,
  );
  if (files.length === 0) return undefined;
  const attachmentLines = files.map(
    (file) =>
      `- libraryID=${file.libraryID}, attachmentKey=${file.zoteroAttachmentKey}, fileName=${file.fileName}`,
  );
  return ["PDF citation tool attachment IDs:", ...attachmentLines].join("\n");
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

export async function invokeWithPdfCitationTools(
  chatModel: any,
  messages: BaseMessage[],
  invokeOptions: Record<string, unknown>,
  tools: any[],
  nativeTools: unknown[],
): Promise<{
  response: AIMessage;
  localToolCallCount: number;
  pdfCitationToolCalls: PdfCitationToolCallTrace[];
}> {
  if (tools.length === 0 || typeof chatModel.bindTools !== "function") {
    return {
      response: (await chatModel.invoke(messages, invokeOptions)) as AIMessage,
      localToolCallCount: 0,
      pdfCitationToolCalls: [],
    };
  }

  const { tools: _ignoredTools, ...invokeOptionsWithoutTools } = invokeOptions;
  const boundTools = [...tools, ...nativeTools];
  const toolByName = new Map(
    tools.map((candidate) => [candidate.name, candidate]),
  );
  const workingMessages = [...messages];
  let lastResponse: AIMessage | undefined;
  let toolCallCount = 0;
  const pdfCitationToolCalls: PdfCitationToolCallTrace[] = [];
  const maxRounds = 8;
  const maxToolCalls = 20;

  for (let round = 0; round < maxRounds; round++) {
    const toolChoice = "auto";
    const modelWithTools = chatModel.bindTools(boundTools, {
      tool_choice: toolChoice,
    });
    lastResponse = (await modelWithTools.invoke(
      workingMessages,
      invokeOptionsWithoutTools,
    )) as AIMessage;
    const toolCalls = Array.isArray((lastResponse as any).tool_calls)
      ? (lastResponse as any).tool_calls
      : [];
    Zotero.log(
      `[Ask My Paper] PDF citation tool round: round=${round + 1}, choice=${toolChoice}, localTools=${tools.length}, nativeTools=${nativeTools.length}, returnedCalls=${toolCalls.length}`,
    );
    if (toolCalls.length === 0) {
      if (toolCallCount > 0) {
        Zotero.debug(
          `[Ask My Paper] PDF citation tool loop completed: calls=${toolCallCount}, rounds=${round + 1}`,
        );
      }
      return {
        response: lastResponse,
        localToolCallCount: toolCallCount,
        pdfCitationToolCalls,
      };
    }

    workingMessages.push(lastResponse);
    for (const toolCall of toolCalls) {
      const toolName = String(toolCall.name || "");
      const toolCallId =
        typeof toolCall.id === "string"
          ? toolCall.id
          : `${toolName}-${round}-${toolCallCount}`;
      const selectedTool = toolByName.get(toolName);
      if (!selectedTool || toolCallCount >= maxToolCalls) {
        const errorMessage =
          toolCallCount >= maxToolCalls
            ? "PDF citation tool call limit reached."
            : `Unknown PDF citation tool: ${toolName}`;
        pdfCitationToolCalls.push(
          summarizePdfCitationToolCall({
            round: round + 1,
            toolName,
            args: toolCall.args || {},
            status: "error",
            error: errorMessage,
          }),
        );
        workingMessages.push(
          new ToolMessage({
            content: errorMessage,
            name: toolName,
            tool_call_id: toolCallId,
            status: "error",
          }),
        );
        continue;
      }

      toolCallCount++;
      try {
        const result = await selectedTool.invoke(toolCall.args || {});
        pdfCitationToolCalls.push(
          summarizePdfCitationToolCall({
            round: round + 1,
            toolName,
            args: toolCall.args || {},
            status: "success",
            result,
          }),
        );
        workingMessages.push(
          new ToolMessage({
            content:
              typeof result === "string" ? result : JSON.stringify(result),
            name: toolName,
            tool_call_id: toolCallId,
            status: "success",
          }),
        );
      } catch (error: any) {
        Zotero.logError(
          new Error(
            `[Ask My Paper] PDF citation tool failed: ${toolName}: ${error.message || String(error)}`,
          ),
        );
        pdfCitationToolCalls.push(
          summarizePdfCitationToolCall({
            round: round + 1,
            toolName,
            args: toolCall.args || {},
            status: "error",
            error,
          }),
        );
        workingMessages.push(
          new ToolMessage({
            content: `PDF citation tool failed: ${error.message || String(error)}`,
            name: toolName,
            tool_call_id: toolCallId,
            status: "error",
          }),
        );
      }
    }
  }

  Zotero.logError(
    new Error("[Ask My Paper] PDF citation tool loop reached max rounds."),
  );
  if (lastResponse) {
    workingMessages.push(new HumanMessage(PDF_CITATION_FINALIZATION_PROMPT));
    const finalResponse = (await chatModel.invoke(
      workingMessages,
      invokeOptionsWithoutTools,
    )) as AIMessage;
    Zotero.debug(
      `[Ask My Paper] PDF citation tool loop finalized after max rounds: calls=${toolCallCount}, rounds=${maxRounds}`,
    );
    return {
      response: finalResponse,
      localToolCallCount: toolCallCount,
      pdfCitationToolCalls,
    };
  }
  return {
    response: (await chatModel.invoke(messages, invokeOptions)) as AIMessage,
    localToolCallCount: toolCallCount,
    pdfCitationToolCalls,
  };
}

export async function sendMessageToLlm(
  history: StoredMessage[],
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
  const rangeRegistry = new PdfCitationRangeRegistry();
  const citationTools = (options.metadata?.files || []).some(
    (file) => typeof file.libraryID === "number",
  )
    ? createPdfCitationTools({ rangeRegistry })
    : [];
  const effectivePolicy =
    provider === "gemini" && citationTools.length > 0 && policy.useWebSearch
      ? { ...policy, useWebSearch: false }
      : policy;
  if (effectivePolicy !== policy) {
    Zotero.debug(
      "[Ask My Paper] Disabled Gemini web search for this request because PDF citation custom tools are enabled.",
    );
  }
  const chatModel = adapter.createModel(model, effectivePolicy);
  Zotero.log(
    `[Ask My Paper] PDF citation tools setup: tools=${citationTools.length}, bindTools=${typeof (chatModel as any).bindTools === "function"}, files=${options.metadata?.files?.length || 0}`,
  );
  const messages = await buildMessages(
    history,
    text,
    adapter.buildPdfContentBlocks(options.metadata),
    buildCitationAttachmentContext(options.metadata),
  );
  const invokeOptions = adapter.buildInvokeOptions(effectivePolicy);
  const nativeTools = adapter.buildNativeTools(effectivePolicy);
  const { response, localToolCallCount, pdfCitationToolCalls } =
    await invokeWithPdfCitationTools(
      chatModel,
      messages,
      invokeOptions,
      citationTools,
      nativeTools,
    );
  const thoughts = extractThoughts(response);
  let citationRenderProvider: string | undefined;
  let citationRenderModel: string | undefined;
  const normalizedCitations = await normalizePdfCitationBlocks(
    stripThoughtsFromText(extractText(response), thoughts),
    {
      allowCitationBlocks: citationTools.length === 0 || localToolCallCount > 0,
      pdfFiles: options.metadata?.files,
      rangeRegistry,
      renderDisplayText: async (input) => {
        const rendered = await renderPdfCitationDisplayText({
          rawText: input.rawText,
          pdfFile: input.pdfFile,
        });
        citationRenderProvider = rendered.provider;
        citationRenderModel = rendered.model;
        Zotero.log(
          `[Ask My Paper] PDF citation rendered: provider=${rendered.provider}, model=${rendered.model}, attachment=${input.locator.attachmentKey}, start=${input.locator.start}, end=${input.locator.end}`,
        );
        return rendered.displayText;
      },
    },
  );
  const responseText = normalizedCitations.text;
  const citations = extractCitations(provider, response);
  const diagnostics = adapter.buildDiagnostics(
    response,
    thoughts,
    effectivePolicy,
  );
  diagnostics.pdfCitationToolCallCount = localToolCallCount;
  diagnostics.pdfCitationToolCalls = pdfCitationToolCalls;
  diagnostics.pdfCitationCount = normalizedCitations.normalizedCount;
  diagnostics.pdfCitationDroppedCount = normalizedCitations.droppedCount;
  diagnostics.pdfCitationWarnings = normalizedCitations.warnings;
  diagnostics.citationRenderProvider = citationRenderProvider;
  diagnostics.citationRenderModel = citationRenderModel;
  const storedMessage = createAssistantStoredMessage(response, {
    provider,
    model,
    responseText: responseText || "No response.",
    thoughts,
    citations,
    diagnostics,
  });
  return {
    provider,
    model,
    responseText: responseText || "No response.",
    storedMessage,
    thoughts,
    citations,
    diagnostics,
  };
}
