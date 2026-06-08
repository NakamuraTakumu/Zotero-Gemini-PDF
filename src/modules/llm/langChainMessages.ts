import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  StoredMessage,
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

export const ASK_MY_PAPER_MESSAGE_METADATA_KEY = "askMyPaper";

export interface StoredMessageView {
  message: BaseMessage;
  role: "user" | "assistant" | "system" | "tool" | "other";
  text: string;
  displayText: string;
  metadata: Partial<AskMyPaperMessageMetadata>;
}

export function toLangChainMessages(messages: StoredMessage[]): BaseMessage[] {
  return mapStoredMessagesToChatMessages(messages);
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
