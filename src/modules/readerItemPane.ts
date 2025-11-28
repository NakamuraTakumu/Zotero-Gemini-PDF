import { ChatPane } from "./reader/chatPane";
import { getLocaleID } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  PREF_SELECTED_MODEL,
  PREF_USE_GOOGLE_SEARCH,
  PREF_CONTEXT_WINDOW_SIZE,
  PREF_CHAT_PANEL_HEIGHT,
} from "../utils/constants";
import { ChatSessionHistory, ParentItemFileMetadata } from "../types/chat";
import { ConversationManager } from "./reader/conversation";

import { UIManager } from "./reader/ui";
import { ChatSessionManager } from "./reader/chatSessionManager"; // ChatSessionManager をインポート

import { v4 as uuidv4 } from "uuid";

/**
 * A factory class responsible for registering the chat pane UI and its lifecycle hooks with Zotero.
 * All methods are static as this class is not instantiated, but rather serves as a namespace
 * for UI registration and utility functions related to the reader pane.
 */
export class ReaderItemPaneFactory {
  /**
   * Dispatches a global event to notify other parts of the application about the
   * status of a Gemini API request.
   * @param {string} paneId The ID of the pane triggering the event.
   * @param {boolean} isRequestInProgress The status of the API request.
   */
  static dispatchRequestStatusChangedEvent(paneId: string, isRequestInProgress: boolean) {
    const event = new (Zotero.getMainWindow() as any).CustomEvent('gemini-pdf-request-status-changed', {
      bubbles: true,
      cancelable: true,
      detail: { paneId, isRequestInProgress }
    });
    Zotero.getMainWindow().document.dispatchEvent(event);
  }


  /**
   * Registers the main chat pane section with Zotero's ItemPaneManager.
   * This method defines the UI structure (XHTML) and the lifecycle hooks that Zotero
   * will call at different stages.
   * - onInit: Called once when the pane is first created. It instantiates the ChatPane class.
   * - onDestroy: Called when the pane is closed. It calls the ChatPane's destroy method for cleanup.
   * - onRender: Called whenever the pane is displayed or the item changes. It delegates rendering to the ChatPane instance.
   */
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
                    <html:div class="chat-session-area">
              <html:label for="chat-session-switcher">Session:</html:label>
              <html:select id="chat-session-switcher" class="chat-session-switcher"></html:select>
              <html:button id="delete-session-button" class="delete-session-button">🗑️</html:button>
          </html:div>
          <html:div class="chat-model-selector-area">
              <html:label for="gemini-model-select">Model:</html:label>
              <html:select id="gemini-model-select" class="gemini-model-select"></html:select>
                                      <html:label for="use-google-search-checkbox">Use Google Search:</html:label>
                                      <html:input type="checkbox" id="use-google-search-checkbox" />
                                      <html:label for="include-thoughts-checkbox">Include Thoughts:</html:label>
                                      <html:input type="checkbox" id="include-thoughts-checkbox" />          </html:div>
                                      
          <html:div class="chat-input-area">
              <html:textarea id="chat-input" class="chat-input" placeholder="Type a message..."></html:textarea>
              <html:div class="chat-buttons-container">
                                    <html:button id="send-button" class="send-button">Send</html:button>
                                    <html:button id="new-chat-button" class="new-chat-button">New</html:button>
              </html:div>
          </html:div>
      </html:div>`,
      onInit: ({ body }) => {
        Zotero.log("[Gemini PDF] onInit called.");
        try {
          const chatPane = new ChatPane(body as HTMLElement);
          addon.data.chatPanes[chatPane.paneId] = chatPane;
        } catch (e) {
          Zotero.logError(new Error(`[Gemini PDF] Error initializing pane: ${e}`));
        }
      },
      onDestroy: ({ body }) => {
        const paneId = body.dataset.paneId;
        if (paneId && addon.data.chatPanes[paneId]) {
          const chatPane = addon.data.chatPanes[paneId];
          chatPane.destroy();
          delete addon.data.chatPanes[paneId];
        }
      },
      onItemChange: ({ item, setEnabled, tabType }) => {
        setEnabled(tabType === "reader");
        return true;
      },
      onRender: async ({ body, item }) => {
        const paneId = body.dataset.paneId;
        if (!paneId || !addon.data.chatPanes[paneId]) {
          Zotero.logError(new Error("Pane not initialized correctly."));
          return;
        }
        const chatPane = addon.data.chatPanes[paneId];
        await chatPane.render(item);
      },
    });
  }

  /**
   * Injects the CSS stylesheets required for the chat pane into the main Zotero window.
   * @param {_ZoteroTypes.MainWindow} win The main Zotero window.
   */
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
