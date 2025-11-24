import { ReaderItemPaneFactory } from "../readerItemPane"; // ReaderItemPaneFactory をインポート
import { getPref } from "../../utils/prefs";
import {
  PREF_SELECTED_MODEL,
  PREF_USE_GOOGLE_SEARCH,
  PREF_CONTEXT_WINDOW_SIZE,
  PREF_TITLE_GENERATION_MODEL,
  PREF_TITLE_GENERATION_PROMPT,
} from "../../utils/constants";
import { ChatSessionHistory, ChatMessage, ParentItemFileMetadata, ParentItemFileMetadataFile } from "../../types/chat"; // ParentItemFileMetadata, ParentItemFileMetadataFile をインポート
import { Content, Part } from "@google/genai";
import { sendMessageToGemini, uploadFile, getFileMetadata } from "../geminiApi";
import { ConversationManager } from "./conversation";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import markdownItKatex from "@vscode/markdown-it-katex";
import { ChatSessionManager } from "./chatSessionManager"; // ChatSessionManager をインポート

// Helper for rendering markdown
const initMarkdownRenderer = (window: Window) => {
  const DOMPurify = createDOMPurify(window as any); // Cast window to any

  // Handle CJS/ESM interop issue with the imported module
  const katexPlugin = typeof markdownItKatex === 'function'
    ? markdownItKatex
    : (markdownItKatex as any).default;

  const md = new MarkdownIt({ xhtmlOut: true }).use(katexPlugin, {
    throwOnError: false,
    errorColor: "#cc0000",
    output: "mathml",
    strict: false,
  });
  return (text: string): string => {
    const sanitizedText = DOMPurify.sanitize(text, {
      ADD_TAGS: ["math", "mi", "mo", "mn", "mtext", "mrow", "mfrac", "msup", "msub", "msubsup", "mover", "munder", "munderover", "msqrt", "mroot", "mfenced", "menclose", "mstyle", "mphantom", "mglyph", "mlabeledtr", "mtable", "mtr", "mtd", "maligngroup", "malignmark", "msgroup", "msrow", "mscol", "msline", "semantics", "annotation", "annotation-xml", "span", "svg", "path", "g", "rect", "use"],
      ADD_ATTR: ["xmlns", "encoding", "class", "aria-hidden", "width", "height", "viewBox", "x", "y", "transform", "fill", "stroke", "stroke-width", "d", "style"]
    });
    return md.render(sanitizedText);
  };
};

export class ChatManager {
  public renderMarkdown: (text: string) => string;
  private chatSessionManager: ChatSessionManager;

  constructor(window: Window, chatSessionManager: ChatSessionManager) {
    this.renderMarkdown = initMarkdownRenderer(window);
    this.chatSessionManager = chatSessionManager;
  }

  getAllSessions(): ChatSessionHistory[] {
    return this.chatSessionManager.getAllSessions();
  }

  getActiveSession(): ChatSessionHistory | null {
    return this.chatSessionManager.getActiveSession();
  }

  switchSession(chatId: string): ChatSessionHistory | null {
    return this.chatSessionManager.switchSession(chatId);
  }

  async deleteActiveSession(): Promise<boolean> {
    return this.chatSessionManager.deleteActiveSession();
  }

  async updateSessionTitleAndFlag(chatId: string, newTitle: string): Promise<void> {
    return this.chatSessionManager.updateSessionTitleAndFlag(chatId, newTitle);
  }

