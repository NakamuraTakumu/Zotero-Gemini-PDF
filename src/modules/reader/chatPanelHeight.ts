export const MIN_CHAT_PANEL_HEIGHT = 50;

export function getSavedChatPanelHeight(value: unknown): number | undefined {
  const height = Number(value);
  return Number.isFinite(height) && height > 0 ? Math.round(height) : undefined;
}

export function getChatPanelHeightMaximum(
  containerMaximum: number,
  viewportMaximum: number,
): number | undefined {
  const candidates = [containerMaximum, viewportMaximum].filter(
    (height) => Number.isFinite(height) && height > 0,
  );
  if (candidates.length === 0) {
    return undefined;
  }
  // The chat container can grow within the reader pane, so its current flex
  // allocation can be smaller than a valid user-selected chat height.
  return Math.max(MIN_CHAT_PANEL_HEIGHT, Math.floor(Math.max(...candidates)));
}

export function clampChatPanelHeight(
  requestedHeight: number,
  maximumHeight?: number,
): number {
  const normalizedHeight = Math.max(
    MIN_CHAT_PANEL_HEIGHT,
    Math.round(Number.isFinite(requestedHeight) ? requestedHeight : 0),
  );
  if (maximumHeight === undefined || !Number.isFinite(maximumHeight)) {
    return normalizedHeight;
  }
  return Math.min(
    normalizedHeight,
    Math.max(MIN_CHAT_PANEL_HEIGHT, Math.floor(maximumHeight)),
  );
}
