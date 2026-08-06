import { expect } from "chai";
import { ChatSessionManager } from "../src/modules/reader/chatSessionManager";
import { ChatSessionRepository } from "../src/modules/reader/chatSessionRepository";
import { ParentItemDataRepository } from "../src/modules/reader/parentItemDataRepository";

type StoredData = {
  zoteroParentItemKey: string;
  files: Array<{
    zoteroAttachmentKey: string;
    fileName: string;
    lastModified?: number;
    uploads: unknown[];
  }>;
  chatSessions: Array<{
    schemaVersion: 2;
    metadata: {
      zoteroParentItemKey: string;
      chatId: string;
      chatTitle: string;
      isTitleGenerated: boolean;
      createdTimestamp: string;
      updatedTimestamp: string;
    };
    messages: unknown[];
  }>;
};

function history(parentKey: string, chatId: string) {
  return {
    schemaVersion: 2 as const,
    metadata: {
      zoteroParentItemKey: parentKey,
      chatId,
      chatTitle: chatId,
      isTitleGenerated: false,
      createdTimestamp: "2026-01-01T00:00:00.000Z",
      updatedTimestamp: "2026-01-01T00:00:00.000Z",
    },
    messages: [],
  };
}

function installZoteroStore(initial: Record<string, StoredData>) {
  const contents = new Map(
    Object.entries(initial).map(([key, data]) => [
      `${key}.json`,
      JSON.stringify(data),
    ]),
  );
  (globalThis as any).Zotero = {
    Attachments: { LINK_MODE_IMPORTED_FILE: 1 },
    File: {
      getContentsAsync: async (path: string) => contents.get(path) || "",
      putContentsAsync: async (path: string, content: string) => {
        contents.set(path, content);
      },
    },
    Items: {
      get: async (ids: string[]) =>
        ids.map((key) => ({
          key,
          itemType: "attachment",
          attachmentLinkMode: 1,
          getField: () => `Ask My Paper Data - ${key.replace("-data", "")}`,
          getFilePath: () => `${key.replace("-data", "")}.json`,
        })),
    },
    debug: () => undefined,
    log: () => undefined,
    logError: () => undefined,
  };
  return contents;
}

function parentItem(key: string) {
  return {
    key,
    getAttachments: () => [`${key}-data`],
  } as any;
}

