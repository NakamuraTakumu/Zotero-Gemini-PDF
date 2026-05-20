// gemini-pdf/src/modules/reader/pdfSyncManager.ts

import {
  PARENT_ITEM_FILE_METADATA_FILENAME_PREFIX,
  PARENT_ITEM_FILE_METADATA_TITLE_PREFIX,
} from "../../utils/constants";
import { getSelectedProvider } from "../llm/provider";
import { getPdfUploadAdapter } from "../llm/pdfUploadAdapters";
import { UIManager } from "./ui";
import {
  ParentItemFileMetadata,
  ParentItemFileMetadataFile,
  ProviderId,
} from "../../types/chat";

/**
 * Manages the synchronization of PDF files with the selected provider's file API,
 * including the persistence of synchronization metadata.
 */
export class PdfFileSyncManager {
  private static inFlightSyncs = new Map<
    string,
    Promise<ParentItemFileMetadata>
  >();
  private parentItemFileMetadata: ParentItemFileMetadata | null = null;
  private provider: ProviderId | null = null;

  constructor() {}

  /**
   * Ensures that the PDF attachments for the current item are synchronized with the selected provider's file API.
   * This method shows UI feedback during the process and returns the latest metadata.
   * @param parentItem The Zotero parent item.
   * @param uiManager The UI manager to display messages.
   * @returns {Promise<ParentItemFileMetadata | null>} The synchronized metadata, or null on failure.
   */
  public async ensurePdfContext(
    parentItem: Zotero.Item,
    uiManager: UIManager,
  ): Promise<ParentItemFileMetadata | null> {
    if (!parentItem) {
      Zotero.logError(new Error("Cannot sync PDF context, no parent item."));
      return null;
    }

    try {
      this.provider = getSelectedProvider();
      const syncKey = `${parentItem.key}:${this.provider}`;
      let syncPromise = PdfFileSyncManager.inFlightSyncs.get(syncKey);
      if (!syncPromise) {
        syncPromise = this._synchronizePdfAttachments(
          parentItem,
          uiManager,
          this.provider,
        ).finally(() => {
          PdfFileSyncManager.inFlightSyncs.delete(syncKey);
        });
        PdfFileSyncManager.inFlightSyncs.set(syncKey, syncPromise);
      } else {
        Zotero.debug(`[Gemini PDF] Reusing in-flight PDF sync for ${syncKey}.`);
      }

      this.parentItemFileMetadata = await syncPromise;
      return this.parentItemFileMetadata;
    } catch (e: any) {
      const errorMessage = e.message || String(e);
      Zotero.logError(new Error(`Error synchronizing PDFs: ${errorMessage}`));
      uiManager.addBotMessage(
        `Error synchronizing PDFs: ${errorMessage}`,
        "error-message",
      );
      return null;
    }
  }

