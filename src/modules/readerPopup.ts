// gemini-pdf/src/modules/readerPopup.ts
import { createZToolkit } from "../utils/ztoolkit";

export function buildReaderPopup(
  event: _ZoteroTypes.Reader.EventParams<"renderTextSelectionPopup">,
) {
  const { doc, append } = event;
  const ztoolkit = createZToolkit();

  const button = ztoolkit.UI.createElement(doc, "button", {
    namespace: "html",
    id: "gemini-pdf-popup-button",
    classList: ["toolbar-button"],
    properties: {
      innerHTML: "Gemini", // Or some icon
    },
    listeners: [
      {
        type: "click",
        listener: (e: Event) => {
          e.stopPropagation();
          const chatPane = addon.data.chatPane;
          if (chatPane) {
            const chatInput = chatPane.querySelector(
              "#chat-input",
            ) as HTMLTextAreaElement;
            if (chatInput) {
              chatInput.value = addon.data.lastSelectedText || "";
              chatInput.focus();
            } else {
              Zotero.debug(
                "Gemini PDF: Could not find #chat-input in the stored chat pane.",
              );
            }
          } else {
            Zotero.debug("Gemini PDF: Could not find the stored chat pane.");
          }
        },
      },
    ],
  });

  append(button);
}
