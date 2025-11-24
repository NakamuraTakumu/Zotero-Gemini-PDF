// gemini-pdf/src/types/chat.d.ts

// gemini-pdf/src/types/chat.d.ts

import { ChatSessionManager } from "../modules/reader/chatSessionManager"; // ChatSessionManager をインポート

/**
 * Zotero親アイテムに添付されたGemini File API関連のPDF添付ファイルすべての情報を管理するJSONのインターフェース
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
  geminiFileUri: string;
  fileName: string;
  lastUploadTimestamp: string; // ISO 8601 format
}

/**
 * チャットセッション履歴のメタデータ
 */
export interface ChatSessionHistoryMetadata {
  zoteroParentItemKey: string;
  chatId: string;
  chatTitle: string;
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
  parts: { text: string }[];
  groundingMetadata?: any;
}

// ============================================================================
// New ChatPaneState Interface for refactoring
// ============================================================================

import { ChatManager } from "../modules/reader/chat";
import { UIManager } from "../modules/reader/ui";

/**
 * 各チャットペインの状態を管理するためのインターフェース
 *addon.data.chatPanes[paneId]に格納される情報の構造を定義する
 */
export interface ChatPaneState {
  paneId: string;

  // UI/DOM関連の要素
  uiElements: {
    doc: Document;
    body: HTMLElement;
  };

  // ペイン固有のロジックインスタンス
  managers: {
    chatManager: ChatManager;
    uiManager: UIManager;
  };

  // ChatSessionManager インスタンス
  chatSessionManager?: ChatSessionManager;

  // Zoteroアイテムに関するコンテキスト情報
  zoteroContext: {
    itemId?: number;
    actualParentItem?: Zotero.Item | null;
  };

  // チャットセッション固有のデータ
  chatData: {
    currentConversation?: ChatSessionHistory | null;
    parentItemFileMetadata?: ParentItemFileMetadata | null;
  };

  // ランタイムの状態と制御フラグ
  runtimeState: {
    eventHandler?: (event: CustomEvent) => void;
    isGeminiRequestInProgress?: boolean;
  };
}

// ============================================================================
// Old Interfaces - Keep temporarily for backward compatibility if needed
// These will be removed once all code is migrated to new interfaces
// ============================================================================

/**
 * 現在のコードベースでConversationManagerが利用している会話の型定義
 * 新しいChatSessionHistoryへの移行を考慮し、一時的に残す
 */
export interface Conversation {
  metadata: {
    version: string;
    zoteroParentItemKey: string;
    files: ConversationFile[];
    lastUploadTimestamp: string; // ISO 8601 format
  };
  history: ConversationHistoryItem[];
}

/**
 * 現在のコードベースでConversationManagerが利用しているConversationFileの型定義
 * 新しいParentItemFileMetadataFileへの移行を考慮し、一時的に残す
 */
export interface ConversationFile {
  zoteroAttachmentKey: string;
  geminiFileUri: string;
  geminiFileName: string;
  fileName: string;
}

/**
 * 現在のコードベースでConversationManagerが利用しているConversationHistoryItemの型定義
 * 新しいChatMessageへの移行を考慮し、一時的に残す
 */
export interface ConversationHistoryItem {
  timestamp: string; // ISO 8601 format
  role: "user" | "model";
  model?: string; // Only for role: "model"
  parts: { text: string }[];
  groundingMetadata?: any;
}

