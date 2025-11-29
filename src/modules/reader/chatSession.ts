import {
  ChatSessionHistory,
  ChatMessage,
  ParentItemFileMetadata,
} from "../../types/chat";
import { getPref } from "../../utils/prefs";
import {
  PREF_SELECTED_MODEL,
  PREF_USE_GOOGLE_SEARCH,
  PREF_CONTEXT_WINDOW_SIZE,
  PREF_TITLE_GENERATION_MODEL,
  PREF_TITLE_GENERATION_PROMPT,
  GEMINI_CHAT_TITLE_PREFIX,
  GEMINI_CHAT_FILENAME_PREFIX,
} from "../../utils/constants";
import { Content, Part } from "@google/genai";
import { sendMessageToGemini, uploadFile, getFileMetadata } from "../geminiApi";
import { v4 as uuidv4 } from "uuid";
import { getString } from "../../utils/locale";

/**
 * Represents a single chat session, encapsulating its history and operations.
 * This class manages the lifecycle of a conversation, including sending messages,
 * generating titles, and interacting with the underlying Gemini API and persistence layers.
 */
export class ChatSession {
  private _history: ChatSessionHistory;
  private _parentItem: Zotero.Item;
  private _attachment!: Zotero.Item; // Initialized in init()
  private onTitleChangeCallback: (() => void) | null;

  /**
   * Creates a new ChatSession instance for a new chat.
   * @param parentItem The Zotero parent item.
   * @returns A new ChatSession instance.
   */
  public static createNew(
    parentItem: Zotero.Item,
    onTitleChange: (() => void) | null = null,
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
    return new ChatSession(newHistory, parentItem, onTitleChange);
  }

  constructor(
    history: ChatSessionHistory,
    parentItem: Zotero.Item,
    onTitleChange: (() => void) | null = null,
  ) {
    this._history = history;
    this._parentItem = parentItem;
    this.onTitleChangeCallback = onTitleChange;
  }

