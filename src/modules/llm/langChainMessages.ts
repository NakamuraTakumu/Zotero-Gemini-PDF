import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  StoredMessage,
  SystemMessage,
  mapStoredMessageToChatMessage,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
import {
  AskMyPaperMessageMetadata,
  LlmCitation,
  LlmDiagnostics,
  ProviderId,
} from "../../types/chat";
import { stripThoughtsFromText } from "../../utils/thoughts";
import {
  PdfTextLocator,
  findPdfCitationBlocks,
  formatPdfCitationSource,
  parsePdfCitationLocator,
  recoverPdfCitationText,
} from "../pdfCitation";

export const ASK_MY_PAPER_MESSAGE_METADATA_KEY = "askMyPaper";

export interface StoredMessageView {
  message: BaseMessage;
  role: "user" | "assistant" | "system" | "tool" | "other";
  text: string;
  displayText: string;
  metadata: Partial<AskMyPaperMessageMetadata>;
}

export interface PreviousPdfEvidence {
  evidenceId: string;
  source: string;
  evidenceText: string;
  isStale?: boolean;
}

interface LlmContextMessageOptions {
  maxPreviousPdfEvidence?: number;
  recoverPdfEvidenceText?: (locator: PdfTextLocator) => Promise<{
    text: string;
    isStale?: boolean;
  }>;
  formatPdfEvidenceSource?: (locator: PdfTextLocator) => string;
}

export function toLangChainMessages(messages: StoredMessage[]): BaseMessage[] {
  return mapStoredMessagesToChatMessages(messages);
}

export async function toLangChainMessagesForLlmContext(
  messages: StoredMessage[],
  options: LlmContextMessageOptions = {},
): Promise<{
  messages: BaseMessage[];
  previousPdfEvidenceContext?: string;
  previousPdfEvidence: PreviousPdfEvidence[];
}> {
  const previousPdfEvidence: PreviousPdfEvidence[] = [];
  const maxPreviousPdfEvidence = options.maxPreviousPdfEvidence ?? 12;
  const converted: BaseMessage[] = [];
  for (const stored of messages) {
    const message = toLangChainMessage(stored);
    const text = getMessageText(message);
    if (!text || !/:::\s*citation/i.test(text)) {
      converted.push(
        message.type === "ai" ? cloneTextMessage(message, text) : message,
      );
      continue;
    }
    const { text: sanitizedText } = await replacePdfCitationBlocksForLlm(
      text,
      previousPdfEvidence,
      maxPreviousPdfEvidence,
      options,
    );
    converted.push(cloneTextMessage(message, sanitizedText));
  }
  return {
    messages: converted,
    previousPdfEvidence,
    previousPdfEvidenceContext:
      previousPdfEvidence.length > 0
        ? formatPreviousPdfEvidenceContext(previousPdfEvidence)
        : undefined,
  };
}

export function toLangChainMessage(message: StoredMessage): BaseMessage {
  return mapStoredMessageToChatMessage(message);
}

export function createUserStoredMessage(text: string): StoredMessage {
  return new HumanMessage({
    content: text,
    response_metadata: {
      [ASK_MY_PAPER_MESSAGE_METADATA_KEY]: {
        timestamp: new Date().toISOString(),
      },
    },
  }).toDict();
}

export function createAssistantStoredMessage(
  response: AIMessage,
  args: {
    provider: ProviderId;
    model: string;
    responseText: string;
    thoughts: string[];
    citations: LlmCitation[];
    diagnostics?: LlmDiagnostics;
  },
): StoredMessage {
  const metadata: AskMyPaperMessageMetadata = {
    timestamp: new Date().toISOString(),
    provider: args.provider,
    model: args.model,
    thoughts: args.thoughts,
    citations: args.citations,
    llmDiagnostics: args.diagnostics,
  };
  return new AIMessage({
    id: response.id,
    name: response.name,
    content: args.responseText,
    additional_kwargs: response.additional_kwargs,
    response_metadata: {
      ...response.response_metadata,
      provider: args.provider,
      model: args.model,
      model_name: args.model,
      [ASK_MY_PAPER_MESSAGE_METADATA_KEY]: metadata,
    },
    tool_calls: response.tool_calls,
    invalid_tool_calls: response.invalid_tool_calls,
    usage_metadata: response.usage_metadata,
  } as any).toDict();
}

