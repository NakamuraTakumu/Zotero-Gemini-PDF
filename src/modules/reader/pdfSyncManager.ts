import {
  getCitationRenderProvider,
  getSelectedProvider,
} from "../llm/provider";
import { getPdfUploadAdapter } from "../llm/pdfUploadAdapters";
import { UIManager } from "./ui";
import {
  ParentItemFileMetadata,
  ParentItemFileMetadataFile,
  ProviderId,
} from "../../types/chat";
import { ParentItemDataRepository } from "./parentItemDataRepository";

export function isPdfUploadStale(
  previousLastModified: number | undefined,
  currentLastModified: number | undefined,
): boolean {
  return (
    typeof previousLastModified === "number" &&
    typeof currentLastModified === "number" &&
    previousLastModified !== currentLastModified
  );
}

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
  private parentItemDataRepository = new ParentItemDataRepository();

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
      const renderProvider = getCitationRenderProvider();
      const providers = Array.from(new Set([this.provider, renderProvider]));
      let metadata: ParentItemFileMetadata | null = null;
      for (const provider of providers) {
        metadata = await this.synchronizeProvider(
          parentItem,
          uiManager,
          provider,
        );
      }
      this.parentItemFileMetadata = metadata;
      return this.parentItemFileMetadata;
    } catch {
      Zotero.logError(new Error("[Ask My Paper] Error synchronizing PDFs."));
      uiManager.addBotMessage(
        "PDFを同期できませんでした。しばらくしてからもう一度お試しください。",
        "error-message",
      );
      return null;
    }
  }

  private async synchronizeProvider(
    parentItem: Zotero.Item,
    uiManager: UIManager,
    provider: ProviderId,
  ): Promise<ParentItemFileMetadata> {
    const syncKey = `${parentItem.key}:${provider}`;
    let syncPromise = PdfFileSyncManager.inFlightSyncs.get(syncKey);
    if (!syncPromise) {
      syncPromise = this._synchronizePdfAttachments(
        parentItem,
        uiManager,
        provider,
      ).finally(() => {
        PdfFileSyncManager.inFlightSyncs.delete(syncKey);
      });
      PdfFileSyncManager.inFlightSyncs.set(syncKey, syncPromise);
    } else {
      Zotero.debug(`[Ask My Paper] Reusing in-flight PDF sync for ${syncKey}.`);
    }
    return syncPromise;
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
          new Error("[Ask My Paper] Could not access a PDF file."),
        );
        return;
      }

      let targetFileInfo = fileInfo;
      let localFileChanged = false;
      if (!targetFileInfo) {
        targetFileInfo = {
          libraryID: pdf.libraryID,
          zoteroAttachmentKey: pdfKey,
          fileName: pdfTitle,
          lastModified,
          uploads: [],
        };
        metadata.files.push(targetFileInfo);
        updated = true;
      } else {
        localFileChanged = isPdfUploadStale(
          targetFileInfo.lastModified,
          lastModified,
        );
        targetFileInfo.libraryID = targetFileInfo.libraryID || pdf.libraryID;
        targetFileInfo.fileName = targetFileInfo.fileName || pdfTitle;
        targetFileInfo.lastModified = lastModified;
        targetFileInfo.uploads = Array.isArray(targetFileInfo.uploads)
          ? targetFileInfo.uploads
          : [];
      }

      let needsUpload = localFileChanged;
      const uploadInfo = targetFileInfo.uploads.find(
        (upload) => upload.provider === provider,
      );
      if (localFileChanged) {
        Zotero.debug(
          `${provider} upload for ${targetFileInfo.fileName} is stale because the local PDF changed. Re-uploading.`,
        );
      } else if (uploadInfo) {
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
            `[Ask My Paper] Uploading PDF to ${provider}: ${pdfTitle}`,
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
          Zotero.log(
            `[Ask My Paper] Failed to upload PDF to ${provider}: ${pdfTitle}`,
          );
          Zotero.logError(
            new Error(`[Ask My Paper] Failed to upload PDF to ${provider}.`),
          );
          ui.updateBotMessage(
            statusMessageDiv,
            `${pdfTitle}を${provider}へアップロードできませんでした。しばらくしてからもう一度お試しください。`,
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
    return this.parentItemDataRepository.load(parentItem);
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

    try {
      await this.parentItemDataRepository.save(parentItem, metadata);
    } catch (e: any) {
      Zotero.debug("[Ask My Paper] Error writing parent item data.");
      throw e;
    }
  }
}
