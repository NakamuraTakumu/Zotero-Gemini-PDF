import { ChatSessionHistory } from "../../types/chat";
import {
  GEMINI_CHAT_FILENAME_PREFIX,
  GEMINI_CHAT_TITLE_PREFIX,
} from "../../utils/constants";

export interface StoredChatSession {
  history: ChatSessionHistory;
  attachment: Zotero.Item;
}

export class ChatSessionRepository {
  async loadSessions(parentItem: Zotero.Item): Promise<StoredChatSession[]> {
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    Zotero.log(
      `[ChatSessionRepository] Processing attachments for parent item ${parentItem.key}. Found ${childAttachments.length} attachments.`,
    );

    const sessions: StoredChatSession[] = [];
    for (const attachment of childAttachments) {
      if (!this.isChatAttachment(attachment)) {
        continue;
      }

      const conversationFilePath = attachment.getFilePath();
      if (!conversationFilePath) {
        continue;
      }

      try {
        const content =
          await Zotero.File.getContentsAsync(conversationFilePath);
        if (typeof content === "string" && content.trim() !== "") {
          const history = JSON.parse(content) as ChatSessionHistory;
          sessions.push({ history, attachment });
          Zotero.log(
            `[ChatSessionRepository] Loaded session with ID: ${history.metadata.chatId}, Title: "${history.metadata.chatTitle}"`,
          );
        }
      } catch (e: any) {
        Zotero.logError(
          new Error(
            `[ChatSessionRepository] Failed to parse conversation JSON from attachment ${attachment.key} (Path: ${conversationFilePath}): ${
              e.message || String(e)
            }`,
          ),
        );
      }
    }

    return sessions;
  }

  async getOrCreateAttachment(
    parentItem: Zotero.Item,
    history: ChatSessionHistory,
  ): Promise<Zotero.Item> {
    const existingAttachment = await this.findAttachmentByChatId(
      parentItem,
      history.metadata.chatId,
    );
    if (existingAttachment) {
      return existingAttachment;
    }

    return this.createAttachment(parentItem, history);
  }

  async saveSession(
    attachment: Zotero.Item,
    history: ChatSessionHistory,
  ): Promise<void> {
    const conversationFilePath = attachment.getFilePath();
    if (!conversationFilePath) {
      Zotero.logError(
        new Error(
          `[ChatSessionRepository] Could not get file path for conversation attachment ${attachment.key}.`,
        ),
      );
      return;
    }

    try {
      await Zotero.File.putContentsAsync(
        conversationFilePath,
        JSON.stringify(history, null, 2),
      );
    } catch (e: any) {
      Zotero.log(
        `Error writing to conversation file: ${e.message || String(e)}`,
      );
    }
  }

  async deleteSession(attachment: Zotero.Item, chatId: string): Promise<void> {
    try {
      attachment.deleted = true;
      await attachment.saveTx();
      Zotero.debug(
        `[ChatSessionRepository] Deleted conversation attachment for chatId: ${chatId}`,
      );
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ChatSessionRepository] Error deleting conversation attachment ${attachment.key}: ${
            e.message || String(e)
          }`,
        ),
      );
      throw e;
    }
  }

  async updateAttachmentTitle(
    attachment: Zotero.Item,
    sessionTitle: string,
  ): Promise<void> {
    const newAttachmentTitle = `${GEMINI_CHAT_TITLE_PREFIX}${sessionTitle}`;
    if (attachment.getField("title") !== newAttachmentTitle) {
      attachment.setField("title", newAttachmentTitle);
      await attachment.saveTx();
      Zotero.debug(
        `[ChatSessionRepository] Attachment title updated to "${newAttachmentTitle}"`,
      );
    }
  }

  private async findAttachmentByChatId(
    parentItem: Zotero.Item,
    chatId: string,
  ): Promise<Zotero.Item | undefined> {
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    Zotero.log(
      `[ChatSessionRepository] Looking for chatId ${chatId} in ${childAttachments.length} attachments for parent item ${parentItem.key}.`,
    );

    for (const attachment of childAttachments) {
      if (!this.isChatAttachment(attachment)) {
        continue;
      }

      const conversationFilePath = attachment.getFilePath();
      if (!conversationFilePath) {
        continue;
      }

      try {
        const content =
          await Zotero.File.getContentsAsync(conversationFilePath);
        if (typeof content !== "string" || content.trim() === "") {
          continue;
        }
        const parsedHistory = JSON.parse(content) as ChatSessionHistory;
        if (parsedHistory.metadata.chatId === chatId) {
          Zotero.log(
            `[ChatSessionRepository] Found matching chat attachment by chatId: ${attachment.key}`,
          );
          return attachment;
        }
      } catch (e: any) {
        Zotero.logError(
          new Error(
            `[ChatSessionRepository] Error parsing attachment ${attachment.key} content: ${
              e.message || String(e)
            }`,
          ),
        );
      }
    }

    return undefined;
  }

  private async createAttachment(
    parentItem: Zotero.Item,
    history: ChatSessionHistory,
  ): Promise<Zotero.Item> {
    const chatId = history.metadata.chatId;
    const newAttachmentTitle = `${GEMINI_CHAT_TITLE_PREFIX}${chatId}`;
    const filename = `${GEMINI_CHAT_FILENAME_PREFIX}${chatId}.json`;
    const tempDir = Zotero.getTempDirectory();
    const tempFileName = `${Zotero.Utilities.randomString()}-${filename}`;
    tempDir.append(tempFileName);
    const tempFilePath = tempDir.path;

    try {
      await Zotero.File.putContentsAsync(
        tempFilePath,
        JSON.stringify(history, null, 2),
      );
      const tempFile = Zotero.File.pathToFile(tempFilePath);

      const newAttachment = await Zotero.Attachments.importFromFile({
        file: tempFile,
        parentItemID: parentItem.id,
        contentType: "application/json",
        title: newAttachmentTitle,
        saveOptions: {
          // Prevent selection change that can disrupt the active PDF reader tab.
          skipSelect: true,
        },
      });

      Zotero.debug(
        `[ChatSessionRepository] Created conversation attachment with key ${newAttachment.key}`,
      );
      return newAttachment;
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ChatSessionRepository] Error creating attachment from temp file: ${
            e.message || String(e)
          }`,
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
            `Failed to clean up temporary file ${tempFilePath}: ${
              cleanupError.message || String(cleanupError)
            }`,
          ),
        );
      }
    }
  }

  private isChatAttachment(attachment: Zotero.Item): boolean {
    return (
      (attachment.itemType as string) === "attachment" &&
      Boolean(
        attachment.getField("title")?.startsWith(GEMINI_CHAT_TITLE_PREFIX),
      ) &&
      attachment.attachmentLinkMode ===
        Zotero.Attachments.LINK_MODE_IMPORTED_FILE
    );
  }
}
