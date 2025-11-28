import { ChatSessionHistory } from "../../types/chat";
import { ConversationManager } from "./conversation";
import { ChatSession } from "./chatSession";

/**
 * Manages a collection of ChatSession instances for a Zotero item.
 * It handles loading, creating, deleting, and switching between chat sessions.
 */
export class ChatSessionManager {
  private parentItem: Zotero.Item;
  private _sessions: ChatSession[] = [];
  private _activeSession: ChatSession | null = null;
  private onActiveSessionChange: (session: ChatSession | null) => void;

  constructor(
    parentItem: Zotero.Item,
    onActiveSessionChange: (session: ChatSession | null) => void
  ) {
    this.parentItem = parentItem;
    this.onActiveSessionChange = onActiveSessionChange;
  }

  /**
   * Loads all chat sessions from storage, initializes them as ChatSession instances,
   * and sets the most recent one as active.
   */
  async init(): Promise<void> {
    let allHistories: ChatSessionHistory[] = [];
    try {
      allHistories = await ConversationManager.getAllConversations(
        this.parentItem
      );
      this._sessions = allHistories.map(
        (history) => new ChatSession(history, this.parentItem)
      );

      // Trigger title generation for sessions that need it
      this._sessions.forEach((session) => {
        if (
          !session.history.metadata.isTitleGenerated &&
          session.history.history.length >= 2
        ) {
          // Don't await, let it run in the background
          session.generateTitle();
        }
      });
    } catch (e: any) {
      Zotero.logError(
        new Error(`Error loading all conversations: ${e.message || String(e)}`)
      );
      this._sessions = []; // Continue with an empty list on error
    }

    if (this._sessions.length === 0) {
      // If no sessions exist, create a new default one
      this._activeSession = await this.createSession("新しいチャット 1", false);
    } else {
      // Set the most recent session as active
      const latestSession = this._sessions.sort((a, b) => {
        const dateA =
          a.history.history.length > 0
            ? new Date(a.history.history[a.history.history.length - 1].timestamp)
            : new Date(0);
        const dateB =
          b.history.history.length > 0
            ? new Date(b.history.history[b.history.history.length - 1].timestamp)
            : new Date(0);
        return dateB.getTime() - dateA.getTime();
      })[0];
      this._activeSession = latestSession;
    }

    this.onActiveSessionChange(this._activeSession);

    Zotero.debug(
      `[ChatSessionManager] Initialized with active session: ${this._activeSession?.id}`
    );
  }

  /**
   * Switches the active session to the one with the given ID.
   * @param chatId The ID of the session to activate.
   */
  switchSession(chatId: string): ChatSession | null {
    const sessionToActivate = this.getSessionById(chatId);
    if (sessionToActivate) {
      this._activeSession = sessionToActivate;
      this.onActiveSessionChange(this._activeSession);
      Zotero.debug(`[ChatSessionManager] Switched active session to: ${chatId}`);
      return this._activeSession;
    }
    Zotero.logError(
      new Error(
        `[ChatSessionManager] Could not find session with ID: ${chatId} to switch to.`
      )
    );
    return null;
  }

  /**
   * Returns the currently active chat session.
   */
  getActiveSession(): ChatSession | null {
    return this._activeSession;
  }

  /**
   * Returns a list of all managed chat sessions.
   */
  getAllSessions(): ChatSession[] {
    return this._sessions;
  }

  /**
   * Finds and returns a session by its ID.
   * @param chatId The ID of the session to find.
   */
  getSessionById(chatId: string): ChatSession | undefined {
    return this._sessions.find((session) => session.id === chatId);
  }

  /**
   * Creates a new chat session, saves it, and sets it as the active session.
   * @param title The title for the new session.
   * @param setActive Whether to set the new session as active.
   */
  async createSession(
    title: string,
    setActive: boolean = true
  ): Promise<ChatSession> {
    const newChatId = Zotero.Utilities.randomString(10);
    const newHistory: ChatSessionHistory = {
      metadata: {
        zoteroParentItemKey: this.parentItem.key,
        chatId: newChatId,
        chatTitle: title,
        isTitleGenerated: false,
      },
      history: [],
    };

    const newSession = new ChatSession(newHistory, this.parentItem);
    this._sessions.push(newSession);

    if (setActive) {
      this._activeSession = newSession;
      this.onActiveSessionChange(newSession);
    }
    await newSession.save();
    Zotero.debug(
      `[ChatSessionManager] Created new session: ${title} (${newChatId})`
    );
    return newSession;
  }

  /**
   * Deletes the currently active chat session and activates the next available one.
   */
  async deleteActiveSession(): Promise<boolean> {
    if (!this._activeSession) {
      Zotero.logError(
        new Error("[ChatSessionManager] No active session to delete.")
      );
      return false;
    }

    const chatIdToDelete = this._activeSession.id;

    try {
      await ConversationManager.deleteConversation(
        this.parentItem,
        chatIdToDelete
      );
      this._sessions = this._sessions.filter(
        (session) => session.id !== chatIdToDelete
      );
      Zotero.debug(
        `[ChatSessionManager] Deleted session with ID: ${chatIdToDelete}`
      );

      // Activate another session or create a new one
      if (this._sessions.length > 0) {
        this._activeSession = this._sessions[0]; // Activate the first one
      } else {
        this._activeSession = await this.createSession("新しいチャット 1", false);
      }

      this.onActiveSessionChange(this._activeSession);
      return true;
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ChatSessionManager] Error deleting active session ${chatIdToDelete}: ${
            e.message || String(e)
          }`
        )
      );
      return false;
    }
  }
}
