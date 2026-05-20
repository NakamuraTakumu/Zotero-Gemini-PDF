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

export class SendMessageUseCase {
  private static inFlightSessionKeys = new Set<string>();

  constructor(private deps: SendMessageUseCaseDependencies) {}

  async execute(
    messageText: string,
    promptText: string,
  ): Promise<ParentItemFileMetadata | null> {
    Zotero.log(
      `[Gemini PDF] SendMessageUseCase.execute called. messageText: "${messageText}", promptText: "${promptText}"`,
    );

    if (messageText.trim() === "") {
      Zotero.log(`[Gemini PDF] SendMessageUseCase: messageText is empty.`);
      return null;
    }

    if (this.deps.getIsRequestInProgress()) {
      Zotero.debug(`[Gemini PDF] Request in progress. Skipping message send.`);
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
        `[Gemini PDF] Request in progress for session ${inFlightSessionKey}. Skipping message send.`,
      );
      return null;
    }

    SendMessageUseCase.inFlightSessionKeys.add(inFlightSessionKey);
    this.setRequestInProgress(true);

    let parentItemFileMetadata: ParentItemFileMetadata | null = null;
    try {
      parentItemFileMetadata =
        await this.deps.pdfFileSyncManager.ensurePdfContext(
          parentItem,
          this.deps.uiManager,
        );
      if (!parentItemFileMetadata) {
        Zotero.log(`[Gemini PDF] SendMessageUseCase: PDF context not ensured.`);
        return null;
      }

      this.deps.uiManager.addUserMessage(messageText);
      activeSession.addUserMessage(messageText);
      await activeSession.save();

      const botMessageDiv = this.deps.uiManager.addBotMessage(
        "Typing...",
        "bot-message",
      );

      try {
        const {
          responseText,
          provider,
          model,
          thoughts,
          groundingMetadata,
          citations,
        } = await activeSession.sendMessage(promptText, parentItemFileMetadata);

        this.deps.uiManager.updateBotMessage(
          botMessageDiv,
          responseText,
          thoughts,
          groundingMetadata,
          citations,
          provider,
          model,
        );
        await activeSession.save();
      } catch (error: any) {
        const errorMessage = error.message || String(error);
        Zotero.logError(
          new Error(
            `[Gemini PDF] SendMessageUseCase: Error during message sending: ${errorMessage}`,
          ),
        );
        this.deps.uiManager.updateBotMessage(
          botMessageDiv,
          `Error: ${errorMessage}`,
        );
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
