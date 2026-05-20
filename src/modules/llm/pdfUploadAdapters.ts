import { GoogleGenAI, File as GeminiFile } from "@google/genai";
import OpenAI from "openai";
import { ProviderId, ProviderPdfUploadRef } from "../../types/chat";
import { createPdfFile, readBinaryFile } from "./fileUtils";
import { getProviderApiKey } from "./provider";

export interface PdfUploadAdapter {
  readonly provider: ProviderId;
  uploadPdf(
    filePath: string,
    displayName: string,
  ): Promise<ProviderPdfUploadRef>;
  isUploadAvailable(ref: ProviderPdfUploadRef): Promise<boolean>;
}

const geminiClients = new Map<string, GoogleGenAI>();
const openaiClients = new Map<string, OpenAI>();

function requireApiKey(provider: ProviderId): string {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(`${provider} API key is not set.`);
  }
  return apiKey;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = requireApiKey("gemini");
  const cached = geminiClients.get(apiKey);
  if (cached) return cached;
  const client = new GoogleGenAI({ apiKey });
  geminiClients.set(apiKey, client);
  return client;
}

function getOpenAIClient(): OpenAI {
  const apiKey = requireApiKey("openai");
  const cached = openaiClients.get(apiKey);
  if (cached) return cached;
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  openaiClients.set(apiKey, client);
  return client;
}

function isMissingUploadError(error: any): boolean {
  const status = error?.status || error?.statusCode || error?.code;
  if (status === 404 || status === "404") {
    return true;
  }

  const code = String(error?.code || error?.error?.code || "").toLowerCase();
  if (
    code === "not_found" ||
    code === "notfound" ||
    code === "not_found_error"
  ) {
    return true;
  }

  const message = String(error?.message || error).toLowerCase();
  return message.includes("not found") || message.includes("not_found");
}

class GeminiPdfUploadAdapter implements PdfUploadAdapter {
  readonly provider = "gemini" as const;

  async uploadPdf(
    filePath: string,
    displayName: string,
  ): Promise<ProviderPdfUploadRef> {
    const client = getGeminiClient();
    const bytes = readBinaryFile(filePath);
    const pdfBlob = new Blob([bytes], { type: "application/pdf" });
    const uploadedFile: GeminiFile = await client.files.upload({
      file: pdfBlob,
      config: {
        mimeType: "application/pdf",
        displayName,
      },
    });
    if (!uploadedFile.uri) {
      throw new Error("Gemini upload did not return a file URI.");
    }
    return {
      provider: "gemini",
      fileUri: uploadedFile.uri,
      uploadedAt: new Date().toISOString(),
    };
  }

  async isUploadAvailable(ref: ProviderPdfUploadRef): Promise<boolean> {
    if (ref.provider !== "gemini") return false;
    const fileName = ref.fileUri.split("/").pop();
    if (!fileName) return false;
    try {
      await getGeminiClient().files.get({ name: `files/${fileName}` });
      return true;
    } catch (error: any) {
      Zotero.debug(
        `[Gemini PDF] Gemini uploaded PDF is unavailable: ${
          error.message || String(error)
        }`,
      );
      if (isMissingUploadError(error)) {
        return false;
      }
      throw error;
    }
  }
}

class OpenAIPdfUploadAdapter implements PdfUploadAdapter {
  readonly provider = "openai" as const;

  async uploadPdf(
    filePath: string,
    displayName: string,
  ): Promise<ProviderPdfUploadRef> {
    try {
      Zotero.log(
        `[Gemini PDF] OpenAI file upload started: ${displayName} (${filePath})`,
      );
      const client = getOpenAIClient();
      const bytes = readBinaryFile(filePath);
      const uploadedFile = await client.files.create({
        file: createPdfFile(bytes, displayName),
        purpose: "user_data",
      });
      Zotero.log(
        `[Gemini PDF] OpenAI file upload succeeded: ${displayName} (${uploadedFile.id})`,
      );
      return {
        provider: "openai",
        fileId: uploadedFile.id,
        uploadedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      Zotero.log(
        `[Gemini PDF] OpenAI file upload failed: ${displayName}: ${errorMessage}`,
      );
      Zotero.logError(
        new Error(
          `[Gemini PDF] OpenAI file upload failed: ${displayName}: ${errorMessage}`,
        ),
      );
      throw error;
    }
  }

  async isUploadAvailable(ref: ProviderPdfUploadRef): Promise<boolean> {
    if (ref.provider !== "openai") return false;
    try {
      await getOpenAIClient().files.retrieve(ref.fileId);
      return true;
    } catch (error: any) {
      Zotero.debug(
        `[Gemini PDF] OpenAI uploaded PDF is unavailable: ${
          error.message || String(error)
        }`,
      );
      if (isMissingUploadError(error)) {
        return false;
      }
      throw error;
    }
  }
}

class AnthropicPdfUploadAdapter implements PdfUploadAdapter {
  readonly provider = "anthropic" as const;

  async uploadPdf(
    filePath: string,
    displayName: string,
  ): Promise<ProviderPdfUploadRef> {
    const apiKey = requireApiKey("anthropic");
    const bytes = readBinaryFile(filePath);
    const formData = new FormData();
    formData.append("file", createPdfFile(bytes, displayName));
    const response = await fetch(
      "https://api.anthropic.com/v1/files?beta=true",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "files-api-2025-04-14",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: formData,
      },
    );
    if (!response.ok) {
      throw new Error(await formatHttpError("Anthropic file upload", response));
    }
    const uploadedFile = (await response.json()) as unknown as { id: string };
    return {
      provider: "anthropic",
      fileId: uploadedFile.id,
      uploadedAt: new Date().toISOString(),
    };
  }

  async isUploadAvailable(ref: ProviderPdfUploadRef): Promise<boolean> {
    if (ref.provider !== "anthropic") return false;
    try {
      const apiKey = requireApiKey("anthropic");
      const response = await fetch(
        `https://api.anthropic.com/v1/files/${encodeURIComponent(ref.fileId)}?beta=true`,
        {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "files-api-2025-04-14",
            "anthropic-dangerous-direct-browser-access": "true",
          },
        },
      );
      if (response.ok) {
        return true;
      }
      if (response.status === 404) {
        return false;
      }
      throw new Error(await formatHttpError("Anthropic file lookup", response));
    } catch (error: any) {
      Zotero.debug(
        `[Gemini PDF] Anthropic uploaded PDF is unavailable: ${
          error.message || String(error)
        }`,
      );
      if (isMissingUploadError(error)) {
        return false;
      }
      throw error;
    }
  }
}

async function formatHttpError(
  label: string,
  response: Response,
): Promise<string> {
  let detail = "";
  try {
    detail = await response.text();
  } catch (_e) {
    detail = response.statusText;
  }
  return `${label} failed with ${response.status}: ${detail}`;
}

export function getPdfUploadAdapter(provider: ProviderId): PdfUploadAdapter {
  switch (provider) {
    case "gemini":
      return new GeminiPdfUploadAdapter();
    case "openai":
      return new OpenAIPdfUploadAdapter();
    case "anthropic":
      return new AnthropicPdfUploadAdapter();
  }
}
