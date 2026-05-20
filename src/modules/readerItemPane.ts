import { ChatPane } from "./reader/chatPane";
import { getLocaleID } from "../utils/locale";

import { buildReaderItemPaneBodyXhtml } from "./reader/itemPaneMarkup";

/**
 * A factory class responsible for registering the chat pane UI and its lifecycle hooks with Zotero.
 * All methods are static as this class is not instantiated, but rather serves as a namespace
 * for UI registration and utility functions related to the reader pane.
 */
export class ReaderItemPaneFactory {
  private static _chatPanes: Map<string, ChatPane> = new Map(); // Local map to store ChatPane instances

  /**
   * Returns a map of all active ChatPane instances managed by the factory.
   * This is used by other modules to interact with specific panes.
   * @returns {Map<string, ChatPane>} A map where keys are paneIds and values are ChatPane instances.
   */
  public static getChatPanes(): Map<string, ChatPane> {
    return ReaderItemPaneFactory._chatPanes;
  }
  /**
   * Dispatches a global event to notify other parts of the application about the
   * status of an LLM request.
   * @param {string} paneId The ID of the pane triggering the event.
   * @param {boolean} isRequestInProgress The status of the API request.
   */
  static dispatchRequestStatusChangedEvent(
    paneId: string,
    isRequestInProgress: boolean,
  ) {
    const event = new (Zotero.getMainWindow() as any).CustomEvent(
      "gemini-pdf-request-status-changed",
      {
        bubbles: true,
        cancelable: true,
        detail: { paneId, isRequestInProgress },
      },
    );
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
      bodyXHTML: buildReaderItemPaneBodyXhtml(),
      onInit: ({ body }) => {
        Zotero.log("[Gemini PDF] onInit called.");
        try {
          const chatPane = new ChatPane(body as HTMLElement);
          ReaderItemPaneFactory._chatPanes.set(chatPane.paneId, chatPane); // Store instance locally
        } catch (e) {
          Zotero.logError(
            new Error(`[Gemini PDF] Error initializing pane: ${e}`),
          );
        }
      },
      onDestroy: ({ body }) => {
        const paneId = body.dataset.paneId;
        if (paneId && ReaderItemPaneFactory._chatPanes.has(paneId)) {
          const chatPane = ReaderItemPaneFactory._chatPanes.get(paneId)!;
          chatPane.destroy();
          ReaderItemPaneFactory._chatPanes.delete(paneId); // Remove from local map
        }
      },
      onItemChange: ({ item, setEnabled, tabType }) => {
        setEnabled(tabType === "reader");
        return true;
      },
      onRender: async ({ body, item }) => {
        const paneId = body.dataset.paneId;
        if (!paneId || !ReaderItemPaneFactory._chatPanes.has(paneId)) {
          Zotero.logError(new Error("Pane not initialized correctly."));
          return;
        }
        const chatPane = ReaderItemPaneFactory._chatPanes.get(paneId)!;
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
