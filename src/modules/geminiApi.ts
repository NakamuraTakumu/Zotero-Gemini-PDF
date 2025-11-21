import {
  GoogleGenAI,
  Content,
  Part,
  File as GeminiFile,
  GenerateContentResponse,
} from "@google/genai";
import { getPref } from "../utils/prefs";

let ai: GoogleGenAI | null = null;

export function initGeminiModel(apiKey?: string): void {
  const key =
    apiKey ||
    (getPref(
      "geminiApiKey" as keyof _ZoteroTypes.Prefs["PluginPrefsMap"],
    ) as string);
  if (typeof key !== "string" || !key) {
    Zotero.logError(
      new Error(
        "Gemini API Key is not a valid string or is not set. Cannot initialize Gemini model.",
      ),
    );
    ai = null;
    return;
  }

  ai = new GoogleGenAI({ apiKey: key });
  Zotero.log("GoogleGenAI client initialized.");
}

/**
 * Uploads a file to the Gemini API using a temporary file path.
 */
/**
 * Uploads a file to the Gemini API using a temporary file path.
 */
export async function uploadFile(
  filePath: string,
  displayName: string,
): Promise<GeminiFile> {
  if (!ai) {
    initGeminiModel();
    if (!ai) {
      throw new Error("Gemini API not initialized.");
    }
  }

  const tempFileName = `${Zotero.Utilities.randomString()}-${displayName}.pdf`; // Added .pdf extension
  const tempDir = Zotero.getTempDirectory();
  tempDir.append(tempFileName);
  const tempFilePath = tempDir.path;

  try {
    Zotero.log(`[Gemini] Starting upload for: ${displayName} from path: ${filePath}`); // Changed to Zotero.log
    const zoteroFile = Zotero.File.pathToFile(filePath);
    await zoteroFile.copyTo(Zotero.getTempDirectory(), tempFileName);
    Zotero.log(`[Gemini] Copied file to temporary path: ${tempFilePath}`); // Changed to Zotero.log

    // Use a different variable name for the temporary nsIFile object to avoid redeclaration
    const tempNsIFile = Zotero.File.pathToFile(tempFilePath); 
    if (!tempNsIFile.exists()) {
      Zotero.logError(new Error(`Temp file does not exist: ${tempFilePath}`));
      throw new Error(`Temp file does not exist: ${tempFilePath}`);
    }

    // Helper function to read binary content using XPCOM streams
    const readBinaryFile = (file: any): Uint8Array => {
      const Cc: any = Components.classes;
      const Ci: any = Components.interfaces;

      const fis = Cc["@mozilla.org/network/file-input-stream;1"]
                            .createInstance(Ci.nsIFileInputStream);
      fis.init(file, -1, -1, 0);

      const bis = Cc["@mozilla.org/binaryinputstream;1"]
                            .createInstance(Ci.nsIBinaryInputStream);
      bis.setInputStream(fis);

      const available = fis.available();
      const rawData = bis.readBytes(available);

      bis.close();
      fis.close();

      const len = rawData.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = rawData.charCodeAt(i);
      }
      return bytes;
    };

    let binaryContent: Uint8Array;
    try {
      binaryContent = readBinaryFile(tempNsIFile);
      Zotero.log(`[Gemini] Read file using nsIFileInputStream. Length: ${binaryContent.length}`);
    } catch (e: any) {
      Zotero.logError(new Error(`Failed to read binary file with nsIFileInputStream: ${e.message || String(e)}`));
      throw e;
    }
    
    // Log file content details before creating Blob
    Zotero.log(`[Gemini] Using content for Blob. Type: ${binaryContent.constructor.name}, Length: ${binaryContent.length}`); 

    const pdfBlob = new Blob([binaryContent], { type: "application/pdf" });
    Zotero.log(`[Gemini] Created PDF Blob. Size: ${pdfBlob.size}, Type: ${pdfBlob.type}`); // Changed to Zotero.log

    Zotero.logError(new Error(`Error uploading file ${displayName}: ${error.message || String(error)}`));
    throw error;
  } finally {
    try {
      const tempFile = Zotero.File.pathToFile(tempFilePath);
      if (tempFile.exists()) {
        tempFile.remove(false);
        Zotero.log(`Removed temporary file: ${tempFilePath}`); // Changed to Zotero.log
      }
    } catch (cleanupError: any) {
      Zotero.logError(
        new Error(`Failed to clean up temporary file ${tempFilePath}: ${cleanupError.message || String(cleanupError)}`),
      );
    }
  }
} // Correctly closes the uploadFile function

