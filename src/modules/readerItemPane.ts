import { getLocaleID } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  PREF_SELECTED_MODEL,
  PREF_USE_GOOGLE_SEARCH,
  PREF_CONTEXT_WINDOW_SIZE,
  PREF_CHAT_PANEL_HEIGHT,
} from "../utils/constants";
import { ChatSessionHistory, ParentItemFileMetadata, ChatPaneState } from "../types/chat";
import { ConversationManager } from "./reader/conversation";
import { ChatManager } from "./reader/chat";
import { UIManager } from "./reader/ui";
import { ChatSessionManager } from "./reader/chatSessionManager"; // ChatSessionManager をインポート

import { v4 as uuidv4 } from "uuid";

// chat用タブ
export class ReaderItemPaneFactory {
  static dispatchRequestStatusChangedEvent(paneId: string, isRequestInProgress: boolean) {
    const event = new (Zotero.getMainWindow() as any).CustomEvent('gemini-pdf-request-status-changed', {
      bubbles: true,
      cancelable: true,
      detail: { paneId, isRequestInProgress }
    });
    Zotero.getMainWindow().document.dispatchEvent(event);
  }

  static async ensureParentItemFileMetadata(paneState: ChatPaneState): Promise<boolean> {
    const { managers, zoteroContext, chatData, runtimeState, paneId } = paneState;
    if (!zoteroContext.actualParentItem || !managers.chatManager || !managers.uiManager) {
      Zotero.logError(new Error("Cannot ensure parentItemFileMetadata: missing actualParentItem, chatManager, or uiManager."));
      return false;
    }

    if (!chatData.parentItemFileMetadata) {
      try {
        chatData.parentItemFileMetadata = await managers.chatManager.synchronizePdfContext(zoteroContext.actualParentItem, { addBotMessage: managers.uiManager.addBotMessage, updateBotMessage: managers.uiManager.updateBotMessage });
        return true;
      } catch (e: any) {
        Zotero.logError(new Error(`Error synchronizing PDFs: ${e.message || String(e)}`));
        managers.uiManager.addBotMessage(`Error synchronizing PDFs: ${e.message || String(e)}`, 'error-message');
        runtimeState.isGeminiRequestInProgress = false; // Reset state on error
        ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(paneId, false); // Dispatch event on error
        return false;
      }
    }
    return true;
  }

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
              <html:label for="chat-session-switcher">Session:</html:label>
              <html:select id="chat-session-switcher" class="chat-session-switcher"></html:select>
              <html:button id="delete-session-button" class="delete-session-button">🗑️</html:button>
              <html:label for="gemini-model-select" style="margin-left: 10px;">Model:</html:label>
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

        // ChatManager and UIManager will be initialized in onRender
        // const chatManager = new ChatManager(window, undefined); // chatSessionManager is optional now
        // const uiManager = new UIManager(doc, body, chatMessages, chatManager); // Pass chatManager to UIManager
        // uiManager.registerPrefObservers();

