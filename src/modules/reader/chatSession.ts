import {
  ChatSessionHistory,
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
import { createUserStoredMessage } from "../llm/langChainMessages";

/**
 * Represents a single chat session, encapsulating its history and operations.
 * This class manages the lifecycle of a conversation, including sending messages,
 * generating titles, and interacting with the underlying LLM and persistence layers.
 */
export class ChatSession {
  private _history: ChatSessionHistory;
  private _parentItem: Zotero.Item;
  private globalChatManager: GlobalChatManager;
  private repository: ChatSessionRepository;
  private titleGenerationService = new TitleGenerationService();
  private titleGenerationPromise: Promise<boolean> | null = null;

  /**
   * Creates a new ChatSession instance for a new chat.
   * @param parentItem The Zotero parent item.
   * @param globalChatManager The global chat manager instance.
   * @returns A new ChatSession instance.
   */
  public static createNew(
    parentItem: Zotero.Item,
    globalChatManager: GlobalChatManager,
    repository: ChatSessionRepository,
  ): ChatSession {
    const now = new Date().toISOString();
    const newHistory: ChatSessionHistory = {
      schemaVersion: 2,
      metadata: {
        zoteroParentItemKey: parentItem.key,
        chatId: uuidv4(),
        chatTitle: getString("askmypaper-reader-new-chat-title"),
        isTitleGenerated: false,
        createdTimestamp: now,
        updatedTimestamp: now,
      },
      messages: [],
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
    globalChatManager: GlobalChatManager,
    repository: ChatSessionRepository,
  ) {
    this._history = history;
    this._parentItem = parentItem;
    this.globalChatManager = globalChatManager;
    this.repository = repository;
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
      this.touch();
    }
  }

  private touch(): void {
    this._history.metadata.updatedTimestamp = new Date().toISOString();
  }

  /**
   * Saves the current session history to the persistence layer.
   */
  public async save(): Promise<void> {
    this.touch();
    await this.repository.saveSession(this._parentItem, this._history);
  }

  /**
   * Deletes the chat session from the aggregate parent item store.
   */
  public async delete(): Promise<void> {
    await this.repository.deleteSession(this._parentItem, this.id);
  }

  /**
   * Adds a user message to the session's history.
   * @param text The text of the user's message.
   */
  public addUserMessage(text: string): void {
    this._history.messages.push(createUserStoredMessage(text));
    this.touch();
  }

  /**
   * Adds a model's message to the session's history.
   */
  public addBotMessage(
    storedMessage: ChatSessionHistory["messages"][number],
  ): void {
    this._history.messages.push(storedMessage);
    this.touch();
  }

  /**
   * Generates a title for the chat session based on its initial messages.
   * @returns {Promise<boolean>} True if a title was successfully generated and saved, false otherwise.
   */
  public async generateTitle(): Promise<boolean> {
    if (
      this._history.messages.length < 2 ||
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
          this._history.messages,
        );
      if (generatedTitle) {
        this.title = generatedTitle;
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
    if (this._history.messages.length === 0) {
      return false;
    }

    try {
      const generatedTitle =
        await this.titleGenerationService.regenerateTitleFromTopHistory(
          this._history.messages,
        );
      if (generatedTitle) {
        this.title = generatedTitle;
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
    citations?: LlmCitation[];
    diagnostics?: LlmDiagnostics;
  }> {
    const historyLimit = (getPref(PREF_CONTEXT_WINDOW_SIZE) as number) || 32;

    const historyForApi =
      this._history.messages.length > 1
        ? this._history.messages.slice(0, -1)
        : [];
    const truncatedHistory =
      historyLimit > 0 ? historyForApi.slice(-historyLimit) : historyForApi;
    const provider = getSelectedProvider();

    try {
      const {
        thoughts,
        responseText,
        citations,
        provider: responseProvider,
        model,
        diagnostics,
        storedMessage,
      } = await sendMessageToLlm(truncatedHistory, textForApi, {
        provider,
        metadata: parentItemFileMetadata,
      });
      Zotero.log(
        `[Ask My Paper] LLM response metadata: provider=${responseProvider}, model=${model}, thoughts=${thoughts.length}, citations=${citations.length}`,
      );

      this.addBotMessage(storedMessage);

      // After the first exchange, generate a title for the session
      if (
        this._history.messages.length === 2 &&
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
