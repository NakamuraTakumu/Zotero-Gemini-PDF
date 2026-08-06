import { ParentItemFileMetadata } from "../../types/chat";
import { ChatSessionManager } from "./chatSessionManager";
import { PdfFileSyncManager } from "./pdfSyncManager";
import { UIManager } from "./ui";

interface SendMessageUseCaseDependencies {
  paneId: string;
  getParentItem: () => Zotero.Item | null | undefined;
  getIsRequestInProgress: () => boolean;
  setIsRequestInProgress: (isRequestInProgress: boolean) => void;
  dispatchRequestStatusChanged: (
    paneId: string,
    isRequestInProgress: boolean,
  ) => void;
  uiManager: UIManager;
  chatSessionManager: ChatSessionManager;
  pdfFileSyncManager: PdfFileSyncManager;
}

function isCurrentPdfAttachment(attachment: Zotero.Item): boolean {
  return (
    (attachment.attachmentContentType === "application/pdf" ||
      attachment.attachmentContentType === "application/x-pdf") &&
    Boolean(attachment.attachmentPath)
  );
}

export async function filterRequestPdfMetadata(
  parentItem: Zotero.Item,
  metadata: ParentItemFileMetadata,
): Promise<ParentItemFileMetadata> {
  const childAttachmentIds = parentItem.getAttachments(false);
  const childAttachments = await Zotero.Items.getAsync(childAttachmentIds);
  const currentPdfAttachments = new Set(
    childAttachments
      .filter(isCurrentPdfAttachment)
      .map((attachment) => `${attachment.libraryID}:${attachment.key}`),
  );

  return {
    ...metadata,
    files: metadata.files.filter(
      (file) =>
        typeof file.libraryID === "number" &&
        currentPdfAttachments.has(
          `${file.libraryID}:${file.zoteroAttachmentKey}`,
        ),
    ),
  };
}

function getSafeRequestErrorMessage(error: any): string {
  const status = error?.status || error?.statusCode;
  return typeof status === "number" || typeof status === "string"
    ? `Language model request failed with status ${status}.`
    : "Language model request failed.";
}

export class SendMessageUseCase {
  private static inFlightSessionKeys = new Set<string>();

  constructor(private deps: SendMessageUseCaseDependencies) {}

  async execute(
    messageText: string,
    promptText: string,
  ): Promise<ParentItemFileMetadata | null> {
    Zotero.log(
      `[Ask My Paper] SendMessageUseCase.execute called. messageLength=${messageText.length}, promptLength=${promptText.length}`,
    );

    if (messageText.trim() === "") {
      Zotero.log(`[Ask My Paper] SendMessageUseCase: messageText is empty.`);
      return null;
    }

    if (this.deps.getIsRequestInProgress()) {
      Zotero.debug(
        `[Ask My Paper] Request in progress. Skipping message send.`,
      );
      return null;
    }

    const activeSession = this.deps.chatSessionManager.getActiveSession();
    const parentItem = this.deps.getParentItem();
    if (!parentItem || !activeSession) {
      Zotero.logError(
        new Error(
          "Cannot send message: missing parent item or active session.",
        ),
      );
      return null;
    }

    const inFlightSessionKey = `${parentItem.key}:${activeSession.id}`;
    if (SendMessageUseCase.inFlightSessionKeys.has(inFlightSessionKey)) {
      Zotero.debug(
        `[Ask My Paper] Request in progress for session ${inFlightSessionKey}. Skipping message send.`,
      );
      return null;
    }

    SendMessageUseCase.inFlightSessionKeys.add(inFlightSessionKey);
    this.setRequestInProgress(true);

    // The session selected when send starts owns all persistence for this
    // request. The selector may change while the request is in flight, so UI
    // updates must only target the originating session's rendered view.
    const isOriginSessionActive = (): boolean =>
      this.deps.chatSessionManager.getActiveSession()?.id === activeSession.id;

    let parentItemFileMetadata: ParentItemFileMetadata | null = null;
    try {
      parentItemFileMetadata =
        await this.deps.pdfFileSyncManager.ensurePdfContext(
          parentItem,
          this.deps.uiManager,
        );
      if (!parentItemFileMetadata) {
        Zotero.log(
          `[Ask My Paper] SendMessageUseCase: PDF context not ensured.`,
        );
        return null;
      }
      parentItemFileMetadata = await filterRequestPdfMetadata(
        parentItem,
        parentItemFileMetadata,
      );

      if (isOriginSessionActive()) {
        this.deps.uiManager.addUserMessage(messageText);
      }
      activeSession.addUserMessage(messageText);
      await activeSession.save();

      const botMessageDiv = isOriginSessionActive()
        ? this.deps.uiManager.addBotMessage(
            "Typing...",
            "bot-message typing-message",
          )
        : null;

      try {
        const {
          responseText,
          provider,
          model,
          thoughts,
          citations,
          diagnostics,
        } = await activeSession.sendMessage(promptText, parentItemFileMetadata);

        if (botMessageDiv && isOriginSessionActive()) {
          this.deps.uiManager.updateBotMessage(
            botMessageDiv,
            responseText,
            thoughts,
            citations,
            provider,
            model,
            diagnostics,
          );
        }
        await activeSession.save();
      } catch (error: any) {
        const errorMessage = getSafeRequestErrorMessage(error);
        Zotero.logError(
          new Error(
            `[Ask My Paper] SendMessageUseCase: Error during message sending: ${errorMessage}`,
          ),
        );
        if (botMessageDiv && isOriginSessionActive()) {
          this.deps.uiManager.updateBotMessage(
            botMessageDiv,
            `Error: ${errorMessage}`,
          );
        }
      }

      return parentItemFileMetadata;
    } finally {
      SendMessageUseCase.inFlightSessionKeys.delete(inFlightSessionKey);
      this.setRequestInProgress(false);
    }
  }

  private setRequestInProgress(isRequestInProgress: boolean): void {
    this.deps.setIsRequestInProgress(isRequestInProgress);
    this.deps.dispatchRequestStatusChanged(
      this.deps.paneId,
      isRequestInProgress,
    );
    this.deps.uiManager.setInputsDisabled(isRequestInProgress);
  }
}
