import { expect } from "chai";
import { isPdfUploadStale } from "../src/modules/reader/pdfSyncManager";

describe("PDF upload staleness", function () {
  it("requires re-upload when a previously tracked local PDF changes", function () {
    expect(isPdfUploadStale(100, 200)).to.equal(true);
  });

  it("does not re-upload when the local PDF timestamp is unchanged or unavailable", function () {
    expect(isPdfUploadStale(100, 100)).to.equal(false);
    expect(isPdfUploadStale(undefined, 100)).to.equal(false);
    expect(isPdfUploadStale(100, undefined)).to.equal(false);
  });
});
