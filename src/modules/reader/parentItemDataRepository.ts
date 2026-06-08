import {
  ChatSessionHistory,
  ParentItemFileMetadata,
  ParentItemFileMetadataFile,
} from "../../types/chat";
import {
  PARENT_ITEM_DATA_FILENAME_PREFIX,
  PARENT_ITEM_DATA_TITLE_PREFIX,
  LEGACY_GEMINI_FILE_METADATA_TITLE_PREFIX,
  PREVIOUS_PARENT_ITEM_FILE_METADATA_TITLE_PREFIX,
} from "../../utils/constants";

export class ParentItemDataRepository {
  async load(parentItem: Zotero.Item): Promise<ParentItemFileMetadata> {
    const attachment = await this.findParentDataAttachment(parentItem);
    await this.deleteObsoleteParentDataAttachments(parentItem, attachment?.key);
    if (!attachment) {
      return this.createEmptyData(parentItem);
    }

    const metadataFilePath = attachment.getFilePath();
    if (!metadataFilePath) {
      return this.createEmptyData(parentItem);
    }

    const content = await Zotero.File.getContentsAsync(metadataFilePath);
    if (typeof content !== "string" || content.trim() === "") {
      return this.createEmptyData(parentItem);
    }

    try {
      return this.normalizeData(
        JSON.parse(content) as Partial<ParentItemFileMetadata>,
        parentItem,
      );
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ParentItemDataRepository] Failed to parse parent item data JSON: ${
            e.message || String(e)
          }`,
        ),
      );
      return this.createEmptyData(parentItem);
    }
  }

  async save(
    parentItem: Zotero.Item,
    data: ParentItemFileMetadata,
  ): Promise<void> {
    const attachment = await this.getOrCreateParentDataAttachment(parentItem);
    await this.deleteObsoleteParentDataAttachments(parentItem, attachment.key);
    const metadataFilePath = attachment.getFilePath();
    if (!metadataFilePath) {
      throw new Error("Could not get file path for parent item data.");
    }

    const normalizedData = this.normalizeData(data, parentItem);
    await Zotero.File.putContentsAsync(
      metadataFilePath,
      JSON.stringify(normalizedData, null, 2),
    );
  }

  private createEmptyData(parentItem: Zotero.Item): ParentItemFileMetadata {
    return {
      zoteroParentItemKey: parentItem.key,
      files: [],
      chatSessions: [],
    };
  }

  private normalizeData(
    data: Partial<ParentItemFileMetadata>,
    parentItem: Zotero.Item,
  ): ParentItemFileMetadata {
    return {
      zoteroParentItemKey: data.zoteroParentItemKey || parentItem.key,
      files: this.normalizeFiles(data.files),
      chatSessions: this.normalizeChatSessions(data.chatSessions, parentItem),
    };
  }

  private normalizeFiles(
    files: ParentItemFileMetadataFile[] | undefined,
  ): ParentItemFileMetadataFile[] {
    return (files || []).map((file) => ({
      libraryID:
        typeof file.libraryID === "number" ? file.libraryID : undefined,
      zoteroAttachmentKey: file.zoteroAttachmentKey,
      fileName: file.fileName,
      lastModified: file.lastModified,
      uploads: Array.isArray(file.uploads) ? file.uploads : [],
    }));
  }

  private normalizeChatSessions(
    chatSessions: ChatSessionHistory[] | undefined,
    parentItem: Zotero.Item,
  ): ChatSessionHistory[] {
    return (chatSessions || [])
      .filter(
        (session) =>
          session?.schemaVersion === 2 &&
          Boolean(session.metadata?.chatId) &&
          Array.isArray(session.messages),
      )
      .map((session) => ({
        schemaVersion: 2,
        metadata: {
          ...session.metadata,
          zoteroParentItemKey: parentItem.key,
        },
        messages: session.messages,
      }));
  }

  private async getOrCreateParentDataAttachment(
    parentItem: Zotero.Item,
  ): Promise<Zotero.Item> {
    const existingAttachment = await this.findParentDataAttachment(parentItem);
    if (existingAttachment) {
      const expectedTitle = `${PARENT_ITEM_DATA_TITLE_PREFIX}${parentItem.key}`;
      if (existingAttachment.getField("title") !== expectedTitle) {
        existingAttachment.setField("title", expectedTitle);
        await existingAttachment.saveTx();
      }
      return existingAttachment;
    }

    return this.createParentDataAttachment(parentItem);
  }

  private async findParentDataAttachment(
    parentItem: Zotero.Item,
  ): Promise<Zotero.Item | undefined> {
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    const currentTitle = `${PARENT_ITEM_DATA_TITLE_PREFIX}${parentItem.key}`;
    const previousTitle = `${PREVIOUS_PARENT_ITEM_FILE_METADATA_TITLE_PREFIX}${parentItem.key}`;

    return childAttachments.find((attachment) => {
      const attachmentTitle = attachment.getField("title");
      return (
        (attachment.itemType as string) === "attachment" &&
        (attachmentTitle === currentTitle ||
          attachmentTitle === `${currentTitle}.json` ||
          attachmentTitle === previousTitle ||
          attachmentTitle === `${previousTitle}.json`) &&
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      );
    });
  }

  private async deleteObsoleteParentDataAttachments(
    parentItem: Zotero.Item,
    keepAttachmentKey?: string,
  ): Promise<void> {
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    const obsoleteTitles = [
      `${PREVIOUS_PARENT_ITEM_FILE_METADATA_TITLE_PREFIX}${parentItem.key}`,
      `${LEGACY_GEMINI_FILE_METADATA_TITLE_PREFIX}${parentItem.key}`,
    ];

    for (const attachment of childAttachments) {
      if (attachment.key === keepAttachmentKey) {
        continue;
      }
      const title = attachment.getField("title");
      const isObsoleteParentDataAttachment = obsoleteTitles.some(
        (obsoleteTitle) =>
          title === obsoleteTitle || title === `${obsoleteTitle}.json`,
      );
      if (
        (attachment.itemType as string) === "attachment" &&
        isObsoleteParentDataAttachment &&
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      ) {
        attachment.deleted = true;
        await attachment.saveTx();
        Zotero.debug(
          `[ParentItemDataRepository] Deleted obsolete parent item data attachment ${attachment.key}.`,
        );
      }
    }
  }

  private async createParentDataAttachment(
    parentItem: Zotero.Item,
  ): Promise<Zotero.Item> {
    Zotero.debug(
      `[ParentItemDataRepository] Creating parent item data attachment for ${parentItem.key}.`,
    );

    const filename = `${PARENT_ITEM_DATA_FILENAME_PREFIX}${parentItem.key}.json`;
    const tempDir = Zotero.getTempDirectory();
    const tempFileName = `${Zotero.Utilities.randomString()}-${filename}`;
    tempDir.append(tempFileName);
    const tempFilePath = tempDir.path;

    try {
      await Zotero.File.putContentsAsync(
        tempFilePath,
        JSON.stringify(this.createEmptyData(parentItem), null, 2),
      );
      const tempFile = Zotero.File.pathToFile(tempFilePath);

      return await Zotero.Attachments.importFromFile({
        file: tempFile,
        parentItemID: parentItem.id,
        contentType: "application/json",
        title: `${PARENT_ITEM_DATA_TITLE_PREFIX}${parentItem.key}`,
        saveOptions: {
          // Keep current item selection to avoid closing or switching the reader tab.
          skipSelect: true,
        },
      });
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `[ParentItemDataRepository] Error creating parent item data attachment: ${
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
        }
      } catch (cleanupError: any) {
        Zotero.logError(
          new Error(
            `[ParentItemDataRepository] Failed to clean up temporary file ${tempFilePath}: ${
              cleanupError.message || String(cleanupError)
            }`,
          ),
        );
      }
    }
  }
}
