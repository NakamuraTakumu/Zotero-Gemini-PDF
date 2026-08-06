import { expect } from "chai";
import { SendMessageUseCase } from "../src/modules/reader/sendMessageUseCase";

describe("chat message waiting placeholder lifecycle", function () {
  it("creates the waiting placeholder with a dedicated typing class", async function () {
    (globalThis as any).Zotero = {
      Items: { getAsync: async () => [] },
      log: () => undefined,
      debug: () => undefined,
      logError: () => undefined,
    };
    const calls: any[] = [];
    const deps: any = {
      paneId: "pane",
      getParentItem: () => ({ key: "PARENT", getAttachments: () => [] }),
      getIsRequestInProgress: () => false,
      setIsRequestInProgress: () => undefined,
      dispatchRequestStatusChanged: () => undefined,
      uiManager: {
        addUserMessage: () => undefined,
        addBotMessage: (...args: any[]) => {
          calls.push(args);
          return {};
        },
        updateBotMessage: () => undefined,
        setInputsDisabled: () => undefined,
      },
      chatSessionManager: {
        getActiveSession: () => ({
          id: "session",
          addUserMessage: () => undefined,
          save: async () => undefined,
          sendMessage: async () => ({ responseText: "ok" }),
        }),
      },
      pdfFileSyncManager: { ensurePdfContext: async () => ({ files: [] }) },
    };

    await new SendMessageUseCase(deps).execute("hello", "hello");

    expect(calls[0]).to.deep.equal(["Typing...", "bot-message typing-message"]);
  });
});
