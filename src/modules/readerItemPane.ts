import { getLocaleID } from "../utils/locale";
import {
  sendMessageToGemini,
  initGeminiModel,
  uploadFile,
  getFileMetadata,
} from "./geminiApi";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import markdownItKatex from "markdown-it-katex";
import { getPref } from "../utils/prefs";
import {
  Conversation,
  ConversationFile,
  ConversationHistoryItem,
} from "../types/chat";
import { Content, Part } from "@google/genai";


// Import OS module for file operations
// const { ChromeUtils } = Components.utils.import(
//   "resource://gre/modules/ChromeUtils.jsm"
// );
// const { PathUtils } = ChromeUtils.import(
//   "resource://gre/modules/PathUtils.jsm"
// );

// chat用タブ
export class ReaderItemPaneFactory {
  static async getOrCreateConversationAttachment(
    parentItem: Zotero.Item,
  ): Promise<Zotero.Item> {
    const CONVERSATION_TITLE = "Gemini Conversation";

    const childAttachments = await Zotero.Items.get(
      parentItem.getAttachments(),
    );
    for (const attachment of childAttachments) {
      if (
        (attachment.itemType as string) === "attachment" &&
        attachment.getField("title") === CONVERSATION_TITLE &&
        attachment.attachmentLinkMode ===
          Zotero.Attachments.LINK_MODE_IMPORTED_FILE
      ) {
        Zotero.debug("Found existing imported conversation attachment.");
        return attachment;
      }
    }

    Zotero.debug("Creating new Gemini Conversation attachment via import.");

    const initialConversation: Conversation = {
      metadata: {
        version: "1.0",
        zoteroParentItemKey: parentItem.key,
        files: [],
        lastUploadTimestamp: new Date().toISOString(),
      },
      history: [],
    };
    const conversationJsonString = JSON.stringify(initialConversation, null, 2);
    const filename = "gemini_conversation.json";

    // Replaced PathUtils.join with a placeholder string to avoid compile errors
    const tempFilePath = "DISABLED_PATH_FOR_DEBUGGING"; 

    try {
      await Zotero.File.putContentsAsync(tempFilePath, conversationJsonString);
      const tempFile = Zotero.File.pathToFile(tempFilePath);

      const newAttachment = await Zotero.Attachments.importFromFile({
        file: tempFile,
        parentItemID: parentItem.id,
        contentType: "application/json",
        title: CONVERSATION_TITLE,
      });

      Zotero.debug(
        `Successfully created new conversation attachment with key ${newAttachment.key}`,
      );
      return newAttachment;
    } catch (e: any) {
      Zotero.logError(new Error(`Error creating attachment from temp file: ${e.message || String(e)}`));
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
          new Error(`Failed to clean up temporary file ${tempFilePath}: ${cleanupError.message || String(cleanupError)}`),
        );
      }
    }
  }

  /**
   * Synchronizes the PDF context with the Gemini File API.
   */
  static async synchronizePdfContext(
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

  static async registerReaderItemPaneSection() {
    Zotero.ItemPaneManager.registerSection({
      paneID: "reader-item-info",
      pluginID: addon.data.config.addonID,
      header: {
        l10nID: getLocaleID("item-section-example1-head-text"),
        icon: "chrome://zotero/skin/16/universal/book.svg",
      },
      sidenav: {
        l10nID: getLocaleID("item-section-example1-sidenav-tooltip"),
        icon: "chrome://zotero/skin/20/universal/save.svg",
      },
      bodyXHTML: `<html:div class="chat-container" xmlns:html="http://www.w3.org/1999/xhtml">
          <html:div class="chat-messages" id="chat-messages"></html:div>
          <html:div class="chat-resizer" id="chat-resizer"></html:div>
          <html:div class="chat-input-area">
              <html:textarea id="chat-input" class="chat-input" placeholder="Type a message..."></html:textarea>
              <html:button id="send-button" class="send-button">Send</html:button>
          </html:div>
      </html:div>`,
      onItemChange: ({ item, setEnabled, tabType }) => {
        setEnabled(tabType === "reader");
        return true;
      },
      onRender: async ({ body, item }) => {
        initGeminiModel(); // Initialize the client

        const doc = body.ownerDocument;
        if (!doc) return;
        const window = doc.defaultView as any;
        if (!window) return;

        const DOMPurify = createDOMPurify(window);
        const md = new MarkdownIt({ xhtmlOut: true }).use(markdownItKatex, {
          throwOnError: false,
          errorColor: "#cc0000",
          output: "mathml",
          strict: false,
        });

        function renderMarkdown(text: string): string {
          const sanitizedText = DOMPurify.sanitize(text, {
            ADD_TAGS: ["math", "mi", "mo", "mn", "mtext", "mrow", "mfrac", "msup", "msub", "msubsup", "mover", "munder", "munderover", "msqrt", "mroot", "mfenced", "menclose", "mstyle", "mphantom", "mglyph", "mlabeledtr", "mtable", "mtr", "mtd", "maligngroup", "malignmark", "msgroup", "msrow", "mscol", "msline", "semantics", "annotation", "annotation-xml", "span", "svg", "path", "g", "rect", "use"],
            ADD_ATTR: ["xmlns", "encoding", "class", "aria-hidden", "width", "height", "viewBox", "x", "y", "transform", "fill", "stroke", "stroke-width", "d", "style"]
          });
          return md.render(sanitizedText);
        }

        const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
        const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
        const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
        const chatResizer = body.querySelector("#chat-resizer") as HTMLDivElement;

        if (!doc || !chatMessages || !chatInput || !sendButton || !chatResizer) return;

        let actualParentItem: Zotero.Item | null = (item.isAttachment() && item.parentID)
          ? await Zotero.Items.getAsync(item.parentID)
          : item;

        let currentConversation: Conversation | null = null;

        const addBotMessage = (html: string, className: string = 'bot-message'): HTMLDivElement => {
            const div = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLDivElement;
            div.className = `message ${className}`;
            div.innerHTML = html;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return div;
        };

        const updateBotMessage = (element: HTMLDivElement, html: string) => {
            element.innerHTML = html;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        };

        if (actualParentItem) {
          try {
            const childAttachments = await Zotero.Items.get(actualParentItem.getAttachments());
            const existingAttachment = childAttachments.find(
              (att) => att.isAttachment() && att.getField("title") === "Gemini Conversation"
            );

            if (existingAttachment) {
              const conversationFilePath = existingAttachment.getFilePath();
              if (conversationFilePath) {
                const content = await Zotero.File.getContentsAsync(conversationFilePath);
                if (typeof content === "string" && content.trim() !== "") {
                  currentConversation = JSON.parse(content) as Conversation;
                }
              }
            }
            
            if (!currentConversation) {
              currentConversation = {
                metadata: {
                  version: "1.0",
                  zoteroParentItemKey: actualParentItem.key,
                  files: [],
                  lastUploadTimestamp: new Date().toISOString(),
                },
                history: [],
              };
            }

            chatMessages.innerHTML = "";
            for (const message of currentConversation.history) {
              const messageDiv = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
              messageDiv.className = `message ${message.role}-message`;
              messageDiv.innerHTML = renderMarkdown(message.parts[0].text);
              chatMessages.appendChild(messageDiv);
            }
            chatMessages.scrollTop = chatMessages.scrollHeight;

          } catch (e: any) {
            Zotero.logError(new Error(`Error loading conversation: ${e.message || String(e)}`));
            addBotMessage(`Error loading conversation: ${e.message || String(e)}`, 'error-message');
          }
        }

        // Resizing logic (omitted for brevity, no changes)
        // ...

        const handleSendMessage = async () => {
          const messageText = chatInput.value;
          if (messageText.trim() === "" || !actualParentItem || !currentConversation) {
            return;
          }

          chatInput.disabled = true;
          sendButton.disabled = true;

          const userMessageDiv = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
          userMessageDiv.className = "message user-message";
          userMessageDiv.innerHTML = renderMarkdown(messageText);
          chatMessages.appendChild(userMessageDiv);
          chatMessages.scrollTop = chatMessages.scrollHeight;
          chatInput.value = "";
          // adjustTextareaHeight();

          try {
            // currentConversation = await ReaderItemPaneFactory.synchronizePdfContext(
            //   actualParentItem,
            //   currentConversation,
            //   { addBotMessage, updateBotMessage }
            // );
            // await ReaderItemPaneFactory.saveConversation(actualParentItem, currentConversation);
          } catch (syncError: any) {
            Zotero.logError(new Error(`PDF Sync failed: ${syncError.message || String(syncError)}`));
            addBotMessage(`Error synchronizing PDFs: ${syncError.message || String(syncError)}`, 'error-message');
            chatInput.disabled = false;
            sendButton.disabled = false;
            return;
          }

          const userMessage: ConversationHistoryItem = {
            sequence: (currentConversation.history.at(-1)?.sequence ?? -1) + 1,
            timestamp: new Date().toISOString(),
            role: "user",
            parts: [{ text: messageText }],
          };
          currentConversation.history.push(userMessage);
          await ReaderItemPaneFactory.saveConversation(actualParentItem, currentConversation);

          const botMessageDiv = addBotMessage("Typing...", "bot-message");

          try {
            const historyForApi: Content[] = currentConversation.history.map(
              (msg) => ({
                role: msg.role,
                parts: msg.parts,
              })
            );
            
            historyForApi.pop(); 

            const userParts: Part[] = [{ text: messageText }];
            for (const file of currentConversation.metadata.files) {
              userParts.unshift({
                fileData: {
                  mimeType: "application/pdf",
                  fileUri: file.geminiFileUri,
                },
              });
            }

            const botResponseText = await sendMessageToGemini(historyForApi, userParts);

            updateBotMessage(botMessageDiv, renderMarkdown(botResponseText || "No response."));

            const botMessage: ConversationHistoryItem = {
              sequence: (currentConversation.history.at(-1)?.sequence ?? -1) + 1,
              timestamp: new Date().toISOString(),
              role: "model",
              model: "gemini-2.5-flash",
              parts: [{ text: botResponseText || "" }],
            };
            currentConversation.history.push(botMessage);
            await ReaderItemPaneFactory.saveConversation(actualParentItem, currentConversation);

          } catch (error: any) {
            const errorMessage = error.message || String(error);
            updateBotMessage(botMessageDiv, `Error: ${errorMessage}`);
          } finally {
            chatInput.disabled = false;
            sendButton.disabled = false;
            chatInput.focus();
          }
        };

        sendButton.addEventListener("click", handleSendMessage);
        chatInput.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSendMessage();
          }
        });
      },
    });
  }

  static registerChatStyleSheet(win: _ZoteroTypes.MainWindow) {
    const doc = win.document;
    const chatStyles = ztoolkit.UI.createElement(doc, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${addon.data.config.addonRef}/content/chat.css`,
      },
    });
    doc.documentElement?.appendChild(chatStyles);

    const katexStyles = ztoolkit.UI.createElement(doc, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${addon.data.config.addonRef}/content/katex.min.css`,
      },
    });
    doc.documentElement?.appendChild(katexStyles);
  }

  static async saveConversation(
    actualParentItem: Zotero.Item,
    conversation: Conversation,
  ) {
    if (!actualParentItem) {
      Zotero.debug("Could not determine actualParentItem for conversation.");
      return;
    }

    const conversationAttachment =
      await ReaderItemPaneFactory.getOrCreateConversationAttachment(
        actualParentItem,
      );
    const conversationFilePath = conversationAttachment.getFilePath();

    if (conversationFilePath) {
      const newContent = JSON.stringify(conversation, null, 2);
      try {
        await Zotero.File.putContentsAsync(conversationFilePath, newContent);
      } catch (e: any) {
        Zotero.debug(`Error writing to conversation file: ${e.message || String(e)}`);
      }
    }
  }
}
