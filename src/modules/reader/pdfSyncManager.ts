// gemini-pdf/src/modules/reader/pdfSyncManager.ts

import {
  PREF_API_KEY,
  PARENT_ITEM_FILE_METADATA_FILENAME_PREFIX,
  PARENT_ITEM_FILE_METADATA_TITLE_PREFIX,
} from "../../utils/constants";
import { getPref } from "../../utils/prefs";
import { uploadFile, getFileMetadata } from "../geminiApi";
import { UIManager } from "./ui";
import {
  ParentItemFileMetadata,
  ParentItemFileMetadataFile,
} from "../../types/chat";

/**
 * Manages the synchronization of PDF files with the Gemini File API,
 * including the persistence of synchronization metadata.
 */
export class PdfFileSyncManager {
  private parentItemFileMetadata: ParentItemFileMetadata | null = null;

  constructor() {}

  /**
   * Ensures that the PDF attachments for the current item are synchronized with the Gemini File API.
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

    const apiKey = getPref(PREF_API_KEY);
    if (!apiKey) {
      const errorMessage = "Gemini API key is not set.";
      Zotero.logError(new Error(errorMessage));
      uiManager.addBotMessage(errorMessage, "error-message");
      return null;
    }

    try {
      this.parentItemFileMetadata = await this._synchronizePdfAttachments(
        parentItem,
        uiManager,
      );
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
   * Synchronizes PDF attachments of a Zotero item with the Gemini File API.
   * It checks for existing files, uploads new or expired ones, and maintains a
   * metadata record of the uploaded files.
   */
  private async _synchronizePdfAttachments(
    parentItem: Zotero.Item,
    ui: UIManager,
  ): Promise<ParentItemFileMetadata> {
    Zotero.debug("Starting PDF context synchronization...");
    const statusMessageDiv = ui.addBotMessage(
      "Syncing PDFs...",
      "sync-message",
    );

    const metadata = await this._loadParentItemFileMetadata(parentItem);

    const childAttachmentIds = parentItem.getAttachments(false);
    const childAttachments = await Zotero.Items.getAsync(childAttachmentIds);
    const pdfAttachments = childAttachments.filter(
      (att) =>
        (att.attachmentContentType === "application/pdf" ||
          att.attachmentContentType === "application/x-pdf") &&
        att.attachmentPath,
    );

    let updated = false;

    const syncPromises = pdfAttachments.map(async (pdf) => {
      const pdfKey = pdf.key;
      const fileInfo = metadata.files.find(
        (f) => f.zoteroAttachmentKey === pdfKey,
      );

      let needsUpload = false;
      if (fileInfo) {
        Zotero.debug(
          `Checking status of existing file: ${fileInfo.fileName} (${fileInfo.geminiFileUri})`,
        );
        const geminiFileName = fileInfo.geminiFileUri.split("/").pop();
        if (!geminiFileName) {
          Zotero.logError(
            new Error(
              `Could not extract Gemini file name from URI: ${fileInfo.geminiFileUri}`,
            ),
          );
          needsUpload = true;
        } else {
          const fileApiMetadata = await getFileMetadata(
            `files/${geminiFileName}`,
          );
          if (!fileApiMetadata) {
            Zotero.debug(
              `File ${fileInfo.fileName} (${fileInfo.geminiFileUri}) is expired or missing. Re-uploading.`,
            );
            needsUpload = true;
          } else {
            Zotero.debug(
              `File ${fileInfo.fileName} (${fileInfo.geminiFileUri}) is still valid.`,
            );
          }
        }
      } else {
        Zotero.debug(
          `No existing file record for PDF: ${pdf.getField("title")}. Uploading.`,
        );
        needsUpload = true;
      }

      if (needsUpload) {
        const pdfPath = pdf.getFilePath();
        const pdfTitle = pdf.getField("title") as string;
        if (!pdfPath) {
          Zotero.logError(
            new Error(`Could not get file path for PDF: ${pdfTitle}`),
          );
          return;
        }
        try {
          ui.updateBotMessage(statusMessageDiv, `Uploading ${pdfTitle}...`);
          const uploadResult = await uploadFile(pdfPath, pdfTitle);

          if (uploadResult && uploadResult.uri) {
            updated = true;

            const newFileInfo: ParentItemFileMetadataFile = {
              zoteroAttachmentKey: pdfKey,
              geminiFileUri: uploadResult.uri,
              fileName: pdfTitle,
              lastUploadTimestamp: new Date().toISOString(),
            };

            metadata.files = metadata.files.filter(
              (f) => f.zoteroAttachmentKey !== pdfKey,
            );
            metadata.files.push(newFileInfo);
            Zotero.debug(
              `Successfully uploaded and recorded file: ${pdfTitle}`,
            );
          } else {
            throw new Error("Upload result is invalid or missing URI.");
          }
        } catch (uploadError: any) {
          Zotero.logError(
            new Error(
              `Failed to upload ${pdfTitle}: ${
                uploadError.message || String(uploadError)
              }`,
            ),
          );
          ui.updateBotMessage(statusMessageDiv, `Error uploading ${pdfTitle}.`);
        }
      }
    });

    await Promise.all(syncPromises);

    if (updated) {
      await this._saveParentItemFileMetadata(parentItem, metadata);
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
            return JSON.parse(content) as ParentItemFileMetadata;
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
      }
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
