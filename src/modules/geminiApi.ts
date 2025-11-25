import {
  GoogleGenAI,
  Content,
  Part,
  File as GeminiFile,
  GenerateContentResponse,
} from "@google/genai";
import { getPref } from "../utils/prefs";
import { PREF_API_KEY, PREF_SELECTED_MODEL, PREF_SYSTEM_PROMPT } from "../utils/constants";

let ai: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (ai) {
    return ai;
  }
  const apiKey = getPref(PREF_API_KEY) as string;
  if (typeof apiKey !== "string" || !apiKey) {
    Zotero.logError(
      new Error(
        "Gemini API Key is not a valid string or is not set. Cannot initialize Gemini model."
      ),
    );
    return null;
  }
  ai = new GoogleGenAI({ apiKey });
  Zotero.log("GoogleGenAI client initialized.");
  return ai;
}

export function initGeminiModel(): void {
  getGeminiClient();
}

/**
 * Uploads a file to the Gemini API using a temporary file path.
 */
export async function uploadFile(
  filePath: string,
  displayName: string,
): Promise<GeminiFile> {
  const client = getGeminiClient();
  if (!client) {
    throw new Error("Gemini API not initialized.");
  }

  const tempFileName = `${Zotero.Utilities.randomString()}-${displayName}.pdf`; // Added .pdf extension
  const tempDir = Zotero.getTempDirectory();
  tempDir.append(tempFileName);
  const tempFilePath = tempDir.path;

  try {
    Zotero.log(`[Gemini] Starting upload for: ${displayName} from path: ${filePath}`);
    const zoteroFile = Zotero.File.pathToFile(filePath);
    await zoteroFile.copyTo(Zotero.getTempDirectory(), tempFileName);
    Zotero.log(`[Gemini] Copied file to temporary path: ${tempFilePath}`);

    const tempNsIFile = Zotero.File.pathToFile(tempFilePath);
    if (!tempNsIFile.exists()) {
      Zotero.logError(new Error(`Temp file does not exist: ${tempFilePath}`));
      throw new Error(`Temp file does not exist: ${tempFilePath}`);
    }

    const readBinaryFile = (file: any): Uint8Array => {
      const Cc: any = Components.classes;
      const Ci: any = Components.interfaces;

      const fis = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      fis.init(file, -1, -1, 0);

      const bis = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
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

    Zotero.log(`[Gemini] Using content for Blob. Type: ${binaryContent.constructor.name}, Length: ${binaryContent.length}`);

    const pdfBlob = new Blob([binaryContent], { type: "application/pdf" });
    Zotero.log(`[Gemini] Created PDF Blob. Size: ${pdfBlob.size}, Type: ${pdfBlob.type}`);

    const uploadedFile = await client.files.upload({
      file: pdfBlob,
      config: {
        mimeType: "application/pdf",
        displayName: displayName,
      },
    });
    Zotero.log(`[Gemini] File uploaded: ${uploadedFile.name}`);
    return uploadedFile;

  } catch (error: any) {
    Zotero.logError(new Error(`Error during file upload process for ${displayName}: ${error.message || String(error)}`));
    throw error;
  } finally {
    try {
      const tempFile = Zotero.File.pathToFile(tempFilePath);
      if (tempFile.exists()) {
        tempFile.remove(false);
        Zotero.log(`Removed temporary file: ${tempFilePath}`);
      }
    } catch (cleanupError: any) {
      Zotero.logError(
        new Error(`Failed to clean up temporary file ${tempFilePath}: ${cleanupError.message || String(cleanupError)}`),
      );
    }
  }
}

/**
 * Checks if a file exists on the Gemini server by trying to get its metadata.
 */
export async function getFileMetadata(
  fileName: string,
): Promise<GeminiFile | null> {
  const client = getGeminiClient();
  if (!client) {
    throw new Error("Gemini API not initialized.");
  }
  try {
    const file = await client.files.get({ name: fileName });
    Zotero.log(`File metadata found for ${fileName}`);
    return file;
  } catch (error: any) {
    Zotero.log(`File not found or expired for ${fileName}. Error: ${error.message || String(error)}`);
    return null;
  }
}

/**
 * Sends a message to the Gemini model and returns the generated content.
 */
export async function sendMessageToGemini(
  history: Content[],
  userParts: Part[],
  tools?: any[],
  modelName?: string,
): Promise<{ responseText: string | null; groundingMetadata?: any }> {
  const selectedModel = modelName || (getPref(PREF_SELECTED_MODEL) as string);
  Zotero.debug(`[Gemini PDF] API: Using model from getPref: ${selectedModel}`);
  const client = getGeminiClient();
  if (!client) {
    return {
      responseText: "Error: Gemini model not initialized. Please set your API key in preferences.",
      groundingMetadata: undefined
    };
  }

  try {
    const fullConversation: Content[] = [
      ...history,
      { role: "user", parts: userParts },
    ];

    const systemInstructionText = getPref(PREF_SYSTEM_PROMPT) as string | undefined;

    const requestBody: any = {
        model: selectedModel,
        contents: fullConversation,
        config: {
            tools: tools,
        },
    };

    if (systemInstructionText) {
        requestBody.config.systemInstruction = systemInstructionText;
    }
    
    Zotero.log(`[Gemini] Full API Request: ${JSON.stringify(requestBody, null, 2)}`);

    const result: GenerateContentResponse = await client.models.generateContent(requestBody);

    Zotero.log(`[Gemini] Full API Response: ${JSON.stringify(result, null, 2)}`);

    let responseText: string | null = null;
    let groundingMetadata: any | undefined = undefined;

    if (result.candidates && result.candidates.length > 0) {
      const candidate = result.candidates[0];

      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        const responsePartTexts: string[] = [];
        for (const part of candidate.content.parts) {
          if (part.text) {
            responsePartTexts.push(part.text);
          } else {
            responsePartTexts.push("（非テキストパートを受信しました）");
          }
        }
        responseText = responsePartTexts.join('\n');
      }

      if (candidate.groundingMetadata) {
        groundingMetadata = candidate.groundingMetadata;
        Zotero.log(`[Gemini] Grounding metadata found: ${JSON.stringify(groundingMetadata)}`);
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

        Zotero.logError(new Error(`No text part found in Gemini response. ${errorReason}`));
        return {
          responseText: `Error: Did not receive a valid response from Gemini. ${errorReason}`,
          groundingMetadata: undefined
        };
    }
    Zotero.log(`[Gemini] Raw response from API: ${responseText}`);
    return { responseText, groundingMetadata };
  } catch (error: any) {
    Zotero.logError(
      new Error(`Error sending message to Gemini: ${error.message || String(error)}`),
    );
    return {
      responseText: `Error: Could not get response from Gemini. ${error.message || String(error)}`,
      groundingMetadata: undefined
    };
  }
}