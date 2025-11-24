import { ChatSessionHistory } from "../../types/chat";
import { ConversationManager } from "./conversation";

/**
 * Zoteroアイテムに紐付くチャットセッションのリストとアクティブなセッションを管理するクラス。
 */
export class ChatSessionManager {
  private parentItem: Zotero.Item;
  private _sessions: ChatSessionHistory[] = [];
  private _activeSession: ChatSessionHistory | null = null;
  private onActiveSessionChange: (session: ChatSessionHistory) => void;

  constructor(parentItem: Zotero.Item, onActiveSessionChange: (session: ChatSessionHistory) => void) {
    this.parentItem = parentItem;
    this.onActiveSessionChange = onActiveSessionChange;
  }

  /**
   * Zoteroアイテムから全てのチャットセッションをロードし、初期化します。
   * セッションが存在しない場合は新しいデフォルトセッションを作成します。
   */
  async init(): Promise<void> {
    let allConversations: ChatSessionHistory[] = [];
    try {
      allConversations = await ConversationManager.getAllConversations(this.parentItem);
      this._sessions = allConversations;
    } catch (e: any) {
      Zotero.logError(new Error(`Error loading all conversations: ${e.message || String(e)}`));
      this._sessions = []; // エラー時も空のリストで続行
    }

    if (this._sessions.length === 0) {
      // 会話が存在しない場合、新しいデフォルトセッションを作成しアクティブにする
      const newChatId = Zotero.Utilities.randomString(10);
      const newChatTitle = "新しいチャット 1"; // デフォルトタイトル
      const defaultConversation: ChatSessionHistory = {
        metadata: {
          zoteroParentItemKey: this.parentItem.key,
          chatId: newChatId,
          chatTitle: newChatTitle,
        },
        history: [],
      };
      this._sessions.push(defaultConversation);
      this._activeSession = defaultConversation;
      // 新しいデフォルトセッションをZoteroアタッチメントとして保存
      await ConversationManager.saveConversation(this.parentItem, defaultConversation);
    } else {
      // ロードされたセッションがある場合、最も新しいセッションをアクティブにする
      const latestConversation = this._sessions.sort((a, b) => {
        // Assuming last message timestamp or creation timestamp in metadata
        const dateA = a.history.length > 0 ? new Date(a.history[a.history.length - 1].timestamp) : new Date(0);
        const dateB = b.history.length > 0 ? new Date(b.history[b.history.length - 1].timestamp) : new Date(0);
        return dateB.getTime() - dateA.getTime();
      })[0];
      this._activeSession = latestConversation;
    }
    if (this._activeSession) {
      this.onActiveSessionChange(this._activeSession);
    }
    Zotero.debug(`[ChatSessionManager] Initialized with active session: ${this._activeSession?.metadata.chatId}`);
  }

  /**
   * Switches the active session to the one with the given ID.
   * @param chatId The ID of the session to switch to.
   */
  switchSession(chatId: string): ChatSessionHistory | null {
    const sessionToActivate = this.getSessionById(chatId);
    if (sessionToActivate) {
      this._activeSession = sessionToActivate;
      this.onActiveSessionChange(this._activeSession);
      Zotero.debug(`[ChatSessionManager] Switched active session to: ${chatId}`);
      return this._activeSession;
    }
    Zotero.logError(new Error(`[ChatSessionManager] Could not find session with ID: ${chatId} to switch to.`));
    return null;
  }

  /**
   * 現在アクティブなチャットセッションを取得します。
   */
  getActiveSession(): ChatSessionHistory | null {
    return this._activeSession;
  }

  /**
   * 管理しているすべてのチャットセッションのリストを取得します。
   */
  getAllSessions(): ChatSessionHistory[] {
    return this._sessions;
  }

  /**
   * 指定されたチャットIDのセッションを検索して返します。
   */
  getSessionById(chatId: string): ChatSessionHistory | undefined {
    return this._sessions.find(session => session.metadata.chatId === chatId);
  }

  /**
   * 新しいチャットセッションを作成し、アクティブセッションに設定します。
   * @param title 新しいセッションのタイトル
   */
  async createSession(title: string): Promise<ChatSessionHistory> {
    const newChatId = Zotero.Utilities.randomString(10);
    const newConversation: ChatSessionHistory = {
      metadata: {
        zoteroParentItemKey: this.parentItem.key,
        chatId: newChatId,
        chatTitle: title,
      },
      history: [],
    };
    this._sessions.push(newConversation);
    this._activeSession = newConversation;
    this.onActiveSessionChange(newConversation);
    await ConversationManager.saveConversation(this.parentItem, newConversation);
    Zotero.debug(`[ChatSessionManager] Created new session: ${title} (${newChatId})`);
    return newConversation;
  }

  /**
   * 現在のセッションの履歴をZoteroアタッチメントに保存します。
   * (ConversationManagerに委譲)
   */
  async saveActiveSession(): Promise<void> {
    if (this._activeSession) {
      await ConversationManager.saveConversation(this.parentItem, this._activeSession);
    }
  }

  // TODO: switchSession, deleteSession, updateSessionTitle などのメソッドを追加
}
