import { CONVERSATION_ATTACHMENT_TITLE, CONVERSATION_FILENAME } from "../../utils/constants";
import { Conversation, ConversationHistoryItem } from "../../types/chat";

export class ConversationManager {
  /**
   * Finds an existing Gemini Conversation attachment or creates a new one if it doesn't exist.
   * The conversation is stored as a JSON attachment to the parent Zotero item.
   */
  static async getOrCreateConversationAttachment(
    parentItem: Zotero.Item,
  ): Promise<Zotero.Item> {
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    for (const attachment of childAttachments) {
      if (
        (attachment.itemType as string) === "attachment" &&
        attachment.getField("title") === CONVERSATION_ATTACHMENT_TITLE &&
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      ) {
        Zotero.debug("Found existing imported conversation attachment.");
        return attachment;
      }
    }

    Zotero.debug("Creating new Gemini Conversation attachment via import.");

    const initialConversation: Conversation = {
      metadata: {
        version: "1.0",
        zoteroParentItemKey: parentItem.key,
        files: [],
        lastUploadTimestamp: new Date().toISOString(),
      },
      history: [],
    };
    const conversationJsonString = JSON.stringify(initialConversation, null, 2);
    const filename = CONVERSATION_FILENAME;

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
        title: CONVERSATION_ATTACHMENT_TITLE,
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
      } catch (cleanupError: any) {
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
  static async loadConversation(parentItem: Zotero.Item): Promise<Conversation> {
    const childAttachments = await Zotero.Items.get(parentItem.getAttachments());
    const existingAttachment = childAttachments.find(
      (att) => att.isAttachment() && att.getField("title") === CONVERSATION_ATTACHMENT_TITLE
    );

    if (existingAttachment) {
      const conversationFilePath = existingAttachment.getFilePath();
      if (conversationFilePath) {
        const content = await Zotero.File.getContentsAsync(conversationFilePath);
        if (typeof content === "string" && content.trim() !== "") {
          try {
            return JSON.parse(content) as Conversation;
          } catch (e: any) {
            Zotero.logError(new Error(`Failed to parse conversation JSON: ${e.message || String(e)}`));
            // If parsing fails, treat as no conversation
          }
        }
      }
    }

    return {
      metadata: {
        version: "1.0",
        zoteroParentItemKey: parentItem.key,
        files: [],
        lastUploadTimestamp: new Date().toISOString(),
      },
      history: [],
    };
  }

  /**
   * Saves the current conversation back to its Zotero attachment.
   */
  static async saveConversation(
    actualParentItem: Zotero.Item,
    conversation: Conversation,
  ) {
    if (!actualParentItem) {
      Zotero.debug("Could not determine actualParentItem for conversation.");
      return;
    }

    const conversationAttachment =
      await ConversationManager.getOrCreateConversationAttachment(
        actualParentItem,
      );
    const conversationFilePath = conversationAttachment.getFilePath();

    if (conversationFilePath) {
      const newContent = JSON.stringify(conversation, null, 2);
      try {
        await Zotero.File.putContentsAsync(conversationFilePath, newContent);
      } catch (e: any) {
        Zotero.debug(`Error writing to conversation file: ${e.message || String(e)}`);
      }
    }
  }

  /**
   * Adds a user message to the conversation history.
   */
  static addUserMessage(conversation: Conversation, text: string): void {
    const userMessage: ConversationHistoryItem = {
      sequence: (conversation.history.at(-1)?.sequence ?? -1) + 1,
      timestamp: new Date().toISOString(),
      role: "user",
      parts: [{ text: text }],
    };
    conversation.history.push(userMessage);
  }

  /**
   * Adds a bot message to the conversation history.
   */
  static addBotMessage(conversation: Conversation, text: string, model: string, groundingMetadata?: any): void {
    const botMessage: ConversationHistoryItem = {
      sequence: (conversation.history.at(-1)?.sequence ?? -1) + 1,
      timestamp: new Date().toISOString(),
      role: "model",
      model: model,
      parts: [{ text: text || "" }],
      groundingMetadata: groundingMetadata,
    };
    conversation.history.push(botMessage);
  }
}