  /**
   * Initializes the ChatSession by ensuring its Zotero attachment exists.
   * This should be called immediately after construction.
   */
  public async init(): Promise<void> {
    this._attachment = await this._getOrCreateConversationAttachment();
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
      if (this.onTitleChangeCallback) {
        this.onTitleChangeCallback();
      }
    }
  }
  /**
   * Finds an existing Gemini Conversation attachment or creates a new one if it doesn't exist.
   */
  private async _getOrCreateConversationAttachment(): Promise<Zotero.Item> {
    const expectedChatId = this._history.metadata.chatId;
    const expectedAttachmentTitle = `${GEMINI_CHAT_TITLE_PREFIX}${expectedChatId}`;
    const expectedFilename = `${GEMINI_CHAT_FILENAME_PREFIX}${expectedChatId}.json`;

    const childAttachments = await Zotero.Items.get(
      this._parentItem.getAttachments(),
    );
    for (const attachment of childAttachments) {
      if (
        (attachment.itemType as string) === "attachment" &&
        attachment.getField("title") === expectedAttachmentTitle && // Exact match for unique title
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      ) {
        return attachment;
      }
    }

    const conversationJsonString = JSON.stringify(this._history, null, 2);
    const filename = expectedFilename;

    const tempDir = Zotero.getTempDirectory();
    const tempFileName = `${Zotero.Utilities.randomString()}-${filename}`;
    tempDir.append(tempFileName);
    const tempFilePath = tempDir.path;

    try {
      await Zotero.File.putContentsAsync(tempFilePath, conversationJsonString);
      const tempFile = Zotero.File.pathToFile(tempFilePath);

      const newAttachment = await Zotero.Attachments.importFromFile({
        file: tempFile,
        parentItemID: this._parentItem.id,
        contentType: "application/json",
        title: expectedAttachmentTitle,
      });

      Zotero.debug(
        `Successfully created new conversation attachment with key ${newAttachment.key}`,
      );
      return newAttachment;
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `Error creating attachment from temp file: ${e.message || String(e)}`,
        ),
      );
      throw e;
    } finally {
      try {
        const tempFile = Zotero.File.pathToFile(tempFilePath);
        if (tempFile.exists()) {
          tempFile.remove(false);
          Zotero.debug(`Temporary file removed: ${tempFilePath}`);
        }
      } catch (cleanupError: any) {
        Zotero.logError(
          new Error(
            `Failed to clean up temporary file ${tempFilePath}: ${cleanupError.message || String(cleanupError)}`,
          ),
        );
      }
    }
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
    const conversationFilePath = this._attachment.getFilePath();
    if (conversationFilePath) {
      const newContent = JSON.stringify(this._history, null, 2);
      try {
        await Zotero.File.putContentsAsync(conversationFilePath, newContent);
      } catch (e: any) {
        Zotero.log(
          `Error writing to conversation file: ${e.message || String(e)}`,
        );
      }
    } else {
      Zotero.logError(
        new Error(
          `[ChatSession] Could not get file path for conversation attachment ${this._attachment.key}.`,
        ),
      );
    }
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
    groundingMetadata?: any,
  ): void {
    const botMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      role: "model",
      model: model,
      parts: [{ text: text || "" }],
      groundingMetadata: groundingMetadata,
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

    const userPrompt = this._history.history[0].parts[0].text;
    const modelResponse = this._history.history[1].parts[0].text;

    const promptTemplate = getPref(PREF_TITLE_GENERATION_PROMPT) as string;
    const titlePrompt = promptTemplate
      .replace("{userPrompt}", userPrompt)
      .replace("{modelResponse}", modelResponse);

    const modelForTitle = getPref(PREF_TITLE_GENERATION_MODEL) as string;

    try {
      const { responseText } = await sendMessageToGemini(
        [],
        [{ text: titlePrompt }],
        false,
        undefined,
        modelForTitle,
      );
      if (responseText) {
        this.title = responseText
          .trim()
          .replace(/^「|」$/g, "")
          .replace(/\.$/, "");
        await this.save();
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
    Zotero.log(`[ChatSession] sendMessage called. textForApi: ${textForApi}`);
    const historyLimit = (getPref(PREF_CONTEXT_WINDOW_SIZE) as number) || 32;

    const fullHistory: Content[] = this._history.history.map((msg) => ({
      role: msg.role,
      parts: msg.parts,
    }));

    const historyForApi =
      fullHistory.length > 1 ? fullHistory.slice(0, -1) : [];
    const truncatedHistory =
      historyLimit > 0 ? historyForApi.slice(-historyLimit) : historyForApi;

    const userParts: Part[] = [{ text: textForApi }];
    for (const file of parentItemFileMetadata.files) {
      userParts.unshift({
        fileData: {
          mimeType: "application/pdf",
          fileUri: file.geminiFileUri,
        },
      });
    }

    const useGoogleSearch = getPref(PREF_USE_GOOGLE_SEARCH) as boolean;
    let tools: any[] | undefined = undefined;
    if (useGoogleSearch) {
      // urlContextも同時に使う
      tools = [{ urlContext: {} }, { googleSearch: {} }];
    }

    try {
      Zotero.log(`[ChatSession] sendMessage: Calling sendMessageToGemini.`);
      const { thoughts, responseText, groundingMetadata } =
        await sendMessageToGemini(
          truncatedHistory,
          userParts,
          true, // includeThoughts - consider making this configurable
          tools,
        );
      Zotero.log(
        `[ChatSession] sendMessage: received response from Gemini API.`,
      );

      this.addBotMessage(
        responseText || "",
        getPref(PREF_SELECTED_MODEL) as string,
        groundingMetadata,
      );
      await this.save();
      Zotero.log(`[ChatSession] sendMessage: session saved.`);

      // After the first exchange, generate a title for the session
      if (
        this._history.history.length === 2 &&
        !this._history.metadata.isTitleGenerated
      ) {
        Zotero.log(`[ChatSession] sendMessage: Generating title for session.`);
        // Don't wait for this to complete
        this.generateTitle();
      }

      return {
        responseText: responseText || "No response.",
        thoughts,
        groundingMetadata,
      };
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ChatSession] sendMessage: Error during sendMessageToGemini: ${e.message || String(e)}`,
        ),
      );
      throw e; // エラーを再スローして_handleSendMessageのcatchブロックで処理されるようにする
    }
  }
}
