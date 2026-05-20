export function readBinaryFile(filePath: string): Uint8Array {
  const Cc: any = Components.classes;
  const Ci: any = Components.interfaces;
  const file = Zotero.File.pathToFile(filePath);

  const fis = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
    Ci.nsIFileInputStream,
  );
  fis.init(file, -1, -1, 0);

  const bis = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
    Ci.nsIBinaryInputStream,
  );
  bis.setInputStream(fis);

  try {
    const available = fis.available();
    const rawData = bis.readBytes(available);
    const bytes = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      bytes[i] = rawData.charCodeAt(i);
    }
    return bytes;
  } finally {
    bis.close();
    fis.close();
  }
}

export function createPdfFile(bytes: Uint8Array, fileName: string): File {
  return new File([bytes], ensurePdfFilename(fileName), {
    type: "application/pdf",
  });
}

export function ensurePdfFilename(fileName: string): string {
  return fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
}
