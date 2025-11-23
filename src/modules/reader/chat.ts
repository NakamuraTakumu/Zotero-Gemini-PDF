import { getPref } from "../../utils/prefs";
import { PREF_SELECTED_MODEL, PREF_USE_GOOGLE_SEARCH } from "../../utils/constants";
import { Conversation, ConversationFile } from "../../types/chat";
import { Content, Part } from "@google/genai";
import { sendMessageToGemini, uploadFile, getFileMetadata } from "../geminiApi";
import { ConversationManager } from "./conversation";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import markdownItKatex from "@vscode/markdown-it-katex";

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
  public renderMarkdown: (text: string) => string; // Changed to public

  constructor(window: Window) {
    this.renderMarkdown = initMarkdownRenderer(window);
  }

  /**
   * Synchronizes the PDF context with the Gemini File API.
   */
  async synchronizePdfContext(
    parentItem: Zotero.Item,
    conversation: Conversation,
    ui: { addBotMessage: (html: string, className?: string) => HTMLDivElement, updateBotMessage: (element: HTMLDivElement, html: string) => void }
  ): Promise<Conversation> {
    Zotero.debug("Starting PDF context synchronization...");
    const statusMessageDiv = ui.addBotMessage("Syncing PDFs...", "sync-message");

    const childAttachmentIds = parentItem.getAttachments(false);
    const childAttachments = await Zotero.Items.getAsync(childAttachmentIds);
    const pdfAttachments = childAttachments.filter(
      (att) => (att.attachmentContentType === "application/pdf" || att.attachmentContentType === "application/x-pdf") && att.attachmentPath
    );

    let updated = false;

    const syncPromises = pdfAttachments.map(async (pdf) => {
      const pdfKey = pdf.key;
      let fileInfo = conversation.metadata.files.find(
        (f) => f.zoteroAttachmentKey === pdfKey,
      );

      let needsUpload = false;
      if (fileInfo) {
        Zotero.debug(`Checking status of existing file: ${fileInfo.geminiFileName}`);
        const metadata = await getFileMetadata(fileInfo.geminiFileName);
        if (!metadata) {
          Zotero.debug(`File ${fileInfo.geminiFileName} is expired or missing. Re-uploading.`);
          needsUpload = true;
        } else {
          Zotero.debug(`File ${fileInfo.geminiFileName} is still valid.`);
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
          
          if (uploadResult && uploadResult.uri && uploadResult.name) {
            updated = true;

            const newFileInfo: ConversationFile = {
              zoteroAttachmentKey: pdfKey,
              geminiFileUri: uploadResult.uri,
              geminiFileName: uploadResult.name,
              fileName: pdfTitle,
            };

            conversation.metadata.files = conversation.metadata.files.filter(
              (f) => f.zoteroAttachmentKey !== pdfKey,
            );
            conversation.metadata.files.push(newFileInfo);
            Zotero.debug(`Successfully uploaded and recorded file: ${pdfTitle}`);
          } else {
            throw new Error("Upload result is invalid or missing URI/name.");
          }

        } catch (uploadError: any) {
          Zotero.logError(new Error(`Failed to upload ${pdfTitle}: ${uploadError.message || String(uploadError)}`));
          ui.updateBotMessage(statusMessageDiv, `Error uploading ${pdfTitle}.`);
        }
      }
    });

    await Promise.all(syncPromises);

    if (updated) {
      conversation.metadata.lastUploadTimestamp = new Date().toISOString();
    }
    
    ui.updateBotMessage(statusMessageDiv, "PDF sync complete.");
    setTimeout(() => statusMessageDiv.remove(), 2000);

    Zotero.debug("PDF context synchronization finished.");
    return conversation;
  }

  async processAndSendMessage(
    paneId: string,
    textForHistory: string,
    textForApi: string,
    actualParentItem: Zotero.Item,
    currentConversation: Conversation,
    ui: {
      addBotMessage: (html: string, className?: string) => HTMLDivElement;
      updateBotMessage: (element: HTMLDivElement, html: string) => void;
      chatInput: HTMLTextAreaElement;
      sendButton: HTMLButtonElement;
      chatMessages: HTMLDivElement;
      popupTriggerButton?: HTMLButtonElement | null;
      originalButtonText?: string;
    }
  ) {
    if (!actualParentItem || !currentConversation) {
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

    try {
      currentConversation = await this.synchronizePdfContext(
        actualParentItem,
        currentConversation,
        ui
      );
      await ConversationManager.saveConversation(actualParentItem, currentConversation);
    } catch (syncError: any) {
      Zotero.logError(new Error(`PDF Sync failed: ${syncError.message || String(syncError)}`));
      ui.addBotMessage(`Error synchronizing PDFs: ${syncError.message || String(syncError)}`, 'error-message');
      ui.chatInput.disabled = false;
      ui.sendButton.disabled = false;
      return;
    }

    ConversationManager.addUserMessage(currentConversation, textForHistory);
    await ConversationManager.saveConversation(actualParentItem, currentConversation);

    const botMessageDiv = ui.addBotMessage("Typing...", "bot-message");

    try {
      const historyForApi: Content[] = currentConversation.history.map(
        (msg) => ({
          role: msg.role,
          parts: msg.parts,
        })
      );

      historyForApi.pop();

      const userParts: Part[] = [{ text: textForApi }];
      for (const file of currentConversation.metadata.files) {
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
      const { responseText: botResponseText, groundingMetadata } = await sendMessageToGemini(historyForApi, userParts, tools);

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

      ConversationManager.addBotMessage(currentConversation, botResponseText || "", getPref(PREF_SELECTED_MODEL) as string, groundingMetadata);
      await ConversationManager.saveConversation(actualParentItem, currentConversation);

    } catch (error: any) {
      const errorMessage = error.message || String(error);
      ui.updateBotMessage(botMessageDiv, `Error: ${errorMessage}`);
    } finally {
      addon.data.chatPanes[paneId].isGeminiRequestInProgress = false; // Set state to false
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