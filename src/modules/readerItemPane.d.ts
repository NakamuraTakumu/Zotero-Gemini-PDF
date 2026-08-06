import type { ChatPane } from "./reader/chatPane";

export declare class ReaderItemPaneFactory {
  static getChatPanes(): Map<string, ChatPane>;
  static dispatchRequestStatusChangedEvent(
    paneId: string,
    isRequestInProgress: boolean,
  ): void;
  static registerReaderItemPaneSection(): Promise<void>;
  static registerChatStyleSheet(win: _ZoteroTypes.MainWindow): void;
}
