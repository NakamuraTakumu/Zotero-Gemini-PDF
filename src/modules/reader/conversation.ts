import {
  GEMINI_CHAT_TITLE_PREFIX,
  GEMINI_CHAT_FILENAME_PREFIX,
} from "../../utils/constants";
import { ChatSessionHistory, ChatMessage } from "../../types/chat";
import { v4 as uuidv4 } from "uuid";

export class ConversationManager {
  static async deleteConversation(
    parentItem: Zotero.Item,
    chatId: string,
  ): Promise<void> {
    const expectedAttachmentTitle = `${GEMINI_CHAT_TITLE_PREFIX}${chatId}`;
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );

    for (const attachment of childAttachments) {
      if (
        (attachment.itemType as string) === "attachment" &&
        attachment.getField("title") === expectedAttachmentTitle &&
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      ) {
        try {
          attachment.deleted = true;
          await attachment.saveTx(); // 添付ファイルを削除
          Zotero.debug(
            `Successfully deleted conversation attachment for chatId: ${chatId}`,
          );
          return; // 削除したら終了
        } catch (e: any) {
          Zotero.logError(
            new Error(
              `Error deleting conversation attachment ${attachment.key}: ${e.message || String(e)}`,
            ),
          );
          throw e;
        }
      }
    }
    Zotero.debug(`No conversation attachment found for chatId: ${chatId}.`);
  }
}