  /**
   * Synchronizes PDF attachments of a Zotero item with the selected provider's file API.
   * It checks for existing files, uploads new or expired ones, and maintains a
   * metadata record of the uploaded files.
   */
  private async _synchronizePdfAttachments(
    parentItem: Zotero.Item,
    ui: UIManager,
    provider: ProviderId,
  ): Promise<ParentItemFileMetadata> {
    Zotero.debug("Starting PDF context synchronization...");
    const statusMessageDiv = ui.addBotMessage(
      `Syncing PDFs for ${provider}...`,
      "sync-message",
    );
    const adapter = getPdfUploadAdapter(provider);

    const metadata = await this._loadParentItemFileMetadata(parentItem);
    let updated = false;

    const childAttachmentIds = parentItem.getAttachments(false);
    const childAttachments = await Zotero.Items.getAsync(childAttachmentIds);
    const pdfAttachments = childAttachments.filter(
      (att) =>
        (att.attachmentContentType === "application/pdf" ||
          att.attachmentContentType === "application/x-pdf") &&
        att.attachmentPath,
    );

    const syncPromises = pdfAttachments.map(async (pdf) => {
      const pdfKey = pdf.key;
      const fileInfo = metadata.files.find(
        (f) => f.zoteroAttachmentKey === pdfKey,
      );
      const pdfPath = await pdf.getFilePathAsync();
      const pdfTitle = (pdf.getField("title") as string) || "attachment.pdf";
      const lastModified = (await pdf.attachmentModificationTime) || undefined;

      if (!pdfPath) {
        Zotero.logError(
          new Error(`Could not get file path for PDF: ${pdfTitle}`),
        );
        return;
      }

      let targetFileInfo = fileInfo;
      if (!targetFileInfo) {
        targetFileInfo = {
          zoteroAttachmentKey: pdfKey,
          fileName: pdfTitle,
          lastModified,
          uploads: [],
        };
        metadata.files.push(targetFileInfo);
        updated = true;
      } else {
        targetFileInfo.fileName = targetFileInfo.fileName || pdfTitle;
        targetFileInfo.lastModified = lastModified;
        targetFileInfo.uploads = Array.isArray(targetFileInfo.uploads)
          ? targetFileInfo.uploads
          : [];
      }

      let needsUpload = false;
      const uploadInfo = targetFileInfo.uploads.find(
        (upload) => upload.provider === provider,
      );
      if (uploadInfo) {
        Zotero.debug(
          `Checking ${provider} upload for PDF: ${targetFileInfo.fileName}`,
        );
        const isAvailable = await adapter.isUploadAvailable(uploadInfo);
        if (!isAvailable) {
          Zotero.debug(
            `${provider} upload for ${targetFileInfo.fileName} is expired or missing. Re-uploading.`,
          );
          needsUpload = true;
        } else {
          Zotero.debug(
            `${provider} upload for ${targetFileInfo.fileName} is still valid.`,
          );
        }
      } else {
        Zotero.debug(
          `No ${provider} upload record for PDF: ${pdfTitle}. Uploading.`,
        );
        needsUpload = true;
      }

      if (needsUpload) {
        try {
          Zotero.log(
            `[Gemini PDF] Uploading PDF to ${provider}: ${pdfTitle} (${pdfPath})`,
          );
          ui.updateBotMessage(
            statusMessageDiv,
            `Uploading ${pdfTitle} to ${provider}...`,
          );
          const uploadResult = await adapter.uploadPdf(pdfPath, pdfTitle);
          targetFileInfo.uploads = targetFileInfo.uploads.filter(
            (upload) => upload.provider !== provider,
          );
          targetFileInfo.uploads.push(uploadResult);
          updated = true;
          Zotero.log(
            `Successfully uploaded and recorded ${provider} file: ${pdfTitle}`,
          );
        } catch (uploadError: any) {
          const uploadErrorMessage = uploadError.message || String(uploadError);
          Zotero.log(
            `[Gemini PDF] Failed to upload PDF to ${provider}: ${pdfTitle}: ${uploadErrorMessage}`,
          );
          Zotero.logError(
            new Error(
              `Failed to upload ${pdfTitle} to ${provider}: ${uploadErrorMessage}`,
            ),
          );
          ui.updateBotMessage(
            statusMessageDiv,
            `Error uploading ${pdfTitle} to ${provider}: ${uploadErrorMessage}`,
          );
          throw uploadError;
        }
      }
    });

    const syncResults = await Promise.allSettled(syncPromises);
    const firstSyncError = syncResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (updated) {
      await this._saveParentItemFileMetadata(parentItem, metadata);
    }

    if (firstSyncError) {
      throw firstSyncError.reason;
    }

    ui.updateBotMessage(statusMessageDiv, "PDF sync complete.");
    setTimeout(() => statusMessageDiv.remove(), 2000);

    Zotero.debug("PDF context synchronization finished.");
    return metadata;
  }

