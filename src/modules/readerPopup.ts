// gemini-pdf/src/modules/readerPopup.ts
import { createZToolkit } from "../utils/ztoolkit";
import { getPref } from "../utils/prefs";
import { config } from "../../package.json";

export function buildReaderPopup(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
) {
  const { doc, append } = event;
  const ztoolkit = createZToolkit();

  const button = ztoolkit.UI.createElement(doc, "button", {
    namespace: "html",
    id: "gemini-pdf-popup-button",
    classList: ["toolbar-button", "gemini-selection-button"],
    properties: {
      innerHTML: "Gemini", // Or some icon
    },
    listeners: [
      {
        type: "click",
        listener: (e: Event) => {
          e.stopPropagation();

          const selectedText = addon.data.lastSelectedText || "";
          if (!selectedText) {
            Zotero.debug(`[${config.addonName}] No selected text found.`);
            return;
          }

          const promptTemplate = getPref("promptForSelection") || "";
          const fullPrompt = promptTemplate.replace("{selectedText}", selectedText);
          const summaryText = `*Regarding the question: "${selectedText.substring(0, 100)}${selectedText.length > 100 ? '...' : ''}"*`;

          if (addon.data.handleActionFromSelection) {
            addon.data.handleActionFromSelection(fullPrompt, summaryText);
          } else {
            Zotero.debug(
              `[${config.addonName}] handleActionFromSelection function not found.`,
            );
          }
        },
      },
    ],
  });

  append(button);
}
