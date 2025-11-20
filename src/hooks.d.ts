declare function onStartup(): Promise<void>;
declare function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void>;
declare function onMainWindowUnload(win: Window): Promise<void>;
declare function onShutdown(): void;
declare const _default: {
    onStartup: typeof onStartup;
    onShutdown: typeof onShutdown;
    onMainWindowLoad: typeof onMainWindowLoad;
    onMainWindowUnload: typeof onMainWindowUnload;
};
export default _default;
