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
export async function uploadFile(
  filePath: string,
  displayName: string,
): Promise<GeminiFile> {
  throw new Error("PDF Upload functionality is currently disabled for debugging.");
}

/**
 * Checks if a file exists on the Gemini server by trying to get its metadata.
 */
export async function getFileMetadata(
  fileName: string,
): Promise<GeminiFile | null> {
  throw new Error("Get file metadata functionality is currently disabled for debugging.");
}

/**
 * Sends a message to the Gemini model and returns the generated content.
 */
export async function sendMessageToGemini(
  history: Content[],
  userParts: Part[],
): Promise<string | null> {
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

    let conversationForApi: Content[] = fullConversation;
    // Add system prompt priming turn only if history is empty and a system prompt is set
    if (systemInstructionText && history.length === 0) {
        conversationForApi = [
            { role: "user", parts: [{ text: systemInstructionText }] },
            { role: "model", parts: [{ text: "Understood." }] },
            ...fullConversation
        ];
    }

    const result: GenerateContentResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: conversationForApi,
    });
    
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
