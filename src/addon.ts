import packageJson from "../package.json";
const config = packageJson.config;
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { ChatManager } from "./modules/reader/chat";
import { UIManager } from "./modules/reader/ui";
import { ChatSessionHistory, ParentItemFileMetadata } from "./types/chat";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
    };
    dialog?: DialogHelper;
    lastSelectedText?: string;
    chatPanes: {
      [paneId: string]: {
        chatManager?: ChatManager;
        uiManager?: UIManager;
        paneId: string;
        itemId?: number; // Add itemId
        eventHandler?: (event: CustomEvent) => void;
        actualParentItem?: Zotero.Item | null;
        currentConversation?: ChatSessionHistory | null;
        parentItemFileMetadata?: ParentItemFileMetadata | null;
        isGeminiRequestInProgress?: boolean; // Per-pane request state
        doc?: Document; // Add doc property
        body?: HTMLElement; // Add body property
      };
    };
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      chatPanes: {},
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
