import { config } from "../../package.json";

/**
 * This script is loaded when the preference pane is opened.
 * @param _window The preference window object
 */
export function registerPrefsScripts(_window: Window) {
  // With the <... preference="..."> attribute in preferences.xhtml,
  // Zotero handles loading and saving the preference values automatically.
  // This script is now mostly for debugging or for handling more complex
  // preference UI that can't be handled declaratively.
  Zotero.debug(`[${config.addonName}] Preference pane script loaded.`);
}