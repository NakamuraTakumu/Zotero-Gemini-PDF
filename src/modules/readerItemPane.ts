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

  static async ensureParentItemFileMetadata(pane: ChatPane): Promise<boolean> {
    const { managers, zoteroContext, chatData, runtimeState, paneId } = pane;
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
          <html:div class="chat-session-area" style="display: flex; align-items: center; gap: 5px; padding-bottom: 5px;">
              <html:label for="chat-session-switcher">Session:</html:label>
              <html:select id="chat-session-switcher" class="chat-session-switcher" style="flex-grow: 1;"></html:select>
              <html:button id="delete-session-button" class="delete-session-button">🗑️</html:button>
          </html:div>
          <html:div class="chat-model-selector-area">
              <html:label for="gemini-model-select">Model:</html:label>
              <html:select id="gemini-model-select" class="gemini-model-select"></html:select>
                                      <html:label for="use-google-search-checkbox" style="margin-left: 10px;">Use Google Search:</html:label>
                                      <html:input type="checkbox" id="use-google-search-checkbox" />
                                      <html:label for="include-thoughts-checkbox" style="margin-left: 10px;">Include Thoughts:</html:label>
                                      <html:input type="checkbox" id="include-thoughts-checkbox" />          </html:div>
          <html:div class="chat-input-area">
              <html:textarea id="chat-input" class="chat-input" placeholder="Type a message..."></html:textarea>
              <html:div style="display: flex; flex-direction: column; gap: 5px;">
                  <html:button id="send-button" class="send-button">Send</html:button>
                  <html:button id="new-chat-button" class="new-chat-button">新しいチャット</html:button>
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
