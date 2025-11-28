import {
  GEMINI_CHAT_TITLE_PREFIX,
  GEMINI_CHAT_FILENAME_PREFIX,
  PARENT_ITEM_FILE_METADATA_TITLE_PREFIX,
  PARENT_ITEM_FILE_METADATA_FILENAME_PREFIX,
} from "../../utils/constants";
import {
  ChatSessionHistory,
  ChatMessage,
  ParentItemFileMetadata,
  ParentItemFileMetadataFile,
} from "../../types/chat";
import { v4 as uuidv4 } from "uuid";
import { uploadFile, getFileMetadata } from "../geminiApi";

export class ConversationManager {
  /**
   * Finds an existing Gemini Conversation attachment or creates a new one if it doesn't exist.
   * The conversation is stored as a JSON attachment to the parent Zotero item. 
   */
  static async getOrCreateConversationAttachment(
    parentItem: Zotero.Item,
    conversation: ChatSessionHistory, // Add conversation object
  ): Promise<Zotero.Item> {
    const expectedChatId = conversation.metadata.chatId;
    const expectedAttachmentTitle = `${GEMINI_CHAT_TITLE_PREFIX}${expectedChatId}`;
    const expectedFilename = `${GEMINI_CHAT_FILENAME_PREFIX}${expectedChatId}.json`;

    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
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

    const conversationJsonString = JSON.stringify(conversation, null, 2); // Use passed conversation
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
        parentItemID: parentItem.id,
        contentType: "application/json",
        title: expectedAttachmentTitle,
      });

      Zotero.debug(
        `Successfully created new conversation attachment with key ${newAttachment.key}`,
      );
      return newAttachment;
    } catch (e: any) {
      Zotero.logError(new Error(`Error creating attachment from temp file: ${e.message || String(e)}`));
      throw e;
    } finally {
      try {
        const tempFile = Zotero.File.pathToFile(tempFilePath);
        if (tempFile.exists()) {
          tempFile.remove(false);
          Zotero.debug(`Temporary file removed: ${tempFilePath}`);
        }
      }
      catch (cleanupError: any) {
        Zotero.logError(
          new Error(`Failed to clean up temporary file ${tempFilePath}: ${cleanupError.message || String(cleanupError)}`),
        );
      }
    }
  }

  /**
   * Loads the conversation from the attachment associated with the parent item.
   * If no conversation exists, it returns an empty one.
   */
  static async loadConversation(parentItem: Zotero.Item): Promise<ChatSessionHistory> {
    const childAttachments = await Zotero.Items.get(parentItem.getAttachments());
    let latestConversation: ChatSessionHistory | null = null;
    let latestModifiedDate = new Date(0); // Epoch

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
            const content = await Zotero.File.getContentsAsync(conversationFilePath);
            if (typeof content === "string" && content.trim() !== "") {
              const parsedConversation = JSON.parse(content) as ChatSessionHistory;
              // Check if this conversation is more recent
              const attachmentModifiedDate = attachment.dateModified ? new Date(attachment.dateModified) : new Date(0);
              if (attachmentModifiedDate > latestModifiedDate) {
                latestConversation = parsedConversation;
                latestModifiedDate = attachmentModifiedDate;
              }
            }
          } catch (e: any) {
            Zotero.logError(new Error(`[ConversationManager] Failed to parse conversation JSON from attachment ${attachment.key}: ${e.message || String(e)}`));
            // Continue to next attachment if parsing fails
          }
        }
      }
    }

    if (latestConversation) {
      Zotero.debug(`[ConversationManager] Loaded latest conversation history with length: ${latestConversation.history.length}`);
      return latestConversation;
    }

    // 会話が存在しない場合、新しい空の会話を返す
    const chatId = uuidv4();
    const chatTitle = "新しいチャット"; // 仮のデフォルトタイトル
    return {
      metadata: {
        zoteroParentItemKey: parentItem.key,
        chatId: chatId,
        chatTitle: chatTitle,
        isTitleGenerated: false,
      },
      history: [],
    };
  }

  /**
   * Loads all conversation attachments associated with the parent item.
   * If no conversation exists, it returns an empty array.
   */
  static async getAllConversations(parentItem: Zotero.Item): Promise<ChatSessionHistory[]> {
    const childAttachments = await Zotero.Items.get(parentItem.getAttachments());
    const conversations: ChatSessionHistory[] = [];

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
            const content = await Zotero.File.getContentsAsync(conversationFilePath);
            if (typeof content === "string" && content.trim() !== "") {
              const parsedConversation = JSON.parse(content) as ChatSessionHistory;
              conversations.push(parsedConversation);
            }
          } catch (e: any) {
            Zotero.logError(new Error(`[ConversationManager] Failed to parse conversation JSON from attachment ${attachment.key}: ${e.message || String(e)}`));
            // Continue to next attachment if parsing fails
          }
        }
      }
    }
    return conversations;
  }

  /**
   * Saves the current conversation back to its Zotero attachment.
   */
  static async saveConversation(
    actualParentItem: Zotero.Item,
    conversation: ChatSessionHistory,
  ) {
    if (!actualParentItem) {
      Zotero.debug("Could not determine actualParentItem for conversation.");
      return;
    }
        const conversationAttachment =
          await ConversationManager.getOrCreateConversationAttachment(
            actualParentItem,
            conversation, // Pass the conversation object
          );
        const conversationFilePath = conversationAttachment.getFilePath();
        if (conversationFilePath) {
          const newContent = JSON.stringify(conversation, null, 2);
          try {
            await Zotero.File.putContentsAsync(conversationFilePath, newContent);
          } catch (e: any) {
            Zotero.log(`Error writing to conversation file: ${e.message || String(e)}`);
          }
        } else {
          Zotero.logError(new Error(`[ConversationManager] Could not get file path for conversation attachment ${conversationAttachment.key}.`));
        }
  }

  static async deleteConversation(parentItem: Zotero.Item, chatId: string): Promise<void> {
    const expectedAttachmentTitle = `${GEMINI_CHAT_TITLE_PREFIX}${chatId}`;
    const childAttachments = await Zotero.Items.get(parentItem.getAttachments());

    for (const attachment of childAttachments) {
      if (
        (attachment.itemType as string) === "attachment" &&
        attachment.getField("title") === expectedAttachmentTitle &&
        attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      ) {
        try {
          attachment.deleted = true;
        await attachment.saveTx(); // 添付ファイルを削除
          Zotero.debug(`Successfully deleted conversation attachment for chatId: ${chatId}`);
          return; // 削除したら終了
        } catch (e: any) {
          Zotero.logError(new Error(`Error deleting conversation attachment ${attachment.key}: ${e.message || String(e)}`));
          throw e;
        }
      }
    }
    Zotero.debug(`No conversation attachment found for chatId: ${chatId}.`);
  }

  /**
   * Adds a user message to the conversation history.
   */
  static addUserMessage(conversation: ChatSessionHistory, text: string): void {
    const userMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      role: "user",
      parts: [{ text: text }],
    };
    conversation.history.push(userMessage);
  }

  /**
   * Adds a bot message to the conversation history.
   */
  static addBotMessage(conversation: ChatSessionHistory, text: string, model: string, groundingMetadata?: any): void {
    const botMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      role: "model",
      model: model,
      parts: [{ text: text || "" }],
      groundingMetadata: groundingMetadata,
    };
    conversation.history.push(botMessage);
  }

  /**
   * Finds an existing ParentItemFileMetadata attachment or creates a new one if it doesn't exist.
   */
  static async getOrCreateParentItemFileMetadataAttachment(
    parentItem: Zotero.Item,
  ): Promise<Zotero.Item> {
    const childAttachments = await Zotero.Items.get(parentItem.getAttachments());
    const attachmentTitle = `${PARENT_ITEM_FILE_METADATA_TITLE_PREFIX}${parentItem.key}`;

    for (const attachment of childAttachments) {
              const currentAttachmentTitle = attachment.getField("title");
              if (
                (attachment.itemType as string) === "attachment" &&
                (currentAttachmentTitle === attachmentTitle || currentAttachmentTitle === `${attachmentTitle}.json`) &&
                attachment.attachmentLinkMode ===
                  Zotero.Attachments.LINK_MODE_IMPORTED_FILE
              ) {        Zotero.debug(`Found existing ParentItemFileMetadata attachment for ${parentItem.key}.`);
        return attachment;
      }
    }

    Zotero.debug(`Creating new ParentItemFileMetadata attachment for ${parentItem.key}.`);

    const initialMetadata: ParentItemFileMetadata = {
      zoteroParentItemKey: parentItem.key,
      files: [],
    };
    const metadataJsonString = JSON.stringify(initialMetadata, null, 2);
    const filename = `${PARENT_ITEM_FILE_METADATA_FILENAME_PREFIX}${parentItem.key}.json`;

    const tempDir = Zotero.getTempDirectory();
    const tempFileName = `${Zotero.Utilities.randomString()}-${filename}`;
    tempDir.append(tempFileName);
    const tempFilePath = tempDir.path;

    try {
      await Zotero.File.putContentsAsync(tempFilePath, metadataJsonString);
      const tempFile = Zotero.File.pathToFile(tempFilePath);

      const newAttachment = await Zotero.Attachments.importFromFile({
        file: tempFile,
        parentItemID: parentItem.id,
        contentType: "application/json",
        title: attachmentTitle,
      });

      Zotero.debug(
        `Successfully created new ParentItemFileMetadata attachment with key ${newAttachment.key}`,
      );
      return newAttachment;
    } catch (e: any) {
      Zotero.logError(new Error(`Error creating ParentItemFileMetadata attachment from temp file: ${e.message || String(e)}`));
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
          new Error(`Failed to clean up temporary file ${tempFilePath}: ${cleanupError.message || String(cleanupError)}`),
        );
      }
    }
  }

  /**
   * Loads the ParentItemFileMetadata from the attachment associated with the parent item.
   */
  static async loadParentItemFileMetadata(parentItem: Zotero.Item): Promise<ParentItemFileMetadata> {
    const childAttachments = await Zotero.Items.get(parentItem.getAttachments());
    const attachmentTitle = `${PARENT_ITEM_FILE_METADATA_TITLE_PREFIX}${parentItem.key}`;
    const existingAttachment = childAttachments.find((att) => {
      const currentAttachmentTitle = att.getField("title");
      return (
        att.isAttachment() &&
        (currentAttachmentTitle === attachmentTitle || currentAttachmentTitle === `${attachmentTitle}.json`)
      );
    });

    if (existingAttachment) {
      const metadataFilePath = existingAttachment.getFilePath();
      if (metadataFilePath) {
        const content = await Zotero.File.getContentsAsync(metadataFilePath);
        if (typeof content === "string" && content.trim() !== "") {
          try {
            return JSON.parse(content) as ParentItemFileMetadata;
          } catch (e: any) {
            Zotero.logError(new Error(`Failed to parse ParentItemFileMetadata JSON: ${e.message || String(e)}`));
            // If parsing fails, treat as no metadata
          }
        }
      }
    }

    // メタデータが存在しない場合、新しい空のメタデータを返す
    return {
      zoteroParentItemKey: parentItem.key,
      files: [],
    };
  }

  /**
   * Saves the ParentItemFileMetadata back to its Zotero attachment.
   */
  static async saveParentItemFileMetadata(
    parentItem: Zotero.Item,
    metadata: ParentItemFileMetadata,
  ) {
    if (!parentItem) {
      Zotero.debug("Could not determine parentItem for ParentItemFileMetadata.");
      return;
    }

    const metadataAttachment =
      await ConversationManager.getOrCreateParentItemFileMetadataAttachment(
        parentItem,
      );
    const metadataFilePath = metadataAttachment.getFilePath();

    if (metadataFilePath) {
      const newContent = JSON.stringify(metadata, null, 2);
      try {
        await Zotero.File.putContentsAsync(metadataFilePath, newContent);
      } catch (e: any) {
        Zotero.debug(`Error writing to ParentItemFileMetadata file: ${e.message || String(e)}`);
      }
    }
  }

  /**
   * Synchronizes PDF attachments of a Zotero item with the Gemini File API.
   * It checks for existing files, uploads new or expired ones, and maintains a
   * metadata record of the uploaded files.
   * @param {Zotero.Item} parentItem The Zotero parent item whose attachments are to be synced.
   * @param {{ addBotMessage: Function, updateBotMessage: Function }} ui An object with UI functions to display progress.
   * @returns {Promise<ParentItemFileMetadata>} A promise that resolves to the updated file metadata.
   */
  static async synchronizePdfContext(
    parentItem: Zotero.Item,
    ui: { addBotMessage: (html: string, className?: string) => HTMLDivElement, updateBotMessage: (element: HTMLDivElement, html: string) => void }
  ): Promise<ParentItemFileMetadata> { // 戻り値を ParentItemFileMetadata に変更
    Zotero.debug("Starting PDF context synchronization...");
    const statusMessageDiv = ui.addBotMessage("Syncing PDFs...", "sync-message");

    // ParentItemFileMetadata をロード
    let parentItemFileMetadata = await ConversationManager.loadParentItemFileMetadata(parentItem);

    const childAttachmentIds = parentItem.getAttachments(false);
    const childAttachments = await Zotero.Items.getAsync(childAttachmentIds);
    const pdfAttachments = childAttachments.filter(
      (att) => (att.attachmentContentType === "application/pdf" || att.attachmentContentType === "application/x-pdf") && att.attachmentPath
    );

    let updated = false;

    const syncPromises = pdfAttachments.map(async (pdf) => {
      const pdfKey = pdf.key;
      let fileInfo = parentItemFileMetadata.files.find(
        (f) => f.zoteroAttachmentKey === pdfKey,
      );

      let needsUpload = false;
      if (fileInfo) {
        Zotero.debug(`Checking status of existing file: ${fileInfo.fileName} (${fileInfo.geminiFileUri})`);
        // Gemini APIにファイルが存在するかチェック
        // geminiFileUriからファイル名（files/xxxx）を抽出して渡す
        const geminiFileName = fileInfo.geminiFileUri.split('/').pop();
        if (!geminiFileName) {
            Zotero.logError(new Error(`Could not extract Gemini file name from URI: ${fileInfo.geminiFileUri}`));
            needsUpload = true;
        } else {
            const metadata = await getFileMetadata(`files/${geminiFileName}`); // files/をプレフィックスとして追加
            if (!metadata) {
                Zotero.debug(`File ${fileInfo.fileName} (${fileInfo.geminiFileUri}) is expired or missing. Re-uploading.`);
                needsUpload = true;
            } else {
                Zotero.debug(`File ${fileInfo.fileName} (${fileInfo.geminiFileUri}) is still valid.`);
            }
        }
      } else {
        Zotero.debug(`No existing file record for PDF: ${pdf.getField('title')}. Uploading.`);
        needsUpload = true;
      }

      if (needsUpload) {
        const pdfPath = pdf.getFilePath();
        const pdfTitle = pdf.getField("title") as string;
        if (!pdfPath) {
            Zotero.logError(new Error(`Could not get file path for PDF: ${pdfTitle}`));
            return;
        }
        try {
          ui.updateBotMessage(statusMessageDiv, `Uploading ${pdfTitle}...`);
          const uploadResult = await uploadFile(pdfPath, pdfTitle);
          
          if (uploadResult && uploadResult.uri) { // uploadResult.name は不要
            updated = true;

            const newFileInfo: ParentItemFileMetadataFile = { // ParentItemFileMetadataFile を使用
              zoteroAttachmentKey: pdfKey,
              geminiFileUri: uploadResult.uri,
              fileName: pdfTitle,
              lastUploadTimestamp: new Date().toISOString(), // タイムスタンプを追加
            };

            // 既存のファイルを更新または追加
            parentItemFileMetadata.files = parentItemFileMetadata.files.filter(
              (f) => f.zoteroAttachmentKey !== pdfKey,
            );
            parentItemFileMetadata.files.push(newFileInfo);
            Zotero.debug(`Successfully uploaded and recorded file: ${pdfTitle}`);
          } else {
            throw new Error("Upload result is invalid or missing URI.");
          }

        } catch (uploadError: any) {
          Zotero.logError(new Error(`Failed to upload ${pdfTitle}: ${uploadError.message || String(uploadError)}`));
          ui.updateBotMessage(statusMessageDiv, `Error uploading ${pdfTitle}.`);
        }
      }
    });

    await Promise.all(syncPromises);

    if (updated) {
      await ConversationManager.saveParentItemFileMetadata(parentItem, parentItemFileMetadata);
    }
    
    ui.updateBotMessage(statusMessageDiv, "PDF sync complete.");
    setTimeout(() => statusMessageDiv.remove(), 2000);

    Zotero.debug("PDF context synchronization finished.");
    return parentItemFileMetadata;
  }
}
