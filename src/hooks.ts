import { ReaderItemPaneFactory } from "./modules/readerItemPane";
import { registerPrefsScripts } from "./modules/preferenceScript"; // Import the preference script
import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { buildReaderPopup } from "./modules/readerPopup";
import { GEMINI_CHAT_TITLE_PREFIX } from "./utils/constants"; // Import GEMINI_CHAT_TITLE_PREFIX
import { ConversationManager } from "./modules/reader/conversation"; // Import ConversationManager
import { ChatSessionHistory } from "./types/chat"; // Import ChatSessionHistory

const observerID = "geminiPDFPluginObserver"; // Define a unique ID for the observer

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // Define a global debug function for testing clicks
  _globalThis.geminiDebugClick = () => {
    Zotero.log("[Gemini PDF] Global debug click fired!");
  };

  initLocale();

  // Register the observer for item changes
  Zotero.Notifier.registerObserver(hooks, ['item'], observerID);
  Zotero.log('GeminiPDFPlugin: Item observer registered.');

  // Register the reader item pane section
  await ReaderItemPaneFactory.registerReaderItemPaneSection();

  // Register our function to inject the button into the reader popup
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    (event) => {
      addon.data.lastSelectedText = event.params.annotation.text?.trim();
      buildReaderPopup(event);
    },
    addon.data.config.addonID
  );

  // Register the preference pane
  Zotero.PreferencePanes.register({
    id: addon.data.config.addonRef,
    pluginID: addon.data.config.addonID, // Add pluginID
    src: `chrome://${addon.data.config.addonRef}/content/preferences.xhtml`, // Change to .xhtml
    label: "Gemini PDF Settings", // You can localize this label
    // image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`, // Optional icon
  });

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  // Register the chat stylesheet
  ReaderItemPaneFactory.registerChatStyleSheet(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  Zotero.Notifier.unregisterObserver(observerID); // Unregister the observer
  Zotero.log('GeminiPDFPlugin: Item observer unregistered.');
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsWindowLoad(window: Window): Promise<void> {
  await registerPrefsScripts(window);
}

/**
 * Zotero Notifier callback function.
 * @param {string} event - The type of event (e.g., 'add', 'modify', 'delete').
 * @param {string} type - The type of object (e.g., 'item', 'collection', 'tag').
 * @param {string[]} ids - An array of IDs of the affected objects.
 * @param {string[]} extraData - Additional data related to the event.
 */
async function notify(event: string, type: string, ids: (string | number)[], extraData: any) {
  if (type === 'item') {
    for (const id of ids) {
      const item = await Zotero.Items.getAsync(id);

      if (!item) {
        // Item might have been deleted before we could retrieve it
        continue;
      }

      // Check if the item is our chat history attachment
      if (Zotero.ItemTypes.getName(item.itemType) === 'attachment' && item.getField('title')?.startsWith(GEMINI_CHAT_TITLE_PREFIX)) {
        Zotero.log(`[Gemini PDF] Chat history attachment event: ${event} for item ID: ${id}, parent ID: ${item.parentID}`);

        // Iterate through active chat panes to find the one associated with this parent item
        for (const paneId in addon.data.chatPanes) {
          const paneState = addon.data.chatPanes[paneId];
          if (paneState.zoteroContext.itemId === item.parentID) {
            Zotero.log(`[Gemini PDF] Reloading conversation for pane ${paneId} due to attachment change.`);

            const { managers, zoteroContext, uiElements, chatData } = paneState;

            if (!managers.chatManager || !managers.uiManager || !zoteroContext.actualParentItem || !uiElements.doc || !uiElements.body) {
                Zotero.logError(new Error(`[Gemini PDF] Cannot reload pane ${paneId}: Missing required components.`));
                continue;
            }

            const chatMessages = uiElements.body.querySelector("#chat-messages") as HTMLDivElement;
            if (!chatMessages) {
                Zotero.logError(new Error(`[Gemini PDF] Cannot reload pane ${paneId}: chatMessages element not found.`));
                continue;
            }

            try {
                const reloadedConversation: ChatSessionHistory = await ConversationManager.loadConversation(zoteroContext.actualParentItem);
                paneState.chatData.currentConversation = reloadedConversation; // Update the pane's current conversation
                managers.uiManager._renderChatMessages(reloadedConversation);
            } catch (e: any) {
                Zotero.logError(new Error(`[Gemini PDF] Error reloading conversation for pane ${paneId}: ${e.message || String(e)}`));
                managers.uiManager.addBotMessage(`Error reloading conversation: ${e.message || String(e)}`, 'error-message');
            }
          }
        }
      }
    }
  }
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

const hooks = {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsWindowLoad, // Add the new hook
  notify, // Add the notify method to hooks
};

export default hooks;

