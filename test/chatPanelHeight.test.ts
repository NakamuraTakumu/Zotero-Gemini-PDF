import { expect } from "chai";
import {
  clampChatPanelHeight,
  getChatPanelHeightMaximum,
  getSavedChatPanelHeight,
  MIN_CHAT_PANEL_HEIGHT,
} from "../src/modules/reader/chatPanelHeight";

describe("chat panel height", function () {
  it("uses valid persisted values and rejects absent or invalid values", function () {
    expect(getSavedChatPanelHeight(318.4)).to.equal(318);
    expect(getSavedChatPanelHeight(undefined)).to.equal(undefined);
    expect(getSavedChatPanelHeight(0)).to.equal(undefined);
    expect(getSavedChatPanelHeight("invalid")).to.equal(undefined);
  });

  it("enforces the minimum and the largest usable container or viewport bound", function () {
    expect(clampChatPanelHeight(12, 400)).to.equal(MIN_CHAT_PANEL_HEIGHT);
    expect(getChatPanelHeightMaximum(420, 280)).to.equal(420);
    expect(
      clampChatPanelHeight(500, getChatPanelHeightMaximum(420, 280)),
    ).to.equal(420);
  });

  it("keeps a saved height until layout geometry is available", function () {
    expect(getChatPanelHeightMaximum(-1, Number.NaN)).to.equal(undefined);
    expect(getChatPanelHeightMaximum(0, 0)).to.equal(undefined);
    expect(clampChatPanelHeight(300, undefined)).to.equal(300);
  });
});
