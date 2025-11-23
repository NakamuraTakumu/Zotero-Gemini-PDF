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
          let actualParentItemId: number | undefined; // Declare actualParentItemId here

          // Check if a request is already in progress for this item
          const currentPaneId = Object.keys(addon.data.chatPanes).find(
            (id) => addon.data.chatPanes[id].itemId === actualParentItemId
          );
          if (currentPaneId && addon.data.chatPanes[currentPaneId]?.isGeminiRequestInProgress) {
            Zotero.debug(`[Gemini PDF] Request already in progress for item ${actualParentItemId}. Skipping.`);
            return;
          }

          const selectedText = addon.data.lastSelectedText || "";
          if (!selectedText) {
            Zotero.debug(`[${config.addonName}] No selected text found.`);
            return;
          }

          // Disable the button and indicate loading
          const targetButton = e.currentTarget as HTMLButtonElement;
          const originalButtonText = targetButton.innerHTML;
          targetButton.disabled = true;
          targetButton.innerHTML = `思考中...`; // Indicate loading state
          const promptTemplate = getPref(PREF_PROMPT_FOR_SELECTION) || "";
          const fullPrompt = promptTemplate.replace("{selectedText}", selectedText);
          const summaryText = `*Regarding the question: "${selectedText.substring(0, 100)}${selectedText.length > 100 ? '...' : ''}"*`;

          // Determine the actual parent item's ID
          const currentItem = (event.reader as any)._item;

          if (currentItem && currentItem.isAttachment() && currentItem.parentID) {
            const parentItem = await Zotero.Items.getAsync(currentItem.parentID);
            actualParentItemId = parentItem?.id;
          } else if (currentItem) {
            actualParentItemId = currentItem.id;
          }

          if (!actualParentItemId) {
              Zotero.logError(new Error(`[${config.addonName}] Could not determine actualParentItemId for selected text action.`));
              return;
          }

          Zotero.log(`[Gemini PDF] Dispatching gemini-pdf-action for itemId: ${actualParentItemId}`);
          // Dispatch a custom event instead of calling a global function
          const actionEvent = new (Zotero.getMainWindow() as any).CustomEvent('gemini-pdf-action', {
            bubbles: true,
            cancelable: true,
            detail: {
              itemId: actualParentItemId,
              fullPrompt,
              summaryText,
              popupTriggerButton: targetButton, // Pass the button reference
              originalButtonText: originalButtonText, // Pass original text
            }
          });
          Zotero.getMainWindow().document.dispatchEvent(actionEvent);
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
