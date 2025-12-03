/// <reference path="../globalChatManager.ts" />
import GlobalChatManager from "../globalChatManager";
import { ChatSession } from "./chatSession";
import { ParentItemFileMetadata } from "../../types/chat";

/**
 * Manages a collection of ChatSession instances for a Zotero item.
 * It handles loading, creating, deleting, and switching between chat sessions.
 */
export class ChatSessionManager {
  private parentItem: Zotero.Item;
  private _itemKey: string;
  private _activeSessionId: string | null = null; // Stores only the active session ID
  private globalChatManager: GlobalChatManager;

  private rerenderChatMessages: (session: ChatSession | null) => void;
  private rerenderSwitcher: () => void;

  constructor(
    parentItem: Zotero.Item,
    globalChatManager: GlobalChatManager,
    callbacks: {
      rerenderChatMessages: (session: ChatSession | null) => void;
      rerenderSwitcher: () => void;
    },
  ) {
    this.parentItem = parentItem;
    this._itemKey = parentItem.key;
    this.globalChatManager = globalChatManager;
    this.rerenderChatMessages = callbacks.rerenderChatMessages;
    this.rerenderSwitcher = callbacks.rerenderSwitcher;
  }

  /**
   * Loads all chat sessions from storage, initializes them as ChatSession instances,
   * and sets the most recent one as active.
   */
  async init(): Promise<void> {
    try {
      // Load sessions, but don't store locally. They will be fetched from globalChatManager on demand.
      // This call ensures the globalChatManager has the sessions loaded for this item.
      await this.globalChatManager.loadSessionsForItem(
        this.parentItem,
      );
      // No need to call _triggerTitleGenerationForAllSessions here directly,
      // as generateTitle will be called by ChatSession after first exchange,
      // and global event handler will update UI.
    } catch (e: any) {
      Zotero.logError(
        new Error(`Error loading all conversations: ${e.message || String(e)}`),
      );
    }

    await this._initializeActiveSession();

    if (this._activeSessionId) {
      this.switchSession(this._activeSessionId);
    }

    // Subscribe to global chat manager events
    this.globalChatManager.on(
      "session-added",
      this._handleGlobalSessionAdded,
    );
    this.globalChatManager.on(
      "session-deleted",
      this._handleGlobalSessionDeleted,
    );
    this.globalChatManager.on(
      "session-updated",
      this._handleGlobalSessionUpdated,
    );

    Zotero.debug(
      `[ChatSessionManager] Initialized with active session: ${this._activeSessionId}`,
    );
  }

  /**
   * Unsubscribes from global events. Call this when the pane is destroyed.
   */
  public destroy(): void {
    this.globalChatManager.off(
      "session-added",
      this._handleGlobalSessionAdded,
    );
    this.globalChatManager.off(
      "session-deleted",
      this._handleGlobalSessionDeleted,
    );
    this.globalChatManager.off(
      "session-updated",
      this._handleGlobalSessionUpdated,
    );
  }

  private _handleGlobalSessionAdded = (event: {
    itemKey: string;
    session: ChatSession;
  }) => {
    if (event.itemKey === this._itemKey) {
      Zotero.debug(`[ChatSessionManager] _handleGlobalSessionAdded: Session ${event.session.id} ("${event.session.title}") added.`);
      // If no active session, make the newly added one active
      if (!this._activeSessionId) {
        this.switchSession(event.session.id);
      }
      this.rerenderSwitcher(); // Rerender switcher to show new session
    }
  };

  private _handleGlobalSessionDeleted = (event: {
    itemKey: string;
    sessionId: string;
  }) => {
    if (event.itemKey === this._itemKey) {
      Zotero.debug(`[ChatSessionManager] _handleGlobalSessionDeleted: Session ${event.sessionId} deleted.`);
      this.rerenderSwitcher();
      // If the active session was deleted, switch to another or create a new one
      if (this._activeSessionId === event.sessionId) {
        const remainingSessions = this.globalChatManager.getAllSessions(this._itemKey);
        if (remainingSessions.length > 0) {
          this.switchSession(remainingSessions[0].id);
        }
        else {
          void this.createSession(); // createSession handles switching
        }
      }
    }
  };

  private _handleGlobalSessionUpdated = (event: {
    itemKey: string;
    session: ChatSession;
  }) => {
    if (event.itemKey === this._itemKey) {
      Zotero.debug(`[ChatSessionManager] _handleGlobalSessionUpdated: Session ${event.session.id} ("${event.session.title}") updated.`);
      const allSessions = this.getAllSessions();
      Zotero.debug(`[ChatSessionManager] _handleGlobalSessionUpdated: All sessions for item ${this._itemKey}: ${allSessions.map(s => `"${s.title}"`).join(', ')}`);

      // If the updated session is the active one, re-render chat messages
      if (this._activeSessionId === event.session.id) {
        this.rerenderChatMessages(event.session);
      }
      this.rerenderSwitcher(); // Rerender switcher just in case title or other metadata changed
    }
  };

