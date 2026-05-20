import {
  ChatSessionHistory,
  ChatMessage,
  LlmCitation,
  LlmDiagnostics,
  ParentItemFileMetadata,
  ProviderId,
} from "../../types/chat";
import { getPref } from "../../utils/prefs";
import { PREF_CONTEXT_WINDOW_SIZE } from "../../utils/constants";
import { sendMessageToLlm } from "../llm/chat";
import { getSelectedProvider } from "../llm/provider";
import { v4 as uuidv4 } from "uuid";
import { getString } from "../../utils/locale";
import GlobalChatManager from "../globalChatManager"; // Add this import
import { ChatSessionRepository } from "./chatSessionRepository";
import { TitleGenerationService } from "./titleGenerationService";

/**
 * Represents a single chat session, encapsulating its history and operations.
 * This class manages the lifecycle of a conversation, including sending messages,
 * generating titles, and interacting with the underlying LLM and persistence layers.
 */
export class ChatSession {
  private _history: ChatSessionHistory;
  private _parentItem: Zotero.Item;
  private _attachment!: Zotero.Item; // Initialized in init()
  private globalChatManager: GlobalChatManager; // Add this line
  private repository: ChatSessionRepository;
  private titleGenerationService = new TitleGenerationService();
  private titleGenerationPromise: Promise<boolean> | null = null;

  /**
   * Creates a new ChatSession instance for a new chat.
   * @param parentItem The Zotero parent item.
   * @param globalChatManager The global chat manager instance. // Add this param
   * @returns A new ChatSession instance.
   */
  public static createNew(
    parentItem: Zotero.Item,
    globalChatManager: GlobalChatManager, // Add this param
    repository: ChatSessionRepository,
  ): ChatSession {
    const newHistory: ChatSessionHistory = {
      metadata: {
        zoteroParentItemKey: parentItem.key,
        chatId: uuidv4(),
        chatTitle: getString("gemini-pdf-reader-new-chat-title"),
        isTitleGenerated: false,
        createdTimestamp: new Date().toISOString(), // 新しいフィールドを初期化
      },
      history: [],
    };
    return new ChatSession(
      newHistory,
      parentItem,
      globalChatManager,
      repository,
    );
  }

  constructor(
    history: ChatSessionHistory,
    parentItem: Zotero.Item,
    globalChatManager: GlobalChatManager, // Add this param
    repository: ChatSessionRepository,
    attachment?: Zotero.Item,
  ) {
    this._history = history;
    this._parentItem = parentItem;
    this.globalChatManager = globalChatManager; // Add this line
    this.repository = repository;
    if (attachment) {
      this._attachment = attachment;
    }
  }

  /**
   * Initializes the ChatSession by ensuring its Zotero attachment exists.
   * This should be called immediately after construction.
   */
  public async init(): Promise<void> {
    this._attachment = await this.repository.getOrCreateAttachment(
      this._parentItem,
      this._history,
    );
  }

  public get history(): Readonly<ChatSessionHistory> {
    return this._history;
  }

  public get id(): string {
    return this._history.metadata.chatId;
  }

  public get title(): string {
    return this._history.metadata.chatTitle;
  }

  public set title(newTitle: string) {
    if (this._history.metadata.chatTitle !== newTitle) {
      this._history.metadata.chatTitle = newTitle;
      this._history.metadata.isTitleGenerated = true;
    }
  }

  /**
   * Updates the attachment's title based on the current session title and saves it.
   */
  private async _updateAttachmentTitle(): Promise<void> {
    if (!this._attachment) {
      Zotero.logError(
        new Error(
          "ChatSession attachment not initialized. Cannot update attachment title.",
        ),
      );
      return;
    }
    await this.repository.updateAttachmentTitle(this._attachment, this.title);
  }

  /**
   * Saves the current session history to the persistence layer.
   */
  public async save(): Promise<void> {
    if (!this._attachment) {
      Zotero.logError(
        new Error("ChatSession attachment not initialized. Call init() first."),
      );
      return;
    }
    await this.repository.saveSession(this._attachment, this._history);
  }

  /**
   * Deletes the chat session's attachment from Zotero.
   */
  public async delete(): Promise<void> {
    if (!this._attachment) {
      Zotero.logError(
        new Error("ChatSession attachment not initialized. Cannot delete."),
      );
      return;
    }

    await this.repository.deleteSession(this._attachment, this.id);
  }

