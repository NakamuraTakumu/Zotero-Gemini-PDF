// gemini-pdf/src/types/chat.d.ts

/**
 * Represents the overall structure of a conversation file.
 */
export interface Conversation {
  metadata: ConversationMetadata;
  history: ConversationHistoryItem[];
}

/**
 * Metadata for the conversation, linking it to Zotero items and Gemini files.
 */
export interface ConversationMetadata {
  version: string;
  zoteroParentItemKey: string;
  files: ConversationFile[];
  lastUploadTimestamp: string; // ISO 8601 format
}

/**
 * Represents a single file used as context in the conversation.
 */
export interface ConversationFile {
  zoteroAttachmentKey: string;
  geminiFileUri: string;
  geminiFileName: string;
  fileName: string;
}

/**
 * Represents a single message entry in the conversation history.
 */
export interface ConversationHistoryItem {
  sequence: number;
  timestamp: string; // ISO 8601 format
  role: "user" | "model";
  model?: string; // Only for role: "model"
  parts: { text: string }[];
  groundingMetadata?: any;
}
