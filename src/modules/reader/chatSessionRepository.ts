import { ChatSessionHistory } from "../../types/chat";
import {
  CHAT_ATTACHMENT_TITLE_PREFIX,
  PREVIOUS_CHAT_ATTACHMENT_TITLE_PREFIX,
} from "../../utils/constants";
import { ParentItemDataRepository } from "./parentItemDataRepository";

export interface StoredChatSession {
  history: ChatSessionHistory;
}

export class ChatSessionRepository {
  private parentItemDataRepository = new ParentItemDataRepository();

  async loadSessions(parentItem: Zotero.Item): Promise<StoredChatSession[]> {
    const parentData = await this.parentItemDataRepository.load(parentItem);
    const migratedSessions =
      await this.loadAndDeletePerSessionAttachments(parentItem);

    const chatSessions = parentData.chatSessions;
    let changed = false;

    for (const migratedSession of migratedSessions) {
      const existingSessionIndex = chatSessions.findIndex(
        (session) =>
          session.metadata.chatId === migratedSession.metadata.chatId,
      );
      if (existingSessionIndex >= 0) {
        chatSessions[existingSessionIndex] = migratedSession;
      } else {
        chatSessions.push(migratedSession);
      }
      changed = true;
    }

    if (changed) {
      parentData.chatSessions = chatSessions;
      await this.parentItemDataRepository.save(parentItem, parentData);
    }

    Zotero.log(
      `[ChatSessionRepository] Loaded ${chatSessions.length} sessions for parent item ${parentItem.key}.`,
    );
    return chatSessions.map((history) => ({ history }));
  }

  async saveSession(
    parentItem: Zotero.Item,
    history: ChatSessionHistory,
  ): Promise<void> {
    const parentData = await this.parentItemDataRepository.load(parentItem);
    const sessionIndex = parentData.chatSessions.findIndex(
      (session) => session.metadata.chatId === history.metadata.chatId,
    );
    if (sessionIndex >= 0) {
      parentData.chatSessions[sessionIndex] = history;
    } else {
      parentData.chatSessions.push(history);
    }
    await this.parentItemDataRepository.save(parentItem, parentData);
  }

  async deleteSession(parentItem: Zotero.Item, chatId: string): Promise<void> {
    const parentData = await this.parentItemDataRepository.load(parentItem);
    const initialLength = parentData.chatSessions.length;
    parentData.chatSessions = parentData.chatSessions.filter(
      (session) => session.metadata.chatId !== chatId,
    );

    if (parentData.chatSessions.length !== initialLength) {
      await this.parentItemDataRepository.save(parentItem, parentData);
    }
    Zotero.debug(
      `[ChatSessionRepository] Deleted chat session from parent store: ${chatId}`,
    );
  }

  private async loadAndDeletePerSessionAttachments(
    parentItem: Zotero.Item,
  ): Promise<ChatSessionHistory[]> {
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    const sessions: ChatSessionHistory[] = [];

    for (const attachment of childAttachments) {
      if (!this.isPerSessionChatAttachment(attachment)) {
        continue;
      }

      try {
        const conversationFilePath = attachment.getFilePath();
        if (conversationFilePath) {
          const content =
            await Zotero.File.getContentsAsync(conversationFilePath);
          if (typeof content === "string" && content.trim() !== "") {
            const history = this.parseSessionHistory(content, attachment.key);
            if (history) {
              sessions.push(history);
            }
          }
        }

        attachment.deleted = true;
        await attachment.saveTx();
        Zotero.debug(
          `[ChatSessionRepository] Migrated and deleted per-session chat attachment ${attachment.key}.`,
        );
      } catch (e: any) {
        Zotero.logError(
          new Error(
            `[ChatSessionRepository] Failed to migrate conversation attachment ${attachment.key}: ${
              e.message || String(e)
            }`,
          ),
        );
      }
    }

    return sessions;
  }

  private isPerSessionChatAttachment(attachment: Zotero.Item): boolean {
    const title = attachment.getField("title") || "";
    const hasChatSessionTitle =
      title.startsWith(CHAT_ATTACHMENT_TITLE_PREFIX) ||
      title.startsWith(PREVIOUS_CHAT_ATTACHMENT_TITLE_PREFIX);
    return (
      (attachment.itemType as string) === "attachment" &&
      hasChatSessionTitle &&
      attachment.attachmentLinkMode ===
        Zotero.Attachments.LINK_MODE_IMPORTED_FILE
    );
  }

  private parseSessionHistory(
    content: string,
    attachmentKey: string,
  ): ChatSessionHistory | undefined {
    const parsed = JSON.parse(content) as Partial<ChatSessionHistory>;
    if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.messages)) {
      Zotero.debug(
        `[ChatSessionRepository] Ignoring incompatible chat attachment ${attachmentKey}; expected schemaVersion=2 and messages[].`,
      );
      return undefined;
    }
    return parsed as ChatSessionHistory;
  }
}