export function getMessageMetadata(
  message: BaseMessage,
): Partial<AskMyPaperMessageMetadata> {
  const metadata = (message.response_metadata as any)?.[
    ASK_MY_PAPER_MESSAGE_METADATA_KEY
  ];
  return metadata && typeof metadata === "object" ? metadata : {};
}

export function getMessageText(message: BaseMessage): string {
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
  return (message as any).text || "";
}

async function replacePdfCitationBlocksForLlm(
  text: string,
  previousPdfEvidence: PreviousPdfEvidence[],
  maxPreviousPdfEvidence: number,
  options: LlmContextMessageOptions,
): Promise<{ text: string }> {
  const replacements: Array<{ from: string; to: string }> = [];
  for (const block of findPdfCitationBlocks(text)) {
    const locator = parsePdfCitationLocator(block.rawJson);
    if (!locator || previousPdfEvidence.length >= maxPreviousPdfEvidence) {
      replacements.push({ from: block.fullBlock, to: "" });
      continue;
    }
    try {
      const recovered = await (
        options.recoverPdfEvidenceText || recoverPdfCitationText
      )(locator);
      const evidenceText = recovered.text.trim();
      if (!evidenceText) {
        replacements.push({ from: block.fullBlock, to: "" });
        continue;
      }
      const evidenceId = `e_${previousPdfEvidence.length + 1}`;
      previousPdfEvidence.push({
        evidenceId,
        source: (options.formatPdfEvidenceSource || formatPdfCitationSource)(
          locator,
        ),
        evidenceText,
        ...(recovered.isStale ? { isStale: true } : {}),
      });
      replacements.push({
        from: block.fullBlock,
        to: `[Previous PDF evidence: ${evidenceId}]`,
      });
    } catch (_error) {
      Zotero.logError(
        new Error("[Ask My Paper] Failed to adapt PDF citation history."),
      );
      replacements.push({ from: block.fullBlock, to: "" });
    }
  }
  return {
    text: replacements.reduce(
      (current, replacement) =>
        current.replace(replacement.from, replacement.to),
      text,
    ),
  };
}

function formatPreviousPdfEvidenceContext(
  evidence: PreviousPdfEvidence[],
): string {
  const lines = ["Previous PDF evidence:"];
  for (const item of evidence) {
    lines.push(
      `- evidenceId: ${item.evidenceId}`,
      `  source: ${item.source}`,
      `  evidenceText: ${JSON.stringify(item.evidenceText)}`,
      ...(item.isStale ? ["  note: textVersion changed since citation"] : []),
    );
  }
  return lines.join("\n");
}

function cloneTextMessage(message: BaseMessage, content: string): BaseMessage {
  switch (message.type) {
    case "ai":
      return new AIMessage({ content });
    case "human":
      return new HumanMessage({
        content,
        response_metadata: message.response_metadata,
      });
    case "system":
      return new SystemMessage({
        content,
        response_metadata: message.response_metadata,
      });
    default:
      return message;
  }
}

export function toStoredMessageView(stored: StoredMessage): StoredMessageView {
  const message = toLangChainMessage(stored);
  const metadata = getMessageMetadata(message);
  const text = getMessageText(message);
  const role = toViewRole(message);
  return {
    message,
    role,
    text,
    displayText:
      role === "assistant"
        ? stripThoughtsFromText(text, metadata.thoughts)
        : text,
    metadata,
  };
}

function toViewRole(
  message: BaseMessage,
): "user" | "assistant" | "system" | "tool" | "other" {
  switch (message.type) {
    case "human":
      return "user";
    case "ai":
      return "assistant";
    case "system":
      return "system";
    case "tool":
      return "tool";
    default:
      return "other";
  }
}
