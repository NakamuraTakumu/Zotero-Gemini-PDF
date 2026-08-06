import { expect } from "chai";
import {
  filterRequestPdfMetadata,
  SendMessageUseCase,
} from "../src/modules/reader/sendMessageUseCase";
import { ChatPane } from "../src/modules/reader/chatPane";

describe("send-message PDF request metadata", function () {
  it("passes only current PDF attachments from the active parent item", async function () {
    const currentPdf = {
      key: "CURRENT_PDF",
      libraryID: 1,
      attachmentContentType: "application/pdf",
      attachmentPath: "/tmp/current.pdf",
    };
    const nonPdfAttachment = {
      key: "NOTE",
      libraryID: 1,
      attachmentContentType: "text/plain",
      attachmentPath: "/tmp/note.txt",
    };
    (globalThis as any).Zotero = {
      Items: {
        getAsync: async (ids: number[]) => {
          expect(ids).to.deep.equal([101, 102]);
          return [currentPdf, nonPdfAttachment];
        },
      },
    };

    const metadata = {
      zoteroParentItemKey: "PARENT",
      chatSessions: [],
      files: [
        {
          libraryID: 1,
          zoteroAttachmentKey: "CURRENT_PDF",
          fileName: "current.pdf",
          uploads: [],
        },
        {
          libraryID: 1,
          zoteroAttachmentKey: "DELETED_PDF",
          fileName: "deleted.pdf",
          uploads: [],
        },
        {
          libraryID: 1,
          zoteroAttachmentKey: "NOTE",
          fileName: "note.txt",
          uploads: [],
        },
        {
          libraryID: 2,
          zoteroAttachmentKey: "CURRENT_PDF",
          fileName: "other-library.pdf",
          uploads: [],
        },
        {
          zoteroAttachmentKey: "CURRENT_PDF",
          fileName: "legacy-without-library.pdf",
          uploads: [],
        },
      ],
    };

    const filtered = await filterRequestPdfMetadata(
      { getAttachments: () => [101, 102] } as any,
      metadata,
    );

    expect(filtered).to.not.equal(metadata);
    expect(filtered.files).to.deep.equal([metadata.files[0]]);
    expect(metadata.files).to.have.length(5);
  });

  function installMinimalZotero() {
    (globalThis as any).Zotero = {
      Items: { getAsync: async () => [] },
      log: () => undefined,
      debug: () => undefined,
      logError: () => undefined,
    };
  }

  function useCaseFixture() {
    installMinimalZotero();
    const parentItem = { key: "PARENT", getAttachments: () => [] } as any;
    const metadata = {
      zoteroParentItemKey: "PARENT",
      chatSessions: [],
      files: [],
    } as any;
    let activeSession: any;
    const sessionA = {
      id: "session-a",
      addUserMessage: () => undefined,
      save: async () => undefined,
      sendMessage: async () => ({
        responseText: "response",
        provider: "gemini",
        model: "flash",
      }),
    };
    const sessionB = { id: "session-b" };
    activeSession = sessionA;
    const ui = {
      addUserMessage: () => undefined,
      addBotMessage: () => ({}) as any,
      updateBotMessage: () => undefined,
      setInputsDisabled: () => undefined,
    };
    const deps = {
      paneId: "pane",
      getParentItem: () => parentItem,
      getIsRequestInProgress: () => false,
      setIsRequestInProgress: () => undefined,
      dispatchRequestStatusChanged: () => undefined,
      uiManager: ui,
      chatSessionManager: { getActiveSession: () => activeSession },
      pdfFileSyncManager: {
        ensurePdfContext: async () => metadata,
      },
    } as any;
    return {
      deps,
      ui,
      metadata,
      sessionA,
      sessionB,
      setActive: (s: any) => (activeSession = s),
    };
  }

  describe("send-message session-origin routing", function () {
    it("saves the originating session response once and skips UI response updates after switching", async function () {
      const fixture = useCaseFixture();
      let release!: () => void;
      let started!: () => void;
      const startedPromise = new Promise<void>(
        (resolve) => (started = resolve),
      );
      const pending = new Promise<void>((resolve) => (release = resolve));
      let saveCount = 0;
      let updateCount = 0;
      fixture.sessionA.save = async () => {
        saveCount += 1;
      };
      fixture.sessionA.sendMessage = async () => {
        started();
        await pending;
        return { responseText: "response", provider: "gemini", model: "flash" };
      };
      fixture.ui.updateBotMessage = () => {
        updateCount += 1;
      };

      const request = new SendMessageUseCase(fixture.deps).execute(
        "hello",
        "hello",
      );
      await startedPromise;
      fixture.setActive(fixture.sessionB);
      release();
      await request;

      expect(saveCount).to.equal(2);
      expect(updateCount).to.equal(0);
    });

    it("keeps UI response updates when the originating session remains active", async function () {
      const fixture = useCaseFixture();
      let addBotCount = 0;
      let updateCount = 0;
      fixture.ui.addBotMessage = () => {
        addBotCount += 1;
        return {} as any;
      };
      fixture.ui.updateBotMessage = () => {
        updateCount += 1;
      };

      await new SendMessageUseCase(fixture.deps).execute("hello", "hello");

      expect(addBotCount).to.equal(1);
      expect(updateCount).to.equal(1);
    });

    it("allows session switching during a request while retaining new/delete locks", function () {
      const invoke = (id: string) => {
        let prevented = false;
        let stopped = false;
        const event = {
          target: { closest: () => ({ id }) },
          preventDefault: () => (prevented = true),
          stopImmediatePropagation: () => (stopped = true),
        } as any;
        (ChatPane.prototype as any)._handleSessionControlInteraction.call(
          { runtimeState: { isLlmRequestInProgress: true } },
          event,
        );
        return { prevented, stopped };
      };

      expect(invoke("chat-session-switcher")).to.deep.equal({
        prevented: false,
        stopped: false,
      });
      expect(invoke("new-chat-button")).to.deep.equal({
        prevented: true,
        stopped: true,
      });
      expect(invoke("delete-session-button")).to.deep.equal({
        prevented: true,
        stopped: true,
      });
    });
  });
});