        const handleGeminiAction = (event: Event) => {
          const customEvent = event as CustomEvent;
          const state = addon.data.chatPanes[paneId];
          Zotero.log(`[Gemini PDF] Pane ${paneId} received event. My itemId is ${state?.zoteroContext.itemId}. Event detail: ${JSON.stringify(customEvent.detail)}`);
          if (!state || !state.zoteroContext.itemId || state.zoteroContext.itemId !== customEvent.detail.itemId) {
            return;
          }
          // Check if a request is already in progress for this pane
          if (state.runtimeState.isGeminiRequestInProgress) {
            Zotero.debug(`[Gemini PDF] Request already in progress for pane ${paneId}. Skipping action.`);
            return;
          }
          Zotero.log(`[Gemini PDF] Action event received for matching item ${state.zoteroContext.itemId}`);
          (async () => {
            const { fullPrompt, summaryText, popupTriggerButton, originalButtonText } = customEvent.detail;
            const { managers, zoteroContext, chatData, runtimeState, chatSessionManager } = state; // chatSessionManager を取得

            if (!chatSessionManager || !managers.chatManager || !managers.uiManager) { // managers.chatManager, managers.uiManager もチェック
              Zotero.logError(new Error("ChatSessionManager or ChatManager/UIManager is not initialized in paneState for handleGeminiAction."));
              return;
            }

            const currentConversation = chatSessionManager.getActiveSession(); // Get active session from manager
            if (!currentConversation) {
              Zotero.logError(new Error("No active conversation found in ChatSessionManager for handleGeminiAction."));
              runtimeState.isGeminiRequestInProgress = false;
              ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(paneId, false);
              return;
            }

            const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
            const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
            const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
            state.runtimeState.isGeminiRequestInProgress = true; // Set state to true for this pane
            ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(paneId, true); // Dispatch event

            // Ensure parentItemFileMetadata is available
            if (!await ReaderItemPaneFactory.ensureParentItemFileMetadata(state)) {
              runtimeState.isGeminiRequestInProgress = false; // Reset state on error during ensure
              ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(paneId, false); // Dispatch event on error
              return;
            }

            // processAndSendMessage の呼び出し前に actualParentItem が null でないことを確認
            if (!zoteroContext.actualParentItem) {
              Zotero.logError(new Error("Cannot process and send message: actualParentItem is null."));
              runtimeState.isGeminiRequestInProgress = false;
              ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(paneId, false);
              return;
            }

            // parentItemFileMetadata がロードまたは作成されたことを確認してから processAndSendMessage を呼び出す
            if (chatData.parentItemFileMetadata) {
              await managers.chatManager.processAndSendMessage(
                paneId, // Pass paneId
                summaryText,
                fullPrompt,
                zoteroContext.actualParentItem,
                chatData.parentItemFileMetadata, // parentItemFileMetadata を渡す
                {
                  uiManager: managers.uiManager, // Pass uiManager reference
                  addBotMessage: managers.uiManager.addBotMessage,
                  updateBotMessage: managers.uiManager.updateBotMessage,
                  chatInput,
                  sendButton,
                  chatMessages,
                  popupTriggerButton, // Pass the button reference
                  originalButtonText, // Pass original text
                }
              );
            }
          })();
        };
        Zotero.getMainWindow().document.addEventListener('gemini-pdf-action', handleGeminiAction);
        addon.data.chatPanes[paneId] = {
          paneId,
          uiElements: {
            doc,
            body,
          },
          managers: undefined as any, // Will be initialized in onRender
          zoteroContext: {
            itemId: undefined,
            actualParentItem: null,
          },
          chatData: {
            currentConversation: null,
            parentItemFileMetadata: null,
          },
          runtimeState: {
            eventHandler: handleGeminiAction,
            isGeminiRequestInProgress: false,
          },
        };
      },
      onDestroy: ({ body }) => {
        const paneId = body.dataset.paneId;
        if (paneId && addon.data.chatPanes[paneId]) {
          const paneState = addon.data.chatPanes[paneId];
          const uiManager = paneState.managers.uiManager;
          const eventHandler = paneState.runtimeState.eventHandler;
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
          Zotero.logError(new Error("Pane not initialized correctly."))
          return;
        }

        const paneState = addon.data.chatPanes[paneId]; // paneState を一番上に移動

        const actualParentItem: Zotero.Item | null = (item.isAttachment() && item.parentID)
          ? await Zotero.Items.getAsync(item.parentID)
          : item;

        if (!paneState.managers) { // Check if managers is initialized
            if (!actualParentItem) {
                Zotero.logError(new Error("Cannot initialize managers, no parent item found."));
                return;
            }
            const { doc, body } = paneState.uiElements;
            const window = doc.defaultView as any;
            const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;

            const chatSessionManager = new ChatSessionManager(actualParentItem, (session) => {
                // onActiveSessionChange callback
                if (paneState.managers) {
                    paneState.managers.uiManager._renderChatMessages(session);
                    paneState.chatData.currentConversation = session;
                }
            });
            await chatSessionManager.init();

            const chatManager = new ChatManager(window, chatSessionManager);
            const uiManager = new UIManager(doc, body, chatMessages, chatManager);
            uiManager.registerPrefObservers();

            paneState.managers = { chatManager, uiManager };
            (paneState as any).chatSessionManager = chatSessionManager;
        }

        const { managers, uiElements, zoteroContext, chatData, chatSessionManager } = paneState as any;

        if (!managers) {
          Zotero.logError(new Error("Managers not initialized in paneState."));
          return;
        }

        // Initialize UI elements using UIManager methods
        managers.uiManager.initModelSelector();
        managers.uiManager.initGoogleSearchCheckbox();
        managers.uiManager.initSessionSwitcher();
        managers.uiManager.initDeleteButton();

        const doc = uiElements.doc;
        const chatMessages = uiElements.body.querySelector("#chat-messages") as HTMLDivElement;
        const chatInput = uiElements.body.querySelector("#chat-input") as HTMLTextAreaElement;
        const sendButton = uiElements.body.querySelector("#send-button") as HTMLButtonElement;
        const chatResizer = uiElements.body.querySelector("#chat-resizer") as HTMLDivElement;
        const newChatButton = uiElements.body.querySelector("#new-chat-button") as HTMLButtonElement; // Get reference to new button

        if (!doc || !chatMessages || !chatInput || !sendButton || !chatResizer || !newChatButton) return; // Add newChatButton to null check

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

        const currentConversation = chatSessionManager.getActiveSession();

        if (actualParentItem) {
          try {
            // Assign to paneState immediately after loading to ensure it's the source of truth
            paneState.chatData.currentConversation = currentConversation; 
            if (currentConversation) {
              managers.uiManager._renderChatMessages(paneState.chatData.currentConversation); 
            } else {
               Zotero.logError(new Error("No active conversation found after init."));
               managers.uiManager.addBotMessage('チャットの読み込みに失敗しました。', 'error-message');
            }
            // ParentItemFileMetadata のロードと同期は初回メッセージ送信時に行うため、ここでは行わない
          } catch (e: any) {
            Zotero.logError(new Error(`Error loading conversation or syncing PDFs: ${e.message || String(e)}`));
            managers.uiManager.addBotMessage(`Error loading conversation or syncing PDFs: ${e.message || String(e)}`, 'error-message');
          }
        }

        // Update the state with the latest context
        if (actualParentItem) {
          paneState.zoteroContext.itemId = actualParentItem.id;
        } else {
          paneState.zoteroContext.itemId = undefined; // Or handle appropriately if no parent item
        }
        Zotero.log(`[Gemini PDF] Pane ${paneId} onRender: Stored itemId is ${paneState.zoteroContext.itemId}`);
        paneState.zoteroContext.actualParentItem = actualParentItem;

        const savedHeight = getPref(PREF_CHAT_PANEL_HEIGHT) as number;
        if (savedHeight) {
          chatMessages.style.height = `${savedHeight}px`;
          chatMessages.style.maxHeight = 'none';
        }

        chatResizer.addEventListener("mousedown", (e: MouseEvent) => {
          e.preventDefault();
          const startY = e.clientY;
          const chatMessages = uiElements.body.querySelector("#chat-messages") as HTMLDivElement;
          const startHeight = chatMessages.clientHeight;
          const chatContainer = uiElements.body.querySelector(".chat-container") as HTMLDivElement;
          const chatInputArea = uiElements.body.querySelector(".chat-input-area") as HTMLDivElement;
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
            setPref(PREF_CHAT_PANEL_HEIGHT, chatMessages.clientHeight);
          };
          doc.addEventListener("mousemove", doDrag, false);
          doc.addEventListener("mouseup", stopDrag, false);
        });

        const handleSendMessage = async () => {
          const messageText = chatInput.value;
          if (messageText.trim() === "") return;

          // Check if a request is already in progress for this pane
          if (paneState.runtimeState.isGeminiRequestInProgress) {
            Zotero.debug(`[Gemini PDF] Request already in progress for pane ${paneId}. Skipping message send.`);
            return;
          }

                      if (zoteroContext.actualParentItem && chatData.currentConversation) {
                      paneState.runtimeState.isGeminiRequestInProgress = true; // Set state to true for this pane
                      ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(paneId, true); // Dispatch event
          
                      // parentItemFileMetadata がまだロードされていない場合、ここでロード/作成する
                      if (!chatData.parentItemFileMetadata) {
                        try {
                          chatData.parentItemFileMetadata = await managers.chatManager.synchronizePdfContext(zoteroContext.actualParentItem, { addBotMessage: managers.uiManager.addBotMessage, updateBotMessage: managers.uiManager.updateBotMessage });
                        } catch (e: any) {
                          Zotero.logError(new Error(`Error synchronizing PDFs on first message: ${e.message || String(e)}`));
                          managers.uiManager.addBotMessage(`Error synchronizing PDFs: ${e.message || String(e)}`, 'error-message');
                          paneState.runtimeState.isGeminiRequestInProgress = false; // Reset state on error
                          ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(paneId, false); // Dispatch event on error
                          return;
                        }
                      }
            // parentItemFileMetadata がロードまたは作成されたことを確認してから processAndSendMessage を呼び出す
            // ensureParentItemFileMetadata が成功していれば chatData.parentItemFileMetadata は non-null
            if (chatData.parentItemFileMetadata) {
              await managers.chatManager.processAndSendMessage(
                paneId, // Pass paneId
                messageText, messageText, zoteroContext.actualParentItem,
                chatData.parentItemFileMetadata, // parentItemFileMetadata を渡す
                { uiManager: managers.uiManager, addBotMessage: managers.uiManager.addBotMessage, updateBotMessage: managers.uiManager.updateBotMessage, chatInput, sendButton, chatMessages, popupTriggerButton: null, originalButtonText: undefined } // Pass null for popup button
              );
            } else {
              Zotero.logError(new Error("parentItemFileMetadata is unexpectedly null after ensureParentItemFileMetadata."));
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
        newChatButton.addEventListener("click", async () => { // Changed to async
          if (!zoteroContext.actualParentItem) {
            Zotero.debug("[Gemini PDF] Cannot start new chat: No parent item selected.");
            return;
          }

          // Use ChatSessionManager to create a new session
          const newConversation = await (paneState as any).chatSessionManager?.createSession("新しいチャット"); // Use default title for now
          if (newConversation) {
            managers.uiManager.updateSessionSwitcher();
            // The rest of the UI update is handled by the onActiveSessionChange callback
            chatInput.value = ""; // Clear input field
            chatData.parentItemFileMetadata = null; // Reset parentItemFileMetadata for the new session
            Zotero.debug(`[Gemini PDF] New chat session started with ID: ${newConversation.metadata.chatId}`);
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
}
