import { ChatSession } from "./reader/chatSession";
import { ChatSessionRepository } from "./reader/chatSessionRepository";
import EventEmitter from "../utils/eventEmitter";

type GlobalChatManagerEvents = {
  "sessions-loaded": [{ itemKey: string; sessions: ChatSession[] }];
  "session-added": [{ itemKey: string; session: ChatSession }];
  "session-deleted": [{ itemKey: string; sessionId: string }];
  "session-updated": [{ itemKey: string; session: ChatSession }];
};

class GlobalChatManager extends EventEmitter<GlobalChatManagerEvents> {
  private static _instance: GlobalChatManager;
  private _sessions: Map<string, ChatSession[]> = new Map();
  private repository = new ChatSessionRepository();

  private constructor() {
    super();
  }

  public static getInstance(): GlobalChatManager {
    if (!GlobalChatManager._instance) {
      GlobalChatManager._instance = new GlobalChatManager();
    }
    return GlobalChatManager._instance;
  }

  public init(): void {
    Zotero.log("[GlobalChatManager] Initialized.");
    // Add any global initialization logic here
  }

  public destroy(): void {
    Zotero.log("[GlobalChatManager] Destroyed.");
    this._sessions.clear();
    // Add any global cleanup logic here
  }

  /**
   * Loads all conversation attachments associated with the parent item,
   * and returns them as ChatSession instances.
   * @param parentItem The Zotero parent item.
   * @returns A promise that resolves to an array of ChatSession instances.
   */
  public async loadSessionsForItem(
    parentItem: Zotero.Item,
  ): Promise<ChatSession[]> {
    const itemKey = parentItem.key;
    if (this._sessions.has(itemKey)) {
      // Sessions already loaded for this item, return cached ones
      return this._sessions.get(itemKey)!;
    }

    const conversations = (await this.repository.loadSessions(parentItem)).map(
      ({ history, attachment }) =>
        new ChatSession(history, parentItem, this, this.repository, attachment),
    );
    this._sessions.set(itemKey, conversations);
    this.emit("sessions-loaded", { itemKey: itemKey, sessions: conversations });
    return conversations;
  }

  /**
   * Creates a new chat session for the given parent item and persists it.
   * @param parentItem The Zotero parent item.
   * @returns A promise that resolves to the newly created ChatSession.
   */
  public async createSession(parentItem: Zotero.Item): Promise<ChatSession> {
    Zotero.log(
      `[GlobalChatManager] createSession: Called for parent item: ${parentItem.key}`,
    );
    const newSession = ChatSession.createNew(parentItem, this, this.repository);
    Zotero.log(
      `[GlobalChatManager] createSession: New session object created with ID: ${newSession.id}`,
    );
    await newSession.init(); // Create attachment
    await newSession.save(); // Save initial state to attachment

    const itemKey = parentItem.key;
    if (!this._sessions.has(itemKey)) {
      this._sessions.set(itemKey, []);
    }
    this._sessions.get(itemKey)!.push(newSession);

    this.emit("session-added", { itemKey: itemKey, session: newSession });
    Zotero.log(
      `[GlobalChatManager] createSession: Session ${newSession.id} created and added to manager.`,
    );
    return newSession;
  }

  /**
   * Deletes a chat session from persistence and removes it from the internal state.
   * @param session The ChatSession to delete.
   * @returns A promise that resolves when the session is deleted.
   */
  public async deleteSession(session: ChatSession): Promise<void> {
    const itemKey = session.history.metadata.zoteroParentItemKey;
    await session.delete(); // Delete attachment

    if (this._sessions.has(itemKey)) {
      const updatedSessions = this._sessions
        .get(itemKey)!
        .filter((s) => s.id !== session.id);
      this._sessions.set(itemKey, updatedSessions);
    }
    this.emit("session-deleted", { itemKey: itemKey, sessionId: session.id });
  }

  /**
   * Saves changes to a ChatSession to persistence.
   * @param session The ChatSession to save.
   * @returns A promise that resolves when the session is saved.
   */
  public async saveSession(session: ChatSession): Promise<void> {
    Zotero.debug(
      `[GlobalChatManager] Saving session: ${session.id} - "${session.title}"`,
    );
    await session.save();
    Zotero.debug(
      `[GlobalChatManager] Emitting 'session-updated' for session: ${session.id}`,
    );
    this.emit("session-updated", {
      itemKey: session.history.metadata.zoteroParentItemKey,
      session: session,
    });
  }

  /**
   * Retrieves all sessions for a specific item.
   * @param itemKey The key of the Zotero parent item.
   * @returns An array of ChatSession instances.
   */
  public getAllSessions(itemKey: string): ChatSession[] {
    return this._sessions.get(itemKey) || [];
  }
}

export default GlobalChatManager;
