import { getLocaleID } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  PREF_MODEL_LIST,
  PREF_SELECTED_MODEL,
  PREF_USE_GOOGLE_SEARCH,
} from "../utils/constants";
import { Conversation } from "../types/chat";
import { ConversationManager } from "./reader/conversation";
import { ChatManager } from "./reader/chat";
import { UIManager } from "./reader/ui";

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
        const uiManager = new UIManager(doc, body, chatMessages);
        uiManager.registerPrefObservers();

        const handleGeminiAction = (event: Event) => {

          const customEvent = event as CustomEvent;

          const state = addon.data.chatPanes[paneId];



          Zotero.log(`[Gemini PDF] Pane ${paneId} received event. My itemId is ${state?.itemId}. Event detail: ${JSON.stringify(customEvent.detail)}`);



          if (!state || !state.itemId || state.itemId !== customEvent.detail.itemId) {

            return;

          }

          Zotero.log(`[Gemini PDF] Action event received for matching item ${state.itemId}`);



          (async () => {

            const { fullPrompt, summaryText } = customEvent.detail;

            const { chatManager, uiManager, actualParentItem, currentConversation } = state;

            const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;

            const sendButton = body.querySelector("#send-button") as HTMLButtonElement;

            const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;



            if (chatManager && actualParentItem && currentConversation && uiManager) {

              await chatManager.processAndSendMessage(

                summaryText,

                fullPrompt,

                actualParentItem,

                currentConversation,

                {

                  addBotMessage: uiManager.addBotMessage,

                  updateBotMessage: uiManager.updateBotMessage,

                  chatInput,

                  sendButton,

                  chatMessages

                }

              );

            }

          })();

        };



        Zotero.getMainWindow().document.addEventListener('gemini-pdf-action', handleGeminiAction);



        addon.data.chatPanes[paneId] = {

          chatManager,

          uiManager,

          paneId,

          eventHandler: handleGeminiAction,

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



        if (!doc || !chatMessages || !chatInput || !sendButton || !chatResizer) return;



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



        



                let currentConversation: Conversation | null = null;



                if (actualParentItem) {



                  try {



                    currentConversation = await ConversationManager.loadConversation(actualParentItem);



                    chatMessages.innerHTML = "";



                    for (const message of currentConversation.history) {



                      const messageDiv = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLDivElement;



                      messageDiv.className = `message ${message.role}-message`;



                      let messageHtml = chatManager.renderMarkdown(message.parts[0].text);



                      if (message.role === 'model' && message.groundingMetadata) {



                        let sources = '';



                        if (message.groundingMetadata.groundingChunks && message.groundingMetadata.groundingChunks.length > 0) {



                          sources = message.groundingMetadata.groundingChunks.map((chunk: any, index: number) => {



                            if (chunk.web) {



                              return `<a href="${chunk.web.uri}" target="_blank">[${index + 1}] ${chunk.web.title}</a>`;



                            }



                            return null;



                          }).filter(Boolean).join('');



                        } else if (message.groundingMetadata.retrievedReferences && message.groundingMetadata.retrievedReferences.length > 0) {



                          sources = message.groundingMetadata.retrievedReferences.map((ref: any, index: number) => 



                            `<a href="${ref.uri}" target="_blank">[${index + 1}] ${ref.title}</a>`



                          ).join('');



                        }



                        if (sources) {



                          messageHtml += `<div class="sources-container"><b>参照元:</b>${sources}</div>`;



                        }



                      }



                      messageDiv.innerHTML = messageHtml;



                      chatMessages.appendChild(messageDiv);



                    }



                    chatMessages.scrollTop = chatMessages.scrollHeight;



                  } catch (e: any) {



                    Zotero.logError(new Error(`Error loading conversation: ${e.message || String(e)}`));



                    uiManager.addBotMessage(`Error loading conversation: ${e.message || String(e)}`, 'error-message');



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

          if (actualParentItem && currentConversation) {

            await chatManager.processAndSendMessage(

              messageText, messageText, actualParentItem, currentConversation,

              { addBotMessage: uiManager.addBotMessage, updateBotMessage: uiManager.updateBotMessage, chatInput, sendButton, chatMessages }

            );

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
}
