// gemini-pdf/src/modules/readerPopup.ts
import { createZToolkit } from "../utils/ztoolkit";
import { getPref, setPref } from "../utils/prefs";
import { config } from "../../package.json";
import { GEMINI_ICON } from "../utils/icon"; // Import GEMINI_ICON
import { PREF_PROMPT_FOR_SELECTION, PREF_USE_GOOGLE_SEARCH } from "../utils/constants";

export function buildReaderPopup(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
) {
  const { doc, append, reader } = event; // Destructure reader from event
  const window = doc.defaultView as any; // Get the window object from the document
  const ztoolkit = createZToolkit();

  // Determine the actual parent item's ID for this reader instance
  let actualParentItemId: number | undefined;
  const currentReaderItem = (reader as any)._item;
  if (currentReaderItem && currentReaderItem.isAttachment() && currentReaderItem.parentID) {
    actualParentItemId = currentReaderItem.parentID;
  } else if (currentReaderItem) {
    actualParentItemId = currentReaderItem.id;
  }

  // Get initial request state for this item's pane
  let initialRequestInProgress = false;
  let currentPaneId: string | undefined;
  if (actualParentItemId) {
    currentPaneId = Object.keys(addon.data.chatPanes).find(
      (id) => addon.data.chatPanes[id].zoteroContext.itemId === actualParentItemId
    );
    if (currentPaneId && addon.data.chatPanes[currentPaneId]?.runtimeState.isGeminiRequestInProgress) {
      initialRequestInProgress = true;
    }
  }

  const button = ztoolkit.UI.createElement(doc, "button", {
    namespace: "html",
    id: "gemini-pdf-popup-button",
    properties: {
      innerHTML: `${GEMINI_ICON}Geminiに聞く`,
      disabled: initialRequestInProgress, // Set initial disabled state
    },
    styles: {
      backgroundColor: initialRequestInProgress ? "#b0b0b0" : "#4285f4", // Initial background color
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
        listener: async (e: Event) => {
          e.stopPropagation();

          // Check if a request is already in progress for this item again
          const currentPaneIdCheck = Object.keys(addon.data.chatPanes).find(
            (id) => addon.data.chatPanes[id].zoteroContext.itemId === actualParentItemId
          );
          if (currentPaneIdCheck && addon.data.chatPanes[currentPaneIdCheck]?.runtimeState.isGeminiRequestInProgress) {
            Zotero.debug(`[Gemini PDF] Request already in progress for item ${actualParentItemId}. Skipping.`);
            return;
          }

          const selectedText = addon.data.lastSelectedText || "";
          if (!selectedText) {
            Zotero.debug(`[${config.addonName}] No selected text found.`);
            return;
          }

          const targetButton = e.currentTarget as HTMLButtonElement;
          const originalButtonText = targetButton.innerHTML;
          targetButton.disabled = true;
          targetButton.innerHTML = `思考中...`;

          const promptTemplate = getPref(PREF_PROMPT_FOR_SELECTION) || "";
          const fullPrompt = promptTemplate.replace("{selectedText}", selectedText);
          const summaryText = `*Regarding the question: "${selectedText.substring(0, 100)}${selectedText.length > 100 ? '...' : ''}"*`;

          if (!actualParentItemId) {
              Zotero.logError(new Error(`[${config.addonName}] Could not determine actualParentItemId for selected text action.`));
              return;
          }

          Zotero.log(`[Gemini PDF] Dispatching gemini-pdf-action for itemId: ${actualParentItemId}`);
          const actionEvent = new (Zotero.getMainWindow() as any).CustomEvent('gemini-pdf-action', {
            bubbles: true,
            cancelable: true,
            detail: {
              itemId: actualParentItemId,
              fullPrompt,
              summaryText,
              popupTriggerButton: targetButton,
              originalButtonText: originalButtonText,
            }
          });
          Zotero.getMainWindow().document.dispatchEvent(actionEvent);
        },
      },
      {
        type: "mouseover",
        listener: (e: MouseEvent) => {
          const btn = e.currentTarget as HTMLButtonElement;
          if (!btn.disabled) {
            btn.style.backgroundColor = "#357ae8";
          }
        }
      },
      {
        type: "mouseout",
        listener: (e: MouseEvent) => {
            const btn = e.currentTarget as HTMLButtonElement;
            if (!btn.disabled) {
                btn.style.backgroundColor = "#4285f4";
            }
        }
      }
    ],
  });

  // Listener to update button state based on global request status changes
  const requestStatusChangeListener = (e: Event) => {
    const customEvent = e as CustomEvent;
    const { paneId: eventPaneId, isRequestInProgress } = customEvent.detail;

    // Only update if the event is for the current item's pane
    if (currentPaneId && eventPaneId === currentPaneId) {
      if (isRequestInProgress) {
        button.disabled = true;
        button.innerHTML = `思考中...`;
        button.style.backgroundColor = "#b0b0b0"; // Gray out
      } else {
        button.disabled = false;
        button.innerHTML = `${GEMINI_ICON}Geminiに聞く`;
        button.style.backgroundColor = "#4285f4"; // Restore color
      }
    }
  };

  Zotero.getMainWindow().document.addEventListener('gemini-pdf-request-status-changed', requestStatusChangeListener);

  // Note: MutationObserver causes TypeError in some Zotero environments.
  // For now, we will rely on garbage collection for the button element itself
  // and accept potential memory leaks for the listener.
  // A more robust solution would involve Zotero-specific DOM lifecycle events
  // or a different cleanup mechanism if MutationObserver is truly problematic.

  append(button);
}
