export function dispatchRequestStatusChangedEvent(
  paneId: string,
  isRequestInProgress: boolean,
): void {
  const event = new (Zotero.getMainWindow() as any).CustomEvent(
    "ask-my-paper-request-status-changed",
    {
      bubbles: true,
      cancelable: true,
      detail: { paneId, isRequestInProgress },
    },
  );
  Zotero.getMainWindow().document.dispatchEvent(event);
}