describe("reader persistence and session state", function () {
  describe("parent-item aggregate persistence", function () {
    it("preserves independent concurrent session and file updates", async function () {
      const item = parentItem("PARENT");
      const contents = installZoteroStore({
        PARENT: { zoteroParentItemKey: "PARENT", files: [], chatSessions: [] },
      });
      const sessionRepository = new ChatSessionRepository();
      const dataRepository = new ParentItemDataRepository();

      const fileUpdate = dataRepository.update(item, async (data) => {
        await Promise.resolve();
        data.files.push({
          zoteroAttachmentKey: "PDF",
          fileName: "paper.pdf",
          uploads: [],
        });
      });
      const sessionUpdate = sessionRepository.saveSession(
        item,
        history("PARENT", "chat-1") as any,
      );

      await Promise.all([fileUpdate, sessionUpdate]);

      const saved = JSON.parse(contents.get("PARENT.json")!) as StoredData;
      expect(saved.files.map((file) => file.zoteroAttachmentKey)).to.deep.equal(
        ["PDF"],
      );
      expect(
        saved.chatSessions.map((session) => session.metadata.chatId),
      ).to.deep.equal(["chat-1"]);
    });

    it("merges legacy load-save callers against the latest aggregate snapshot", async function () {
      const item = parentItem("PARENT");
      const contents = installZoteroStore({
        PARENT: { zoteroParentItemKey: "PARENT", files: [], chatSessions: [] },
      });
      const firstRepository = new ParentItemDataRepository();
      const secondRepository = new ParentItemDataRepository();
      const [fileData, sessionData] = await Promise.all([
        firstRepository.load(item),
        secondRepository.load(item),
      ]);

      fileData.files.push({
        zoteroAttachmentKey: "PDF",
        fileName: "paper.pdf",
        uploads: [],
      });
      sessionData.chatSessions.push(history("PARENT", "chat-1") as any);
      await Promise.all([
        firstRepository.save(item, fileData),
        secondRepository.save(item, sessionData),
      ]);

      const saved = JSON.parse(contents.get("PARENT.json")!) as StoredData;
      expect(saved.files).to.have.length(1);
      expect(saved.chatSessions).to.have.length(1);
    });

    it("preserves concurrent upload references for different providers", async function () {
      const item = parentItem("PARENT");
      const contents = installZoteroStore({
        PARENT: {
          zoteroParentItemKey: "PARENT",
          files: [
            {
              zoteroAttachmentKey: "PDF",
              fileName: "paper.pdf",
              uploads: [],
            },
          ],
          chatSessions: [],
        },
      });
      const firstRepository = new ParentItemDataRepository();
      const secondRepository = new ParentItemDataRepository();
      const [geminiData, openAiData] = await Promise.all([
        firstRepository.load(item),
        secondRepository.load(item),
      ]);

      geminiData.files[0].uploads.push({
        provider: "gemini",
        fileUri: "gemini-file",
        uploadedAt: "2026-01-01T00:00:00.000Z",
      });
      openAiData.files[0].uploads.push({
        provider: "openai",
        fileId: "openai-file",
        uploadedAt: "2026-01-01T00:00:00.000Z",
      });
      await Promise.all([
        firstRepository.save(item, geminiData),
        secondRepository.save(item, openAiData),
      ]);

      const saved = JSON.parse(contents.get("PARENT.json")!) as StoredData;
      expect(
        (saved.files[0].uploads as Array<{ provider: string }>).map(
          (upload) => upload.provider,
        ),
      ).to.have.members(["gemini", "openai"]);
    });

    it("does not serialize updates for different parent items", async function () {
      const firstItem = parentItem("FIRST");
      const secondItem = parentItem("SECOND");
      installZoteroStore({
        FIRST: { zoteroParentItemKey: "FIRST", files: [], chatSessions: [] },
        SECOND: { zoteroParentItemKey: "SECOND", files: [], chatSessions: [] },
      });
      const repository = new ParentItemDataRepository();
      let releaseFirst!: () => void;
      const firstIsRunning = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let secondCompleted = false;

      const firstUpdate = repository.update(firstItem, async () => {
        await firstIsRunning;
      });
      const secondUpdate = repository.update(secondItem, () => {
        secondCompleted = true;
      });

      await secondUpdate;
      expect(secondCompleted).to.equal(true);
      releaseFirst();
      await firstUpdate;
    });
  });

  describe("active session deletion", function () {
    it("keeps the selected remaining session as the manager's active session", async function () {
      (globalThis as any).Zotero = {
        debug: () => undefined,
        log: () => undefined,
        logError: () => undefined,
      };
      const item = parentItem("PARENT");
      const sessions = [
        { id: "older", title: "older", history: history("PARENT", "older") },
        { id: "active", title: "active", history: history("PARENT", "active") },
      ] as any[];
      sessions[1].history.metadata.createdTimestamp =
        "2026-01-02T00:00:00.000Z";
      const listeners = new Map<string, Function[]>();
      const globalChatManager = {
        loadSessionsForItem: async () => sessions,
        getAllSessions: () => sessions,
        on: (event: string, listener: Function) => {
          listeners.set(event, [...(listeners.get(event) || []), listener]);
        },
        off: () => undefined,
        deleteSession: async (session: { id: string }) => {
          sessions.splice(
            sessions.findIndex((candidate) => candidate.id === session.id),
            1,
          );
          for (const listener of listeners.get("session-deleted") || []) {
            listener({ itemKey: "PARENT", sessionId: session.id });
          }
        },
      } as any;
      const manager = new ChatSessionManager(item, globalChatManager, {
        rerenderChatMessages: () => undefined,
        rerenderSwitcher: () => undefined,
      });

      await manager.init();
      expect(manager.getActiveSession()?.id).to.equal("active");
      expect(await manager.deleteActiveSession()).to.equal(true);
      expect(manager.getActiveSession()?.id).to.equal("older");
    });
  });
});
