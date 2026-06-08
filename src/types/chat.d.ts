import type { StoredMessage } from "@langchain/core/messages";

export type ProviderId = "gemini" | "openai" | "anthropic";
export type ReasoningMode = "off" | "low" | "medium" | "high";

export type ProviderPdfUploadRef =
  | { provider: "gemini"; fileUri: string; uploadedAt: string }
  | { provider: "openai"; fileId: string; uploadedAt: string }
  | { provider: "anthropic"; fileId: string; uploadedAt: string };

/**
 * チャットセッション履歴のメタデータ
 */
export interface ChatSessionHistoryMetadata {
  zoteroParentItemKey: string;
  chatId: string;
  chatTitle: string;
  isTitleGenerated: boolean;
  createdTimestamp: string; // ISO 8601 format
  updatedTimestamp: string; // ISO 8601 format
}

/**
 * 個々のチャットセッション履歴の全体構造
 */
export interface ChatSessionHistory {
  schemaVersion: 2;
  metadata: ChatSessionHistoryMetadata;
  messages: StoredMessage[];
}

/**
 * Zotero親アイテムに添付されたAsk My Paper用集約JSONのインターフェース
 */
export interface ParentItemFileMetadata {
  zoteroParentItemKey: string;
  files: ParentItemFileMetadataFile[];
  chatSessions: ChatSessionHistory[];
}

/**
 * ParentItemFileMetadata内の各ファイルの情報
 */
export interface ParentItemFileMetadataFile {
  libraryID?: number;
  zoteroAttachmentKey: string;
  fileName: string;
  lastModified?: number;
  uploads: ProviderPdfUploadRef[];
}

export interface LlmCitation {
  title: string;
  url?: string;
  quote?: string;
  provider?: ProviderId;
}

export interface LlmDiagnostics {
  searchRequested: boolean;
  searchUsed: boolean;
  thinkingRequested: boolean;
  thinkingUsed: boolean;
  thoughtCount: number;
  groundingChunkCount?: number;
  webSearchQueryCount?: number;
  responseOutputTypes?: string[];
  contentBlockTypes?: string[];
  webSearchCallCount?: number;
  reasoningItemCount?: number;
  reasoningTokenCount?: number;
  anthropicContentTypes?: string[];
  anthropicServerToolUseCount?: number;
  anthropicWebSearchResultCount?: number;
  anthropicWebSearchRequestCount?: number;
  pdfCitationToolCallCount?: number;
  pdfCitationCount?: number;
  pdfCitationDroppedCount?: number;
  pdfCitationWarnings?: string[];
  citationRenderProvider?: string;
  citationRenderModel?: string;
}

export interface AskMyPaperMessageMetadata {
  timestamp: string;
  provider?: ProviderId;
  model?: string;
  thoughts?: string[];
  citations?: LlmCitation[];
  llmDiagnostics?: LlmDiagnostics;
}