  async generateAndSetSessionTitle(session: ChatSessionHistory): Promise<void> {
    if (!session || session.history.length < 2 || session.metadata.isTitleGenerated) {
        return;
    }

    const userPrompt = session.history[0].parts[0].text;
    const modelResponse = session.history[1].parts[0].text;

    const promptTemplate = getPref(PREF_TITLE_GENERATION_PROMPT) as string;
    const titlePrompt = promptTemplate
      .replace('{userPrompt}', userPrompt)
      .replace('{modelResponse}', modelResponse);
    
    const modelForTitle = getPref(PREF_TITLE_GENERATION_MODEL) as string;

    try {
      const { responseText } = await sendMessageToGemini([], [{ text: titlePrompt }], undefined, modelForTitle);
      if (responseText) {
        const newTitle = responseText.trim().replace(/^「|」$/g, '').replace(/\.$/, '');
        await this.updateSessionTitleAndFlag(session.metadata.chatId, newTitle);
      }
    } catch (e: any) {
      Zotero.logError(new Error(`[ChatManager] Failed to generate session title: ${e.message || String(e)}`));
    }
  }


  /**
   * Synchronizes the PDF context with the Gemini File API.
   * 現在のチャットセッションとは独立してParentItemFileMetadataを管理し、PDFファイルをGemini APIに同期します。
   */
  async synchronizePdfContext(
    parentItem: Zotero.Item,
    ui: { addBotMessage: (html: string, className?: string) => HTMLDivElement, updateBotMessage: (element: HTMLDivElement, html: string) => void }
  ): Promise<ParentItemFileMetadata> { // 戻り値を ParentItemFileMetadata に変更
    Zotero.debug("Starting PDF context synchronization...");
    const statusMessageDiv = ui.addBotMessage("Syncing PDFs...", "sync-message");

    // ParentItemFileMetadata をロード
    let parentItemFileMetadata = await ConversationManager.loadParentItemFileMetadata(parentItem);

    const childAttachmentIds = parentItem.getAttachments(false);
    const childAttachments = await Zotero.Items.getAsync(childAttachmentIds);
    const pdfAttachments = childAttachments.filter(
      (att) => (att.attachmentContentType === "application/pdf" || att.attachmentContentType === "application/x-pdf") && att.attachmentPath
    );

    let updated = false;

    const syncPromises = pdfAttachments.map(async (pdf) => {
      const pdfKey = pdf.key;
      let fileInfo = parentItemFileMetadata.files.find(
        (f) => f.zoteroAttachmentKey === pdfKey,
      );

      let needsUpload = false;
      if (fileInfo) {
        Zotero.debug(`Checking status of existing file: ${fileInfo.fileName} (${fileInfo.geminiFileUri})`);
        // Gemini APIにファイルが存在するかチェック
        // geminiFileUriからファイル名（files/xxxx）を抽出して渡す
        const geminiFileName = fileInfo.geminiFileUri.split('/').pop();
        if (!geminiFileName) {
            Zotero.logError(new Error(`Could not extract Gemini file name from URI: ${fileInfo.geminiFileUri}`));
            needsUpload = true;
        } else {
            const metadata = await getFileMetadata(`files/${geminiFileName}`); // files/をプレフィックスとして追加
            if (!metadata) {
                Zotero.debug(`File ${fileInfo.fileName} (${fileInfo.geminiFileUri}) is expired or missing. Re-uploading.`);
                needsUpload = true;
            } else {
                Zotero.debug(`File ${fileInfo.fileName} (${fileInfo.geminiFileUri}) is still valid.`);
            }
        }
      } else {
        Zotero.debug(`No existing file record for PDF: ${pdf.getField('title')}. Uploading.`);
        needsUpload = true;
      }

      if (needsUpload) {
        const pdfPath = pdf.getFilePath();
        const pdfTitle = pdf.getField("title") as string;
        if (!pdfPath) {
            Zotero.logError(new Error(`Could not get file path for PDF: ${pdfTitle}`));
            return;
        }
        try {
          ui.updateBotMessage(statusMessageDiv, `Uploading ${pdfTitle}...`);
          const uploadResult = await uploadFile(pdfPath, pdfTitle);
          
          if (uploadResult && uploadResult.uri) { // uploadResult.name は不要
            updated = true;

            const newFileInfo: ParentItemFileMetadataFile = { // ParentItemFileMetadataFile を使用
              zoteroAttachmentKey: pdfKey,
              geminiFileUri: uploadResult.uri,
              fileName: pdfTitle,
              lastUploadTimestamp: new Date().toISOString(), // タイムスタンプを追加
            };

            // 既存のファイルを更新または追加
            parentItemFileMetadata.files = parentItemFileMetadata.files.filter(
              (f) => f.zoteroAttachmentKey !== pdfKey,
            );
            parentItemFileMetadata.files.push(newFileInfo);
            Zotero.debug(`Successfully uploaded and recorded file: ${pdfTitle}`);
          } else {
            throw new Error("Upload result is invalid or missing URI.");
          }

        } catch (uploadError: any) {
          Zotero.logError(new Error(`Failed to upload ${pdfTitle}: ${uploadError.message || String(uploadError)}`));
          ui.updateBotMessage(statusMessageDiv, `Error uploading ${pdfTitle}.`);
        }
      }
    });

    await Promise.all(syncPromises);

    if (updated) {
      await ConversationManager.saveParentItemFileMetadata(parentItem, parentItemFileMetadata);
    }
    
    ui.updateBotMessage(statusMessageDiv, "PDF sync complete.");
    setTimeout(() => statusMessageDiv.remove(), 2000);

    Zotero.debug("PDF context synchronization finished.");
    return parentItemFileMetadata;
  }