/**
 * Checks if a file exists on the Gemini server by trying to get its metadata.
 */
export async function getFileMetadata(
  fileName: string,
): Promise<GeminiFile | null> {
  if (!ai) {
    initGeminiModel();
    if (!ai) {
      throw new Error("Gemini API not initialized.");
    }
  }
  try {
    const file = await ai.files.get({ name: fileName });
    Zotero.log(`File metadata found for ${fileName}`); // Changed to Zotero.log
    return file;
  } catch (error: any) {
    Zotero.log(`File not found or expired for ${fileName}. Error: ${error.message || String(error)}`); // Changed to Zotero.log
    return null;
  }
}

/**
 * Sends a message to the Gemini model and returns the generated content.
 */
export async function sendMessageToGemini(
  history: Content[],
  userParts: Part[],
): Promise<string | null> {
  const selectedModel = getPref("geminiSelectedModel") as string;
  Zotero.debug(`[Gemini PDF] API: Using model from getPref: ${selectedModel}`);
  if (!ai) {
    initGeminiModel();
    if (!ai) {
      return "Error: Gemini model not initialized. Please set your API key in preferences.";
    }
  }

  try {
    const fullConversation: Content[] = [
      ...history,
      { role: "user", parts: userParts },
    ];

    const systemInstructionText = getPref("geminiSystemPrompt" as keyof _ZoteroTypes.Prefs["PluginPrefsMap"]) as string | undefined;

    const request: any = {
        model: selectedModel,
        contents: fullConversation,
    };

    if (systemInstructionText) {
        request.systemInstruction = { parts: [{ text: systemInstructionText }] };
    }

    const result: GenerateContentResponse = await ai.models.generateContent(request);
    
    Zotero.log(`[Gemini] Full API Response: ${JSON.stringify(result, null, 2)}`); // Reverted to Zotero.log

    let responseText: string | null = null;
    if (result.candidates && result.candidates.length > 0) {
      const candidate = result.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0 && candidate.content.parts[0].text) {
        responseText = candidate.content.parts[0].text;
      }
    }

    if (typeof responseText !== 'string' || responseText === null) {
        let errorReason = "Unknown error.";
        if (result.promptFeedback?.blockReason) {
            errorReason = `Prompt was blocked. Reason: ${result.promptFeedback.blockReason}.`;
        } else if (result.candidates?.[0]?.finishReason && result.candidates[0].finishReason !== 'STOP') {
            errorReason = `Response was stopped. Reason: ${result.candidates[0].finishReason}.`;
        } else {
            errorReason = "The model returned an empty response or a response in an unexpected format.";
        }

        Zotero.logError(new Error(`No text part found in Gemini response. ${errorReason}`)); // Reverted to Zotero.logError
        return `Error: Did not receive a valid response from Gemini. ${errorReason}`;
    }
    Zotero.log(`[Gemini] Raw response from API: ${responseText}`); // Reverted to Zotero.log
    return responseText;
  } catch (error: any) {
    Zotero.logError(
      new Error(`Error sending message to Gemini: ${error.message || String(error)}`), // Reverted to Zotero.logError
    );
    return `Error: Could not get response from Gemini. ${error.message || String(error)}`;
  }
}
