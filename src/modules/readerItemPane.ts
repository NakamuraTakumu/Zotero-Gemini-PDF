import { getLocaleID } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  PREF_MODEL_LIST,
  PREF_SELECTED_MODEL,
  PREF_USE_GOOGLE_SEARCH,
} from "../utils/constants";
import { ChatSessionHistory, ParentItemFileMetadata } from "../types/chat";
import { ConversationManager } from "./reader/conversation";
import { ChatManager } from "./reader/chat";
import { UIManager } from "./reader/ui";

import { v4 as uuidv4 } from "uuid";

// chat用タブ
export class ReaderItemPaneFactory {
  static async registerReaderItemPaneSection() {
    Zotero.ItemPaneManager.registerSection({
      paneID: "reader-item-info",
      pluginID: addon.data.config.addonID,
      header: {
        l10nID: getLocaleID("item-section-example1-head-text"),
        icon: `chrome://${addon.data.config.addonRef}/content/icons/gemini.svg`,
      },
      sidenav: {
        l10nID: getLocaleID("item-section-example1-sidenav-tooltip"),
        icon: `chrome://${addon.data.config.addonRef}/content/icons/gemini.svg`,
      },
      bodyXHTML: `<html:div class="chat-container" xmlns:html="http://www.w3.org/1999/xhtml">
          <html:div class="chat-messages" id="chat-messages"></html:div>
          <html:div class="chat-resizer" id="chat-resizer"></html:div>
          <html:div class="chat-model-selector-area">
              <html:label for="gemini-model-select">Select Model:</html:label>
              <html:select id="gemini-model-select" class="gemini-model-select"></html:select>
              <html:label for="use-google-search-checkbox" style="margin-left: 10px;">Use Google Search:</html:label>
              <html:input type="checkbox" id="use-google-search-checkbox" />
          </html:div>
          <html:div class="chat-input-area">
              <html:textarea id="chat-input" class="chat-input" placeholder="Type a message..."></html:textarea>
              <html:button id="send-button" class="send-button">Send</html:button>
              <html:button id="new-chat-button" class="new-chat-button">新しいチャット</html:button>
          </html:div>
      </html:div>`,
      onInit: ({ body, refresh }) => {
        Zotero.log("[Gemini PDF] onInit called.");
        const paneId = Zotero.Utilities.randomString(8);
        body.dataset.paneId = paneId;

        const doc = body.ownerDocument;
        if (!doc) return;
        const window = doc.defaultView as any;
        if (!window) return;

        const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
        if (!chatMessages) return;

        const chatManager = new ChatManager(window);
        const uiManager = new UIManager(doc, body, chatMessages, chatManager); // Pass chatManager to UIManager
        uiManager.registerPrefObservers();

        const handleGeminiAction = (event: Event) => {
          const customEvent = event as CustomEvent;
          const state = addon.data.chatPanes[paneId];
          Zotero.log(`[Gemini PDF] Pane ${paneId} received event. My itemId is ${state?.itemId}. Event detail: ${JSON.stringify(customEvent.detail)}`);
          if (!state || !state.itemId || state.itemId !== customEvent.detail.itemId) {
            return;
          }
          // Check if a request is already in progress for this pane
          if (state.isGeminiRequestInProgress) {
            Zotero.debug(`[Gemini PDF] Request already in progress for pane ${paneId}. Skipping action.`);
            return;
          }
          Zotero.log(`[Gemini PDF] Action event received for matching item ${state.itemId}`);
          (async () => {
            const { fullPrompt, summaryText, popupTriggerButton, originalButtonText } = customEvent.detail;
            const { chatManager, uiManager, actualParentItem, currentConversation } = state; // parentItemFileMetadata を削除

            const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
            const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
            const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
            state.isGeminiRequestInProgress = true; // Set state to true for this pane

            if (chatManager && actualParentItem && currentConversation && uiManager) {
              // parentItemFileMetadata がまだロードされていない場合、ここでロード/作成する
              if (!state.parentItemFileMetadata) {
                try {
                  state.parentItemFileMetadata = await chatManager.synchronizePdfContext(actualParentItem, { addBotMessage: uiManager.addBotMessage, updateBotMessage: uiManager.updateBotMessage });
                } catch (e: any) {
                  Zotero.logError(new Error(`Error synchronizing PDFs on first message from action: ${e.message || String(e)}`));
                  uiManager.addBotMessage(`Error synchronizing PDFs: ${e.message || String(e)}`, 'error-message');
                  state.isGeminiRequestInProgress = false;
                  return;
                }
              }

              // parentItemFileMetadata がロードまたは作成されたことを確認してから processAndSendMessage を呼び出す
              if (state.parentItemFileMetadata) {
                await chatManager.processAndSendMessage(
                  paneId, // Pass paneId
                  summaryText,
                  fullPrompt,
                  actualParentItem,
                  currentConversation,
                  state.parentItemFileMetadata, // parentItemFileMetadata を渡す
                  {
                    uiManager: uiManager, // Pass uiManager reference
                    addBotMessage: uiManager.addBotMessage,
                    updateBotMessage: uiManager.updateBotMessage,
                    chatInput,
                    sendButton,
                    chatMessages,
                    popupTriggerButton, // Pass the button reference
                    originalButtonText, // Pass original text
                  }
                );
              }
            }
          })();
        };
        Zotero.getMainWindow().document.addEventListener('gemini-pdf-action', handleGeminiAction);
        addon.data.chatPanes[paneId] = {
          chatManager,
          uiManager,
          paneId,
          eventHandler: handleGeminiAction,
          doc, // Store doc
          body, // Store body
          parentItemFileMetadata: null, // 初期化時にnullを設定
        };
      },
      onDestroy: ({ body }) => {
        const paneId = body.dataset.paneId;
        if (paneId && addon.data.chatPanes[paneId]) {
          const { uiManager, eventHandler } = addon.data.chatPanes[paneId];
          if (eventHandler) {
            Zotero.getMainWindow().document.removeEventListener('gemini-pdf-action', eventHandler);
          }
          uiManager?.unregisterPrefObservers();
          delete addon.data.chatPanes[paneId];
          Zotero.log(`[Gemini PDF] Destroyed pane: ${paneId}`);
        }
      },
      onItemChange: ({ item, setEnabled, tabType }) => {
        setEnabled(tabType === "reader");
        return true;
      },
      onRender: async ({ body, item }) => {
        const paneId = body.dataset.paneId;
        Zotero.log(`[Gemini PDF] onRender started for pane: ${paneId}`);

        if (!paneId || !addon.data.chatPanes[paneId]) {
          Zotero.logError(new Error("Pane not initialized correctly."));
          return;
        }

        const paneState = addon.data.chatPanes[paneId];
        const { chatManager, uiManager } = paneState;

        if (!chatManager || !uiManager) {
          Zotero.logError(new Error("ChatManager or UIManager not found for pane."));
          return;
        }

        const doc = body.ownerDocument;
        const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
        const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
        const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
        const chatResizer = body.querySelector("#chat-resizer") as HTMLDivElement;
        const newChatButton = body.querySelector("#new-chat-button") as HTMLButtonElement; // Get reference to new button

        if (!doc || !chatMessages || !chatInput || !sendButton || !chatResizer || !newChatButton) return; // Add newChatButton to null check

        uiManager.initModelSelector();
        uiManager.initGoogleSearchCheckbox();

        chatMessages.addEventListener("click", (e: Event) => {
          const target = e.target as HTMLElement;
          const link = target.closest("a[href]");
          if (link) {
            const url = link.getAttribute("href");
            if (url && (url.startsWith("http:") || url.startsWith("https:"))) {
              e.preventDefault();
              e.stopPropagation();
              Zotero.launchURL(url);
            }
          }
        });

        const actualParentItem: Zotero.Item | null = (item.isAttachment() && item.parentID)
          ? await Zotero.Items.getAsync(item.parentID)
          : item;

        let currentConversation: ChatSessionHistory | null = null;
        let parentItemFileMetadata: ParentItemFileMetadata | null = null; // ParentItemFileMetadata を追加

        if (actualParentItem) {
          try {
            currentConversation = await ConversationManager.loadConversation(actualParentItem);
            Zotero.debug(`[ReaderItemPane] onRender: Loaded conversation history length: ${currentConversation.history.length}`);
            // Assign to paneState immediately after loading to ensure it's the source of truth
            paneState.currentConversation = currentConversation;
            uiManager._renderChatMessages(paneState.currentConversation); // Use paneState.currentConversation
            // ParentItemFileMetadata のロードと同期は初回メッセージ送信時に行うため、ここでは行わない
          } catch (e: any) {
            Zotero.logError(new Error(`Error loading conversation or syncing PDFs: ${e.message || String(e)}`));
            uiManager.addBotMessage(`Error loading conversation or syncing PDFs: ${e.message || String(e)}`, 'error-message');
          }
        }

        // Update the state with the latest context
        if (actualParentItem) {
          paneState.itemId = actualParentItem.id;
        } else {
          paneState.itemId = undefined; // Or handle appropriately if no parent item
        }
        Zotero.log(`[Gemini PDF] Pane ${paneId} onRender: Stored itemId is ${paneState.itemId}`);
        paneState.actualParentItem = actualParentItem;
        paneState.currentConversation = currentConversation;
        paneState.parentItemFileMetadata = parentItemFileMetadata; // paneStateにParentItemFileMetadataを格納
        chatResizer.addEventListener("mousedown", (e: MouseEvent) => {
          e.preventDefault();
          const startY = e.clientY;
          const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
          const startHeight = chatMessages.clientHeight;
          const chatContainer = body.querySelector(".chat-container") as HTMLDivElement;
          const chatInputArea = body.querySelector(".chat-input-area") as HTMLDivElement;
          const doDrag = (e: MouseEvent) => {
            const newHeight = startHeight + (e.clientY - startY);
            const minHeight = 50;
            const maxHeight = chatContainer.clientHeight - chatInputArea.clientHeight - chatResizer.clientHeight - 30;
            if (newHeight > minHeight && newHeight < maxHeight) {
              chatMessages.style.height = `${newHeight}px`;
              chatMessages.style.maxHeight = 'none';
            }
          };
          const stopDrag = () => {
            doc.removeEventListener("mousemove", doDrag, false);
            doc.removeEventListener("mouseup", stopDrag, false);
          };
          doc.addEventListener("mousemove", doDrag, false);
          doc.addEventListener("mouseup", stopDrag, false);
        });

        const handleSendMessage = async () => {
          const messageText = chatInput.value;
          if (messageText.trim() === "") return;
          if (actualParentItem && paneState.currentConversation) { // Changed currentConversation to paneState.currentConversation
            // parentItemFileMetadata がまだロードされていない場合、ここでロード/作成する
            if (!paneState.parentItemFileMetadata) {
              try {
                paneState.parentItemFileMetadata = await chatManager.synchronizePdfContext(actualParentItem, { addBotMessage: uiManager.addBotMessage, updateBotMessage: uiManager.updateBotMessage });
              } catch (e: any) {
                Zotero.logError(new Error(`Error synchronizing PDFs on first message: ${e.message || String(e)}`));
                uiManager.addBotMessage(`Error synchronizing PDFs: ${e.message || String(e)}`, 'error-message');
                return;
              }
            }

            // parentItemFileMetadata がロードまたは作成されたことを確認してから processAndSendMessage を呼び出す
            if (paneState.parentItemFileMetadata) {
              await chatManager.processAndSendMessage(
                paneId, // Pass paneId
                messageText, messageText, actualParentItem, paneState.currentConversation, // Changed currentConversation to paneState.currentConversation
                paneState.parentItemFileMetadata, // parentItemFileMetadata を渡す
                { uiManager: uiManager, addBotMessage: uiManager.addBotMessage, updateBotMessage: uiManager.updateBotMessage, chatInput, sendButton, chatMessages, popupTriggerButton: null, originalButtonText: undefined } // Pass null for popup button
              );
            }
          }
        };
        sendButton.addEventListener("click", handleSendMessage);
        chatInput.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSendMessage();
          }
        });

        // Event listener for the "New Chat" button
        newChatButton.addEventListener("click", () => {
          if (!actualParentItem) {
            Zotero.debug("[Gemini PDF] Cannot start new chat: No parent item selected.");
            return;
          }

          Zotero.debug("[Gemini PDF] Starting a new chat session.");
          const newChatId = uuidv4();
          const newChatTitle = "新しいチャット"; // Default title for new chats
          const newConversation: ChatSessionHistory = {
            metadata: {
              zoteroParentItemKey: actualParentItem.key,
              chatId: newChatId,
              chatTitle: newChatTitle,
            },
            history: [],
          };
          paneState.currentConversation = newConversation;
          uiManager._renderChatMessages(paneState.currentConversation); // Clear and render empty chat
          chatInput.value = ""; // Clear input field
          Zotero.debug(`[Gemini PDF] New chat session started with ID: ${newChatId}`);
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
}