  async processAndSendMessage(
    paneId: string,
    textForHistory: string,
    textForApi: string,
    actualParentItem: Zotero.Item,
    parentItemFileMetadata: ParentItemFileMetadata, // ParentItemFileMetadata を引数に追加
    ui: {
      uiManager: import("./ui").UIManager; // Add UIManager to the UI context
      addBotMessage: (html: string, className?: string) => HTMLDivElement;
      updateBotMessage: (element: HTMLDivElement, html: string) => void;
      chatInput: HTMLTextAreaElement;
      sendButton: HTMLButtonElement;
      chatMessages: HTMLDivElement;
      popupTriggerButton?: HTMLButtonElement | null;
      originalButtonText?: string;
    }
  ) {
    if (!actualParentItem || !parentItemFileMetadata) {
      Zotero.logError(new Error("Cannot process and send message: missing actualParentItem or parentItemFileMetadata."));
      return;
    }
    if (!this.chatSessionManager) {
      Zotero.logError(new Error("ChatSessionManager is not initialized in ChatManager."));
      return;
    }

    const currentConversation = this.chatSessionManager.getActiveSession(); // Get active session from manager
    if (!currentConversation) {
      Zotero.logError(new Error("No active conversation found in ChatSessionManager."));
      return;
    }

    ui.chatInput.disabled = true;
    ui.sendButton.disabled = true;

    const userMessageDiv = ui.chatMessages.ownerDocument!.createElementNS("http://www.w3.org/1999/xhtml", "div");
    userMessageDiv.className = "message user-message";
    userMessageDiv.innerHTML = this.renderMarkdown(textForHistory);
    ui.chatMessages.appendChild(userMessageDiv);
    ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
    if (textForApi === textForHistory) {
      ui.chatInput.value = "";
    }
    // PDF同期はprocessAndSendMessageの外部で行われるため、ここからは削除
    // ParentItemFileMetadataは既に引数として渡されている
    // try {
    //   currentConversation = await this.synchronizePdfContext(
    //     actualParentItem,
    //     currentConversation,
    //     ui
    //   );
    //   await ConversationManager.saveConversation(actualParentItem, currentConversation);
    // } catch (syncError: any) {
    //   Zotero.logError(new Error(`PDF Sync failed: ${syncError.message || String(syncError)}`));
    //   ui.addBotMessage(`Error synchronizing PDFs: ${syncError.message || String(syncError)}`, 'error-message');
    //   ui.chatInput.disabled = false;
    //   ui.sendButton.disabled = false;
    //   return;
    // }

    Zotero.debug(`[ChatManager] Before addUserMessage, history length: ${currentConversation.history.length}`);
    ConversationManager.addUserMessage(currentConversation, textForHistory);
    Zotero.debug(`[ChatManager] After addUserMessage, history length: ${currentConversation.history.length}`);
    await ConversationManager.saveConversation(actualParentItem, currentConversation);
    ui.uiManager._renderChatMessages(currentConversation); // Force re-render after adding user message

    const botMessageDiv = ui.addBotMessage("Typing...", "bot-message");

    try {
      const historyLimit = (getPref(PREF_CONTEXT_WINDOW_SIZE) as number) || 32;

      const fullHistory: Content[] = currentConversation.history.map(
        (msg) => ({
          role: msg.role,
          parts: msg.parts,
        }),
      );

      // The last message is the user's current one; exclude it from history and truncate.
      const historyForApi = fullHistory.length > 1 ? fullHistory.slice(0, -1) : [];
      const truncatedHistory =
        historyLimit > 0 ? historyForApi.slice(-historyLimit) : historyForApi;

      const userParts: Part[] = [{ text: textForApi }];
      // ParentItemFileMetadata からファイルのURIを取得して userParts に追加
      for (const file of parentItemFileMetadata.files) {
        userParts.unshift({
          fileData: {
            mimeType: "application/pdf",
            fileUri: file.geminiFileUri,
          },
        });
      }

      const useGoogleSearch = getPref(PREF_USE_GOOGLE_SEARCH) as boolean;
      let tools: any[] | undefined = undefined;
      if (useGoogleSearch) {
        tools = [
          { googleSearch: {} },
          { urlContext: {} }
        ];
      }
      const { responseText: botResponseText, groundingMetadata } = await sendMessageToGemini(truncatedHistory, userParts, tools);

      let messageHtml = this.renderMarkdown(botResponseText || "No response.");

      if (groundingMetadata) {
        let sources = '';
        if (groundingMetadata.groundingChunks && groundingMetadata.groundingChunks.length > 0) {
          sources = groundingMetadata.groundingChunks.map((chunk: any, index: number) => {
            if (chunk.web) {
              return `<a href="${chunk.web.uri}" target="_blank">[${index + 1}] ${chunk.web.title}</a>`;
            }
            return null;
          }).filter(Boolean).join('');
        } else if (groundingMetadata.retrievedReferences && groundingMetadata.retrievedReferences.length > 0) {
          sources = groundingMetadata.retrievedReferences.map((ref: any, index: number) =>
            `<a href="${ref.uri}" target="_blank">[${index + 1}] ${ref.title}</a>`
          ).join('');
        }

        if (sources) {
          messageHtml += `<div class="sources-container"><b>参照元:</b>${sources}</div>`;
        }
      }
      ui.updateBotMessage(botMessageDiv, messageHtml);

      Zotero.debug(`[ChatManager] Before addBotMessage, history length: ${currentConversation.history.length}`);
      ConversationManager.addBotMessage(currentConversation, botResponseText || "", getPref(PREF_SELECTED_MODEL) as string, groundingMetadata);
      Zotero.debug(`[ChatManager] After addBotMessage, history length: ${currentConversation.history.length}`);
      await ConversationManager.saveConversation(actualParentItem, currentConversation);

      // After the first exchange, generate a title for the session
      if (currentConversation.history.length === 2 && !currentConversation.metadata.isTitleGenerated) {
        this.generateAndSetSessionTitle(currentConversation);
      }

    } catch (error: any) {
      const errorMessage = error.message || String(error);
      ui.updateBotMessage(botMessageDiv, `Error: ${errorMessage}`);
    } finally {
      addon.data.chatPanes[paneId].runtimeState.isGeminiRequestInProgress = false; // Set state to false
      ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(paneId, false); // Dispatch event on completion/error
      ui.chatInput.disabled = false;
      ui.sendButton.disabled = false;
      ui.chatInput.focus();

      // Re-enable the popup button if it exists
      if (ui.popupTriggerButton) {
        ui.popupTriggerButton.disabled = false;
        ui.popupTriggerButton.innerHTML = ui.originalButtonText || "Geminiに聞く"; // Restore original text
      }
    }
  }
}