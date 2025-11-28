import {
  GEMINI_CHAT_TITLE_PREFIX,
  GEMINI_CHAT_FILENAME_PREFIX,
} from "../../utils/constants";
import {
  ChatSessionHistory,
  ChatMessage,
} from "../../types/chat";
import { v4 as uuidv4 } from "uuid";

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




}
