import { ChatSessionHistory } from "../../types/chat";
import { ConversationManager } from "./conversation";
import { ChatSession } from "./chatSession";
import { GEMINI_CHAT_TITLE_PREFIX } from "../../utils/constants";

/**
 * Manages a collection of ChatSession instances for a Zotero item.
 * It handles loading, creating, deleting, and switching between chat sessions.
 */
export class ChatSessionManager {
  private parentItem: Zotero.Item;
  private _sessions: ChatSession[] = [];
  private _activeSession: ChatSession | null = null;

  private onActiveSessionChange: (session: ChatSession | null) => void;
  private onSessionsListChange: (sessions: ChatSession[]) => void;

  constructor(
    parentItem: Zotero.Item,
    callbacks: {
      onActiveSessionChange: (session: ChatSession | null) => void;
      onSessionsListChange: (sessions: ChatSession[]) => void;
    },
  ) {
    this.parentItem = parentItem;
    this.onActiveSessionChange = callbacks.onActiveSessionChange;
    this.onSessionsListChange = callbacks.onSessionsListChange;
  }

  /**
   * Loads all conversation attachments associated with the parent item,
   * and returns them as ChatSession instances.
   */
  private async _loadAllConversations(): Promise<ChatSession[]> {
    const childAttachments = await Zotero.Items.get(
      this.parentItem.getAttachments(),
    );
    Zotero.log(`[Gemini PDF] _loadAllConversations: Processing attachments for parent item ${this.parentItem.key}. Found ${childAttachments.length} attachments.`);
    childAttachments.forEach(att => Zotero.log(`[Gemini PDF] _loadAllConversations: Attachment - ID: ${att.id}, Key: ${att.key}, Title: "${att.getField('title')}", LinkMode: ${att.attachmentLinkMode}, ItemType: ${att.itemType}`));

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
              Zotero.log(`[Gemini PDF] _loadAllConversations: Attempting to parse JSON from: ${conversationFilePath}`);
              Zotero.log(`[Gemini PDF] _loadAllConversations: Content snippet (first 100 chars): ${content.substring(0, 100)}...`);
              const parsedHistory = JSON.parse(content) as ChatSessionHistory;
              conversations.push(
                new ChatSession(parsedHistory, this.parentItem, () =>
                  this.onSessionsListChange(this._sessions),
                ),
              );
              Zotero.log(`[Gemini PDF] _loadAllConversations: Successfully loaded session with ID: ${parsedHistory.metadata.chatId}, Title: "${parsedHistory.metadata.chatTitle}"`);
            }
          } catch (e: any) {
            Zotero.logError(
              new Error(
                `[ChatSessionManager] Failed to parse conversation JSON from attachment ${attachment.key} (Path: ${conversationFilePath}): ${e.message || String(e)}`,
              ),
            );
            // Continue to next attachment if parsing fails
          }
        }
      }
    }
    return conversations;
  }

  /**
   * Loads all chat sessions from storage, initializes them as ChatSession instances,
   * and sets the most recent one as active.
   */
  async init(): Promise<void> {
    try {
      this._sessions = await this._loadAllConversations();
      this._triggerTitleGenerationForAllSessions();
    } catch (e: any) {
      Zotero.logError(
        new Error(`Error loading all conversations: ${e.message || String(e)}`),
      );
      this._sessions = []; // Continue with an empty list on error
    }

        await this._initializeActiveSession();

        this.onActiveSessionChange(this._activeSession);

    Zotero.debug(
      `[ChatSessionManager] Initialized with active session: ${this._activeSession?.id}`,
    );
  }

  /**
   * Iterates through all sessions and triggers title generation for those that need it.
   */
  private _triggerTitleGenerationForAllSessions(): void {
    const promises: Promise<boolean>[] = [];
    this._sessions.forEach((session) => {
      if (
        !session.history.metadata.isTitleGenerated &&
        session.history.history.length >= 2
      ) {
        promises.push(session.generateTitle());
      }
    });

    Promise.all(promises).then((results) => {
      if (results.some((titleChanged) => titleChanged)) {
        this.onSessionsListChange(this._sessions);
      }
    });
  }

  private async _initializeActiveSession(): Promise<void> {
    if (this._sessions.length === 0) {
      // If no sessions exist, create a new default one
      this._activeSession = await this.createSession(false);
    } else {
      // Otherwise, find the most recent session and activate it.
      const latestSession = this._sessions.sort((a, b) => {
        const dateA = new Date(a.history.metadata.createdTimestamp);
        const dateB = new Date(b.history.metadata.createdTimestamp);
        return dateB.getTime() - dateA.getTime();
      })[0];
      this._activeSession = latestSession;
    }
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
      Zotero.debug(
        `[ChatSessionManager] Switched active session to: ${chatId}`,
      );
      return this._activeSession;
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
    Zotero.log(`[Gemini PDF] ChatSessionManager.getActiveSession: Returning session ID: ${this._activeSession?.id}, Title: "${this._activeSession?.title}"`);
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
   * @param setActive Whether to set the new session as active.
   */
  async createSession(setActive: boolean = true): Promise<ChatSession> {
    const newSession = ChatSession.createNew(this.parentItem, () => this.onSessionsListChange(this._sessions));
    await newSession.init();
    await newSession.save(); // ファイルへの保存のみ行い、インメモリリストには直接追加しない

    // 新しいセッションをアクティブにする意図が明示されている場合、ここでアクティブセッションを設定
    if (setActive) {
      this._activeSession = newSession;
      this.onActiveSessionChange(newSession);
    }
    return newSession;
  }

  /**
   * Deletes the currently active chat session and activates the next available one.
   */
  async deleteActiveSession(): Promise<boolean> {
    if (!this._activeSession) {
      Zotero.logError(
        new Error("[ChatSessionManager] No active session to delete."),
      );
      return false;
    }

    const chatIdToDelete = this._activeSession.id;

    try {
      await ConversationManager.deleteConversation(
        this.parentItem,
        chatIdToDelete,
      );
      // this._sessions = this._sessions.filter( // ファイルイベントでロードされるため削除
      //   (session) => session.id !== chatIdToDelete
      // );
      // this.onSessionsListChange(this._sessions); // 上記削除に伴い不要
      Zotero.debug(
        `[ChatSessionManager] Deleted session with ID: ${chatIdToDelete}`,
      );

      // アクティブセッションの切り替えも、ファイルイベント経由のリロードに任せる
      // if (this._sessions.length > 0) {
      //   this._activeSession = this._sessions[0]; // Activate the first one
      // } else {
      //   this._activeSession = await this.createSession(false);
      // }

      // this.onActiveSessionChange(this._activeSession); // 上記削除に伴い不要
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
}