  /**
   * Loads the ParentItemFileMetadata from the attachment associated with the parent item.
   */
  private async _loadParentItemFileMetadata(
    parentItem: Zotero.Item,
  ): Promise<ParentItemFileMetadata> {
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    const attachmentTitle = `${PARENT_ITEM_FILE_METADATA_TITLE_PREFIX}${parentItem.key}`;
    const existingAttachment = childAttachments.find((att) => {
      const currentAttachmentTitle = att.getField("title");
      return (
        att.isAttachment() &&
        (currentAttachmentTitle === attachmentTitle ||
          currentAttachmentTitle === `${attachmentTitle}.json`)
      );
    });

    if (existingAttachment) {
      const metadataFilePath = existingAttachment.getFilePath();
      if (metadataFilePath) {
        const content = await Zotero.File.getContentsAsync(metadataFilePath);
        if (typeof content === "string" && content.trim() !== "") {
          try {
            return this._normalizeMetadata(
              JSON.parse(content) as ParentItemFileMetadata,
            );
          } catch (e: any) {
            Zotero.logError(
              new Error(
                `Failed to parse ParentItemFileMetadata JSON: ${
                  e.message || String(e)
                }`,
              ),
            );
          }
        }
      }
    }

    return {
      zoteroParentItemKey: parentItem.key,
      files: [],
    };
  }

  private _normalizeMetadata(
    metadata: ParentItemFileMetadata,
  ): ParentItemFileMetadata {
    return {
      zoteroParentItemKey: metadata.zoteroParentItemKey,
      files: (metadata.files || []).map((file) => ({
        zoteroAttachmentKey: file.zoteroAttachmentKey,
        fileName: file.fileName,
        lastModified: file.lastModified,
        uploads: Array.isArray(file.uploads) ? file.uploads : [],
      })),
    };
  }

  /**
   * Saves the ParentItemFileMetadata back to its Zotero attachment.
   */
  private async _saveParentItemFileMetadata(
    parentItem: Zotero.Item,
    metadata: ParentItemFileMetadata,
  ) {
    if (!parentItem) {
      Zotero.debug(
        "Could not determine parentItem for ParentItemFileMetadata.",
      );
      return;
    }

    const metadataAttachment =
      await this._getOrCreateParentItemFileMetadataAttachment(parentItem);
    const metadataFilePath = metadataAttachment.getFilePath();

    if (metadataFilePath) {
      const newContent = JSON.stringify(metadata, null, 2);
      try {
        await Zotero.File.putContentsAsync(metadataFilePath, newContent);
      } catch (e: any) {
        Zotero.debug(
          `Error writing to ParentItemFileMetadata file: ${
            e.message || String(e)
          }`,
        );
        throw e;
      }
    } else {
      throw new Error("Could not get file path for ParentItemFileMetadata.");
    }
  }

  /**
   * Finds an existing ParentItemFileMetadata attachment or creates a new one if it doesn't exist.
   */
  private async _getOrCreateParentItemFileMetadataAttachment(
    parentItem: Zotero.Item,
  ): Promise<Zotero.Item> {
    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    const attachmentTitle = `${PARENT_ITEM_FILE_METADATA_TITLE_PREFIX}${parentItem.key}`;

    for (const attachment of childAttachments) {
      const currentAttachmentTitle = attachment.getField("title");
      if (
        (attachment.itemType as string) === "attachment" &&
        (currentAttachmentTitle === attachmentTitle ||
          currentAttachmentTitle === `${attachmentTitle}.json`) &&
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      ) {
        Zotero.debug(
          `Found existing ParentItemFileMetadata attachment for ${parentItem.key}.`,
        );
        return attachment;
      }
    }

    Zotero.debug(
      `Creating new ParentItemFileMetadata attachment for ${parentItem.key}.`,
    );

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
        saveOptions: {
          // Keep current item selection to avoid closing or switching the reader tab.
          skipSelect: true,
        },
      });

      Zotero.debug(
        `Successfully created new ParentItemFileMetadata attachment with key ${newAttachment.key}`,
      );
      return newAttachment;
    } catch (e: any) {
      Zotero.logError(
        new Error(
          `Error creating ParentItemFileMetadata attachment from temp file: ${
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
}
