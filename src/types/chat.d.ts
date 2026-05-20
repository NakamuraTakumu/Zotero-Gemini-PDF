export type ProviderId = "gemini" | "openai" | "anthropic";
export type ReasoningMode = "off" | "low" | "medium" | "high";

export type ProviderPdfUploadRef =
  | { provider: "gemini"; fileUri: string; uploadedAt: string }
  | { provider: "openai"; fileId: string; uploadedAt: string }
  | { provider: "anthropic"; fileId: string; uploadedAt: string };

/**
 * Zotero親アイテムに添付されたprovider別PDF upload情報を管理するJSONのインターフェース
 */
export interface ParentItemFileMetadata {
  zoteroParentItemKey: string;
  files: ParentItemFileMetadataFile[];
}

/**
 * ParentItemFileMetadata内の各ファイルの情報
 */
export interface ParentItemFileMetadataFile {
  zoteroAttachmentKey: string;
  fileName: string;
  lastModified?: number;
  uploads: ProviderPdfUploadRef[];
}

/**
 * チャットセッション履歴のメタデータ
 */
export interface ChatSessionHistoryMetadata {
  zoteroParentItemKey: string;
  chatId: string;
  chatTitle: string;
  isTitleGenerated: boolean;
  createdTimestamp: string; // ISO 8601 format
}

/**
 * 個々のチャットセッション履歴の全体構造
 */
export interface ChatSessionHistory {
  metadata: ChatSessionHistoryMetadata;
  history: ChatMessage[];
}

/**
 * 会話内の個々のメッセージエントリ
 */
export interface ChatMessage {
  timestamp: string; // ISO 8601 format
  role: "user" | "model";
  model?: string; // modelロールの場合のみ
  provider?: ProviderId; // modelロールの場合のみ
  parts: { text: string }[];
  thoughts?: string[];
  citations?: LlmCitation[];
  groundingMetadata?: any;
  llmDiagnostics?: LlmDiagnostics;
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
}
