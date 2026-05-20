/* eslint-disable no-unused-vars */
/* global Zotero, addon, window */
var MyPluginPreferences = {
  onLoad: function () {
    Zotero.PreferencePages.init();
    // Call the hook to initialize preferences
    addon.hooks.onPrefsWindowLoad(window);
  },

  onUnload: function () {
    // No custom event listeners to remove yet
  },
};
