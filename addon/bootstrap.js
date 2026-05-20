/**
 * Most of this code is from Zotero team's official Make It Red example[1]
 * or the Zotero 7 documentation[2].
 * [1] https://github.com/zotero/make-it-red
 * [2] https://www.zotero.org/support/dev/zotero_7_for_developers
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  try {
    Zotero.log(`[Gemini PDF] Plugin started up! Version: ${version}`); // Changed to Zotero.log
    var aomStartup = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    var manifestURI = Services.io.newURI(rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "__addonRef__", rootURI + "content/"],
    ]);

    /**
     * Global variables for plugin code.
     * The `_globalThis` is the global root variable of the plugin sandbox environment
     * and all child variables assigned to it is globally accessible.
     * See `src/index.ts` for details.
     */
    const ctx = { rootURI };
    ctx._globalThis = ctx;
    ctx.console = {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    const webGlobal =
      Services.wm.getMostRecentWindow("navigator:browser") ||
      Services.wm.getMostRecentWindow(null);
    for (const name of [
      "AbortController",
      "AbortSignal",
      "Blob",
      "File",
      "FormData",
      "Headers",
      "ReadableStream",
      "Request",
      "Response",
      "TextDecoder",
      "TextEncoder",
      "TransformStream",
      "URL",
      "URLSearchParams",
      "WritableStream",
      "crypto",
      "fetch",
      "performance",
    ]) {
      if (typeof webGlobal[name] !== "undefined") {
        ctx[name] =
          name === "fetch" ? webGlobal[name].bind(webGlobal) : webGlobal[name];
      }
    }
    if (typeof ctx.performance === "undefined") {
      ctx.performance = {
        now: () => Date.now(),
      };
    }

    Services.scriptloader.loadSubScript(
      `${rootURI}/content/scripts/__addonRef__.js`,
      ctx,
    );
    await Zotero.__addonInstance__.hooks.onStartup();
    Zotero.__addonInstance__.data.globalChatManager?.init(); // Initialize GlobalChatManager
  } catch (e) {
    Zotero.logError(e);
    throw e;
  }
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  Zotero.__addonInstance__.data.globalChatManager?.destroy(); // Destroy GlobalChatManager
  await Zotero.__addonInstance__?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}
