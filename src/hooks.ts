import { ReaderItemPaneFactory } from "./modules/readerItemPane";
import { registerPrefsScripts } from "./modules/preferenceScript"; // Import the preference script
import { initLocale } from "./utils/locale";
import { buildReaderPopup } from "./modules/readerPopup";
import { migrateProviderPrefs } from "./utils/prefMigration";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  migrateProviderPrefs();

  // Register the observer for item changes
  // Zotero.Notifier.registerObserver(hooks, ["item"], observerID);
  // Zotero.log("AskMyPaperPlugin: Item observer registered.");

  // Register the reader item pane section
  await ReaderItemPaneFactory.registerReaderItemPaneSection();

  // Register our function to inject the button into the reader popup
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    (event) => {
      addon.data.lastSelectedText = event.params.annotation.text?.trim();
      buildReaderPopup(event);
    },
    addon.data.config.addonID,
  );

  // Register the preference pane
  Zotero.PreferencePanes.register({
    id: addon.data.config.addonRef,
    pluginID: addon.data.config.addonID, // Add pluginID
    src: `chrome://${addon.data.config.addonRef}/content/preferences.xhtml`, // Change to .xhtml
    label: "Ask My Paper Settings", // You can localize this label
    // image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`, // Optional icon
  });

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  // Register the chat stylesheet
  ReaderItemPaneFactory.registerChatStyleSheet(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  // `addon.data.ztoolkit` is owned by the add-on, not by an individual main
  // window. Destroying it here would unregister resources still used by other
  // open windows. Window-owned DOM resources are released with their window.
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  // Zotero.Notifier.unregisterObserver(observerID); // Unregister the observer
  // Zotero.log("AskMyPaperPlugin: Item observer unregistered.");
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsWindowLoad(window: Window): Promise<void> {
  await registerPrefsScripts(window);
}

const hooks = {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsWindowLoad, // Add the new hook
};

export default hooks;
