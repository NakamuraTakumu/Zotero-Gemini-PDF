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

type SafeProviderError = Error & { safeProviderError?: true };

function getSafeErrorStatus(error: any): string | undefined {
  const status = error?.status || error?.statusCode;
  return typeof status === "number" || typeof status === "string"
    ? String(status)
    : undefined;
}

function createSafeProviderError(
  operation: string,
  error: any,
): SafeProviderError {
  if (error?.safeProviderError) {
    return error as SafeProviderError;
  }
  const status = getSafeErrorStatus(error);
  const safeError = new Error(
    status
      ? `${operation} failed with status ${status}.`
      : `${operation} failed.`,
  ) as SafeProviderError;
  safeError.safeProviderError = true;
  return safeError;
}

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

function isGeminiUnavailableUploadError(error: any): boolean {
  const status = error?.status || error?.statusCode || error?.code;
  if (status === 403 || status === "403") {
    const code = String(
      error?.error?.status || error?.statusText || error?.code || "",
    ).toLowerCase();
    const message = String(error?.message || error).toLowerCase();
    if (
      code.includes("permission_denied") ||
      message.includes("permission denied") ||
      message.includes("do not have permission to access the file") ||
      message.includes("may not exist")
    ) {
      return true;
    }
  }

  return isMissingUploadError(error);
}

class GeminiPdfUploadAdapter implements PdfUploadAdapter {
  readonly provider = "gemini" as const;

  async uploadPdf(
    filePath: string,
    displayName: string,
  ): Promise<ProviderPdfUploadRef> {
    try {
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
    } catch (error: any) {
      throw createSafeProviderError("Gemini file upload", error);
    }
  }

  async isUploadAvailable(ref: ProviderPdfUploadRef): Promise<boolean> {
    if (ref.provider !== "gemini") return false;
    const fileName = ref.fileUri.split("/").pop();
    if (!fileName) return false;
    try {
      await getGeminiClient().files.get({ name: `files/${fileName}` });
      return true;
    } catch (error: any) {
      const status = getSafeErrorStatus(error);
      Zotero.debug(
        `[Ask My Paper] Gemini uploaded PDF is unavailable${status ? ` (status ${status})` : ""}.`,
      );
      if (isGeminiUnavailableUploadError(error)) {
        return false;
      }
      throw createSafeProviderError("Gemini file lookup", error);
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
      Zotero.log("[Ask My Paper] OpenAI file upload started.");
      const client = getOpenAIClient();
      const bytes = readBinaryFile(filePath);
      const uploadedFile = await client.files.create({
        file: createPdfFile(bytes, displayName),
        purpose: "user_data",
      });
      Zotero.log("[Ask My Paper] OpenAI file upload succeeded.");
      return {
        provider: "openai",
        fileId: uploadedFile.id,
        uploadedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      const safeError = createSafeProviderError("OpenAI file upload", error);
      Zotero.log(`[Ask My Paper] ${safeError.message}`);
      Zotero.logError(safeError);
      throw safeError;
    }
  }

  async isUploadAvailable(ref: ProviderPdfUploadRef): Promise<boolean> {
    if (ref.provider !== "openai") return false;
    try {
      await getOpenAIClient().files.retrieve(ref.fileId);
      return true;
    } catch (error: any) {
      const status = getSafeErrorStatus(error);
      Zotero.debug(
        `[Ask My Paper] OpenAI uploaded PDF is unavailable${status ? ` (status ${status})` : ""}.`,
      );
      if (isMissingUploadError(error)) {
        return false;
      }
      throw createSafeProviderError("OpenAI file lookup", error);
    }
  }
}

class AnthropicPdfUploadAdapter implements PdfUploadAdapter {
  readonly provider = "anthropic" as const;

  async uploadPdf(
    filePath: string,
    displayName: string,
  ): Promise<ProviderPdfUploadRef> {
    try {
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
        throw createSafeProviderError("Anthropic file upload", {
          status: response.status,
        });
      }
      const uploadedFile = (await response.json()) as unknown as { id: string };
      return {
        provider: "anthropic",
        fileId: uploadedFile.id,
        uploadedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      throw createSafeProviderError("Anthropic file upload", error);
    }
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
      throw createSafeProviderError("Anthropic file lookup", {
        status: response.status,
      });
    } catch (error: any) {
      const status = getSafeErrorStatus(error);
      Zotero.debug(
        `[Ask My Paper] Anthropic uploaded PDF is unavailable${status ? ` (status ${status})` : ""}.`,
      );
      if (isMissingUploadError(error)) {
        return false;
      }
      throw createSafeProviderError("Anthropic file lookup", error);
    }
  }
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
