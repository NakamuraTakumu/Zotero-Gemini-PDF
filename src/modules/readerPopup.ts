// gemini-pdf/src/modules/readerPopup.ts
import { createZToolkit } from "../utils/ztoolkit";
import { getPref, setPref } from "../utils/prefs";
import { config } from "../../package.json";
import { GEMINI_ICON } from "../utils/icon"; // Import GEMINI_ICON
import { PREF_PROMPT_FOR_SELECTION, PREF_USE_GOOGLE_SEARCH } from "../utils/constants";

export function buildReaderPopup(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
) {
  const { doc, append } = event;
  const ztoolkit = createZToolkit();

  const button = ztoolkit.UI.createElement(doc, "button", {
    namespace: "html",
    id: "gemini-pdf-popup-button",
    properties: {
      innerHTML: `${GEMINI_ICON}Geminiに聞く`, // Use icon and updated text
    },
    styles: {
      backgroundColor: "#4285f4",
      color: "white",
      fontWeight: "bold",
      borderRadius: "4px",
      padding: "6px 12px",
      marginInlineEnd: "5px",
      border: "1px solid #1a73e8",
      whiteSpace: "nowrap",
      cursor: "pointer",
    },
    listeners: [
      {
        type: "click",
        listener: async (e: Event) => { // Made listener async
          e.stopPropagation();

          const selectedText = addon.data.lastSelectedText || "";
          if (!selectedText) {
            Zotero.debug(`[${config.addonName}] No selected text found.`);
            return;
          }

          const promptTemplate = getPref(PREF_PROMPT_FOR_SELECTION) || "";
          const fullPrompt = promptTemplate.replace("{selectedText}", selectedText);
          const summaryText = `*Regarding the question: "${selectedText.substring(0, 100)}${selectedText.length > 100 ? '...' : ''}"*`;

          let originalUseGoogleSearchPref: boolean | undefined;
          try {
            originalUseGoogleSearchPref = getPref(PREF_USE_GOOGLE_SEARCH) as boolean;
            setPref(PREF_USE_GOOGLE_SEARCH, true); // Force Google Search for this query

            if (addon.data.handleActionFromSelection) {
              await addon.data.handleActionFromSelection(fullPrompt, summaryText);
            } else {
              Zotero.debug(
                `[${config.addonName}] handleActionFromSelection function not found.`,
              );
            }
          } finally {
            // Restore original preference
            if (originalUseGoogleSearchPref !== undefined) {
              setPref(PREF_USE_GOOGLE_SEARCH, originalUseGoogleSearchPref);
            }
          }
        },
      },
      {
        type: "mouseover",
        listener: (e: MouseEvent) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#357ae8";
        }
      },
      {
        type: "mouseout",
        listener: (e: MouseEvent) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#4285f4";
        }
      }
    ],
  });

  append(button);
}
