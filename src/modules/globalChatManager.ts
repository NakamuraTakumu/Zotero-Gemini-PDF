import { ChatSession } from "./reader/chatSession";
import { ChatSessionHistory } from "../types/chat";
import {
  GEMINI_CHAT_TITLE_PREFIX,
  GEMINI_CHAT_FILENAME_PREFIX,
} from "../utils/constants";
import { v4 as uuidv4 } from "uuid";
import EventEmitter from "../utils/eventEmitter";

class GlobalChatManager extends EventEmitter {
  private static _instance: GlobalChatManager;
  private _sessions: Map<string, ChatSession[]> = new Map();

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

    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    Zotero.log(
      `[GlobalChatManager] loadSessionsForItem: Processing attachments for parent item ${itemKey}. Found ${childAttachments.length} attachments.`,
    );

    const conversations: ChatSession[] = [];

    for (const attachment of childAttachments) {
      if (
        (attachment.itemType as string) === "attachment" &&
        attachment.getField("title")?.startsWith(GEMINI_CHAT_TITLE_PREFIX) &&
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      ) {
        const conversationFilePath = attachment.getFilePath();
        if (conversationFilePath) {
          try {
            const content =
              await Zotero.File.getContentsAsync(conversationFilePath);
            if (typeof content === "string" && content.trim() !== "") {
              const parsedHistory = JSON.parse(content) as ChatSessionHistory;
              const newSession = new ChatSession(parsedHistory, parentItem); // onTitleChangeCallback は ChatSessionManager が持つ
              await newSession.init();
              conversations.push(newSession);
              Zotero.log(
                `[GlobalChatManager] loadSessionsForItem: Successfully loaded session with ID: ${parsedHistory.metadata.chatId}, Title: "${parsedHistory.metadata.chatTitle}"`,
              );
            }
          } catch (e: any) {
            Zotero.logError(
              new Error(
                `[GlobalChatManager] Failed to parse conversation JSON from attachment ${attachment.key} (Path: ${conversationFilePath}): ${
                  e.message || String(e)
                }`,
              ),
            );
          }
        }
      }
    }
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
    const newSession = ChatSession.createNew(parentItem);
    await newSession.init(); // Create attachment
    await newSession.save(); // Save initial state to attachment

    const itemKey = parentItem.key;
    if (!this._sessions.has(itemKey)) {
      this._sessions.set(itemKey, []);
    }
    this._sessions.get(itemKey)!.push(newSession);

    this.emit("session-added", { itemKey: itemKey, session: newSession });
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
    Zotero.debug(`[GlobalChatManager] Saving session: ${session.id} - "${session.title}"`);
    await session.save();
    Zotero.debug(`[GlobalChatManager] Emitting 'session-updated' for session: ${session.id}`);
    this.emit("session-updated", { itemKey: session.history.metadata.zoteroParentItemKey, session: session });
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
