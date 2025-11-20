import { ReaderItemPaneFactory } from "./modules/readerItemPane";
import { registerPrefsScripts } from "./modules/preferenceScript"; // Import the preference script
import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Register the reader item pane section
  await ReaderItemPaneFactory.registerReaderItemPaneSection();

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
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsWindowLoad(window: Window): Promise<void> {
  await registerPrefsScripts(window);
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsWindowLoad, // Add the new hook
};