  /**
   * Adds a user message to the session's history.
   * @param text The text of the user's message.
   */
  public addUserMessage(text: string): void {
    const userMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      role: "user",
      parts: [{ text: text }],
    };
    this._history.history.push(userMessage);
  }

  /**
   * Adds a model's message to the session's history.
   * @param text The text of the model's response.
   * @param model The model that generated the response.
   * @param groundingMetadata Optional grounding metadata from the API.
   */
  public addBotMessage(
    text: string,
    model: string,
    provider: ProviderId,
    thoughts?: string[],
    groundingMetadata?: any,
    citations?: LlmCitation[],
    diagnostics?: LlmDiagnostics,
  ): void {
    const botMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      role: "model",
      model: model,
      provider,
      parts: [{ text: text || "" }],
      thoughts: thoughts,
      citations,
      groundingMetadata: groundingMetadata,
      llmDiagnostics: diagnostics,
    };
    this._history.history.push(botMessage);
  }

  /**
   * Generates a title for the chat session based on its initial messages.
   * @returns {Promise<boolean>} True if a title was successfully generated and saved, false otherwise.
   */
  public async generateTitle(): Promise<boolean> {
    if (
      this._history.history.length < 2 ||
      this._history.metadata.isTitleGenerated
    ) {
      return false;
    }

    if (this.titleGenerationPromise) {
      return this.titleGenerationPromise;
    }

    this.titleGenerationPromise = this._generateTitle();
    try {
      return await this.titleGenerationPromise;
    } finally {
      this.titleGenerationPromise = null;
    }
  }

  private async _generateTitle(): Promise<boolean> {
    try {
      const generatedTitle =
        await this.titleGenerationService.generateInitialTitle(
          this._history.history,
        );
      if (generatedTitle) {
        this.title = generatedTitle;
        await this._updateAttachmentTitle();
        await this.globalChatManager.saveSession(this);
        return true;
      }
      return false;
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ChatSession] Failed to generate session title: ${
            e.message || String(e)
          }`,
        ),
      );
      return false;
    }
  }

  /**
   * Regenerates the title using the oldest messages in the current session.
   * The number of messages used is controlled by PREF_CONTEXT_WINDOW_SIZE.
   */
  public async regenerateTitleFromTopHistory(): Promise<boolean> {
    if (this._history.history.length === 0) {
      return false;
    }

    try {
      const generatedTitle =
        await this.titleGenerationService.regenerateTitleFromTopHistory(
          this._history.history,
        );
      if (generatedTitle) {
        this.title = generatedTitle;
        await this._updateAttachmentTitle();
        await this.globalChatManager.saveSession(this);
        return true;
      }
      return false;
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ChatSession] Failed to regenerate session title: ${
            e.message || String(e)
          }`,
        ),
      );
      return false;
    }
  }

  /**
   * Processes a user's message, sends it to the LLM, and updates the history.
   * @param textForApi The text to be sent to the API.
   * @param parentItemFileMetadata The metadata of synced PDF files.
   * @returns The model's response text.
   */
  public async sendMessage(
    textForApi: string,
    parentItemFileMetadata: ParentItemFileMetadata,
  ): Promise<{
    responseText: string;
    provider: ProviderId;
    model: string;
    thoughts?: string[];
    groundingMetadata?: any;
    citations?: LlmCitation[];
    diagnostics?: LlmDiagnostics;
  }> {
    const historyLimit = (getPref(PREF_CONTEXT_WINDOW_SIZE) as number) || 32;

    const historyForApi =
      this._history.history.length > 1
        ? this._history.history.slice(0, -1)
        : [];
    const truncatedHistory =
      historyLimit > 0 ? historyForApi.slice(-historyLimit) : historyForApi;
    const provider = getSelectedProvider();

    try {
      const {
        thoughts,
        responseText,
        groundingMetadata,
        citations,
        provider: responseProvider,
        model,
        diagnostics,
      } = await sendMessageToLlm(truncatedHistory, textForApi, {
        provider,
        metadata: parentItemFileMetadata,
      });
      Zotero.log(
        `[Gemini PDF] LLM response metadata: provider=${responseProvider}, model=${model}, thoughts=${thoughts.length}, citations=${citations.length}`,
      );

      this.addBotMessage(
        responseText || "",
        model,
        responseProvider,
        thoughts,
        groundingMetadata,
        citations,
        diagnostics,
      );

      // After the first exchange, generate a title for the session
      if (
        this._history.history.length === 2 &&
        !this._history.metadata.isTitleGenerated
      ) {
        // Don't wait for this to complete
        this.generateTitle();
      }

      return {
        responseText: responseText || "No response.",
        provider: responseProvider,
        model,
        thoughts,
        groundingMetadata,
        citations,
        diagnostics,
      };
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ChatSession] sendMessage: Error during sendMessageToLlm: ${e.message || String(e)}`,
        ),
      );
      throw e; // エラーを再スローして_handleSendMessageのcatchブロックで処理されるようにする
    }
  }
}
