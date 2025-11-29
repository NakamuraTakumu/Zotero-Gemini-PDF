export declare class ReaderItemPaneFactory {
  static getOrCreateChatLogAttachment(
    parentItem: Zotero.Item,
  ): Promise<Zotero.Item>;
  static registerReaderItemPaneSection(): Promise<void>;
  static registerChatStyleSheet(win: _ZoteroTypes.MainWindow): void;
}