  private async _initializeActiveSession(): Promise<void> {
    const sessions = this.globalChatManager.getAllSessions(this._itemKey);
    if (sessions.length === 0) {
      // If no sessions exist, create a new default one
      const newSession = await this.createSession();
      this._activeSessionId = newSession.id;
    } else {
      // Otherwise, find the most recent session and activate it.
      const latestSession = sessions.sort((a, b) => {
        const dateA = new Date(a.history.metadata.createdTimestamp);
        const dateB = new Date(b.history.metadata.createdTimestamp);
        return dateB.getTime() - dateA.getTime();
      })[0];
      this._activeSessionId = latestSession.id;
    }
  }

  /**
   * Switches the active session to the one with the given ID.
   * @param chatId The ID of the session to activate.
   */
  switchSession(chatId: string): ChatSession | null {
    const sessionToActivate = this.getSessionById(chatId);
    if (sessionToActivate) {
      this._activeSessionId = chatId; // Update local active session ID
      this.rerenderChatMessages(sessionToActivate);
      this.rerenderSwitcher();
      Zotero.debug(
        `[ChatSessionManager] Switched active session to: ${chatId}`,
      );
      return sessionToActivate;
    }
    Zotero.logError(
      new Error(
        `[ChatSessionManager] Could not find session with ID: ${chatId} to switch to.`,
      ),
    );
    return null;
  }

  /**
   * Returns the currently active chat session.
   */
  getActiveSession(): ChatSession | null {
    if (!this._activeSessionId) {
      return null;
    }
    const activeSession = this.globalChatManager.getAllSessions(this._itemKey).find(s => s.id === this._activeSessionId);
    Zotero.log(`[Gemini PDF] ChatSessionManager.getActiveSession: Returning session ID: ${activeSession?.id}, Title: "${activeSession?.title}"`);
    return activeSession || null;
  }

  /**
   * Returns a list of all managed chat sessions.
   */
  getAllSessions(): ChatSession[] {
    return this.globalChatManager.getAllSessions(this._itemKey);
  }

  /**
   * Finds and returns a session by its ID.
   * @param chatId The ID of the session to find.
   */
  getSessionById(chatId: string): ChatSession | undefined {
    return this.globalChatManager.getAllSessions(this._itemKey).find((session) => session.id === chatId);
  }

  /**
   * Creates a new chat session, saves it, and sets it as the active session.
   */
  async createSession(): Promise<ChatSession> {
    const newSession = await this.globalChatManager.createSession(
      this.parentItem,
    );
    // The global event handler _handleGlobalSessionAdded will update _activeSessionId and rerender.
    return newSession;
  }

  /**
   * Deletes the currently active chat session and activates the next available one.
   */
  async deleteActiveSession(): Promise<boolean> {
    const activeSession = this.getActiveSession();
    if (!activeSession) {
      Zotero.logError(
        new Error("[ChatSessionManager] No active session to delete."),
      );
      return false;
    }

    const chatIdToDelete = activeSession.id;

    try {
      await this.globalChatManager.deleteSession(activeSession);
      // The global event handler _handleGlobalSessionDeleted will update _activeSessionId and rerender.
      return true;
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ChatSessionManager] Error deleting active session ${chatIdToDelete}: ${
            e.message || String(e)
          }`,
        ),
      );
      return false;
    }
  }

  /**
   * Processes a user's message, sends it to the Gemini API, and updates the history.
   * @param textForApi The text to be sent to the API.
   * @param parentItemFileMetadata The metadata of synced PDF files.
   * @returns The model's response text.
   */
  public async sendMessage(
    textForApi: string,
    parentItemFileMetadata: ParentItemFileMetadata,
  ): Promise<{
    responseText: string;
    thoughts?: string[];
    groundingMetadata?: any;
  }> {
    const activeSession = this.getActiveSession(); // Get active session on demand
    if (!activeSession) {
      throw new Error("No active session to send message to.");
    }

    // Add user message to UI immediately for responsiveness
    // This part is in ChatPane's _handleSendMessage
    // activeSession.addUserMessage(textForApi); // This is handled in ChatPane and ChatSession's sendMessage

    const result = await activeSession.sendMessage(
      textForApi,
      parentItemFileMetadata,
    );
    await this.globalChatManager.saveSession(activeSession); // Save changes after message exchange
    // The global event handler _handleGlobalSessionUpdated will trigger rerenderChatMessages
    return result;
  }
}

