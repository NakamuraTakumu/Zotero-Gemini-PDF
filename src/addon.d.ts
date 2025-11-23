declare const config: {
    addonName: string;
    addonID: string;
    addonRef: string;
    addonInstance: string;
    prefsPrefix: string;
};
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
declare class Addon {
    data: {
        alive: boolean;
        config: typeof config;
        env: "development" | "production";
        initialized?: boolean;
        ztoolkit: ZToolkit;
        locale?: {
            current: any;
        };
        prefs?: {
            window: Window;
            columns: Array<ColumnOptions>;
            rows: Array<{
                [dataKey: string]: string;
            }>;
        };
        dialog?: DialogHelper;
        lastSelectedText?: string;
        chatPanes: {
            [paneId: string]: {
                chatManager?: import("./modules/reader/chat").ChatManager;
                uiManager?: import("./modules/reader/ui").UIManager;
                paneId: string;
                itemId?: number;
                eventHandler?: (event: CustomEvent) => void;
                actualParentItem?: Zotero.Item | null;
                currentConversation?: import("./types/chat").Conversation | null;
                isGeminiRequestInProgress?: boolean;
            };
        };
    };
    hooks: typeof hooks;
    api: object;
    constructor();
}
export default Addon;
