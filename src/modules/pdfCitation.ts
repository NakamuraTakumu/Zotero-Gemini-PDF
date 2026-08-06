import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  ParentItemFileMetadataFile,
  PdfCitationToolCallTrace,
  PdfCitationToolCallStatus,
} from "../types/chat";

const DEFAULT_CONTEXT_CHARS = 160;
const DEFAULT_MAX_MATCHES = 5;
const MAX_QUERY_CHARS = 2000;
const MAX_READ_RANGE_CHARS = 4000;
const MAX_SOURCE_TEXT_CHARS = 8000;
const DIAGNOSTIC_PREVIEW_CHARS = 160;
const RANGE_ID_RANDOM_CHARS = 8;
const RANGE_ID_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyz";

export interface PdfTextLocator {
  libraryID: number;
  attachmentKey: string;
  textVersion?: string;
  start: number;
  end: number;
}

export interface PdfCitationRenderInput {
  locator: PdfTextLocator;
  rawText: string;
  pdfFile: ParentItemFileMetadataFile;
  existingDisplayText: string;
}

export interface PdfCitationNormalizationResult {
  text: string;
  normalizedCount: number;
  droppedCount: number;
  warnings: string[];
}

export interface PdfCitationRangeEntry {
  rangeId: string;
  locator: PdfTextLocator;
  rawText: string;
  text: string;
  before: string;
  after: string;
  textVersion: string;
}

export interface RegisterPdfCitationRangeInput {
  locator: PdfTextLocator;
  rawText?: string;
  text?: string;
  before: string;
  after: string;
  textVersion: string;
}

export class PdfCitationRangeRegistry {
  private readonly entries = new Map<string, PdfCitationRangeEntry>();

  register(input: RegisterPdfCitationRangeInput): PdfCitationRangeEntry {
    const text = input.text ?? input.rawText ?? "";
    if (!text.trim()) {
      throw new Error("PDF citation range text is empty.");
    }
    if (input.locator.start < 0 || input.locator.end <= input.locator.start) {
      throw new Error(
        `Invalid PDF citation range: start=${input.locator.start}, end=${input.locator.end}`,
      );
    }
    const rangeId = this.createRangeId();
    const entry: PdfCitationRangeEntry = {
      rangeId,
      locator: { ...input.locator, textVersion: input.textVersion },
      rawText: text,
      text,
      before: input.before,
      after: input.after,
      textVersion: input.textVersion,
    };
    this.entries.set(rangeId, entry);
    return entry;
  }

  resolve(rangeId: string): PdfCitationRangeEntry | undefined {
    return this.entries.get(rangeId);
  }

  private createRangeId(): string {
    let rangeId = "";
    do {
      rangeId = `r_${randomRangeIdToken(RANGE_ID_RANDOM_CHARS)}`;
    } while (this.entries.has(rangeId));
    return rangeId;
  }
}

function randomRangeIdToken(length: number): string {
  const bytes = new Uint8Array(length);
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => RANGE_ID_ALPHABET[byte & 31]).join("");
}

interface NormalizePdfCitationBlocksOptions {
  allowCitationBlocks?: boolean;
  pdfFiles?: ParentItemFileMetadataFile[];
  rangeRegistry?: PdfCitationRangeRegistry;
  getCurrentTextVersion?: (locator: PdfTextLocator) => Promise<string>;
  renderDisplayText?: (input: PdfCitationRenderInput) => Promise<string>;
}

interface AttachmentTextSnapshot {
  text: string;
  textVersion: string;
}

interface SearchIndex {
  text: string;
  originalOffsets: number[];
}

interface PdfTextMatch {
  start: number;
  end: number;
  text: string;
  before: string;
  after: string;
}

export interface FindPdfTextArgs {
  libraryID: number;
  attachmentKey: string;
  query: string;
  normalize?: boolean;
}

export interface RegisterPdfQuoteArgs {
  libraryID: number;
  attachmentKey: string;
  textVersion: string;
  quote: string;
  sourceText?: string;
}

interface ReadPdfTextRangeArgs {
  libraryID: number;
  attachmentKey: string;
  start: number;
  end: number;
}

export interface PdfCitationBlockMatch {
  fullBlock: string;
  rawJson: string;
  displayText: string;
  index: number;
  hasNestedCitation: boolean;
  isClosed: boolean;
}

export interface PdfCitationToolCallTraceInput {
  round: number;
  toolName: string;
  args: unknown;
  status: PdfCitationToolCallStatus;
  result?: unknown;
  error?: unknown;
}

export function createPdfCitationTools(
  options: {
    rangeRegistry?: PdfCitationRangeRegistry;
  } = {},
) {
  return [
    tool(
      async (args: FindPdfTextArgs) => JSON.stringify(await findPdfText(args)),
      {
        name: "find_pdf_text",
        description:
          "Search Zotero attachmentText for text to cite from a PDF. Use this before writing PDF citation blocks.",
        schema: z.object({
          libraryID: z
            .number()
            .int()
            .describe("Zotero library ID that owns the PDF attachment."),
          attachmentKey: z
            .string()
            .describe("Zotero item key of the PDF attachment to search."),
          query: z
            .string()
            .max(MAX_QUERY_CHARS)
            .describe(
              "Text to find in Zotero attachmentText. Keep it close to the original PDF wording.",
            ),
          normalize: z
            .boolean()
            .optional()
            .describe(
              "Whether to ignore whitespace, line break, hyphenation, and Unicode normalization differences. Defaults to true.",
            ),
        }),
      },
    ),
    tool(
      async (args: RegisterPdfQuoteArgs) => {
        const range = await registerPdfQuote(args);
        const registryEntry = options.rangeRegistry?.register({
          locator: {
            libraryID: args.libraryID,
            attachmentKey: args.attachmentKey,
            textVersion: range.textVersion,
            start: range.start,
            end: range.end,
          },
          text: range.text,
          before: range.before,
          after: range.after,
          textVersion: range.textVersion,
        });
        return JSON.stringify({
          ...(registryEntry ? { rangeId: registryEntry.rangeId } : {}),
          textVersion: range.textVersion,
          text: range.text,
          before: range.before,
          after: range.after,
        });
      },
      {
        name: "register_pdf_quote",
        description:
          "Register an exact quote copied from find_pdf_text sourceText and return a rangeId. Omit sourceText normally. Include the unchanged sourceText only when the quote occurs multiple times in the PDF.",
        schema: z.object({
          libraryID: z
            .number()
            .int()
            .describe(
              "Zotero library ID returned in the current request's PDF citation attachment context.",
            ),
          attachmentKey: z
            .string()
            .describe(
              "Zotero item key returned in the current request's PDF citation attachment context.",
            ),
          textVersion: z
            .string()
            .regex(/^sha256:[0-9a-f]{64}$/)
            .describe(
              "The textVersion returned by find_pdf_text. Copy it unchanged.",
            ),
          quote: z
            .string()
            .min(1)
            .max(MAX_READ_RANGE_CHARS)
            .describe(
              "The smallest complete supporting sentence, formula block, theorem or definition item, or bullet item copied exactly from find_pdf_text sourceText.",
            ),
          sourceText: z
            .string()
            .min(1)
            .max(MAX_SOURCE_TEXT_CHARS)
            .optional()
            .describe(
              "The unchanged sourceText returned by find_pdf_text. Omit it unless the quote occurs multiple times in the PDF.",
            ),
        }),
      },
    ),
  ];
}

export function summarizePdfCitationToolCall(
  input: PdfCitationToolCallTraceInput,
): PdfCitationToolCallTrace {
  return {
    round: input.round,
    toolName: input.toolName,
    argsSummary: summarizePdfCitationToolArgs(input.toolName, input.args),
    status: input.status,
    resultSummary:
      input.status === "success"
        ? summarizePdfCitationToolResult(input.toolName, input.result)
        : summarizePdfCitationToolError(input.error),
  };
}

function summarizePdfCitationToolArgs(
  toolName: string,
  value: unknown,
): Record<string, unknown> {
  const args = asRecord(value);
  const summary: Record<string, unknown> = {};
  copyNumber(args, summary, "libraryID");
  copyString(args, summary, "attachmentKey");
  if (typeof args.query === "string") {
    summary.queryLength = args.query.length;
  }
  if (typeof args.normalize === "boolean") {
    summary.normalize = args.normalize;
  }
  if (typeof args.quote === "string") {
    summary.quoteLength = args.quote.length;
  }
  if (typeof args.sourceText === "string") {
    summary.sourceTextLength = args.sourceText.length;
  }
  if (Object.keys(summary).length > 0) return summary;
  return { toolName };
}

function summarizePdfCitationToolResult(
  toolName: string,
  value: unknown,
): Record<string, unknown> {
  const result = parseToolResult(value);
  if (toolName === "find_pdf_text") {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const firstMatch = asRecord(matches[0]);
    return {
      textVersion: shortTextVersion(result.textVersion),
      matchCount: matches.length,
      ...(matches.length > 0
        ? {
            firstMatch: {
              sourceTextLength:
                typeof firstMatch.sourceText === "string"
                  ? firstMatch.sourceText.length
                  : undefined,
            },
          }
        : {}),
    };
  }
  if (toolName === "register_pdf_quote") {
    return {
      rangeId: typeof result.rangeId === "string" ? result.rangeId : undefined,
      textVersion: shortTextVersion(result.textVersion),
      textLength: typeof result.text === "string" ? result.text.length : 0,
      beforeLength:
        typeof result.before === "string" ? result.before.length : 0,
      afterLength: typeof result.after === "string" ? result.after.length : 0,
    };
  }
  return {
    resultType: Array.isArray(value) ? "array" : typeof value,
  };
}

function summarizePdfCitationToolError(
  error: unknown,
): Record<string, unknown> {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  return { errorPreview: previewText(message) };
}

export async function findPdfText(args: FindPdfTextArgs): Promise<{
  textVersion: string;
  matches: Array<{ sourceText: string }>;
}> {
  const snapshot = await getAttachmentTextSnapshot(
    args.libraryID,
    args.attachmentKey,
  );
  const query = args.query.slice(0, MAX_QUERY_CHARS);
  const maxMatches = DEFAULT_MAX_MATCHES;
  const contextBefore = DEFAULT_CONTEXT_CHARS;
  const contextAfter = DEFAULT_CONTEXT_CHARS;
  const matches =
    args.normalize === false
      ? exactFind(snapshot.text, query, maxMatches, contextBefore, contextAfter)
      : normalizedFind(
          snapshot.text,
          query,
          maxMatches,
          contextBefore,
          contextAfter,
        );
  Zotero.debug(
    `[Ask My Paper] find_pdf_text: attachment=${args.attachmentKey}, queryChars=${query.length}, matches=${matches.length}`,
  );
  return {
    textVersion: snapshot.textVersion,
    matches: matches.map((match) => ({
      sourceText: `${match.before}${match.text}${match.after}`,
    })),
  };
}

export function locateExactPdfQuote(
  text: string,
  quote: string,
  sourceText?: string,
): { start: number; end: number } {
  if (!quote.trim()) {
    throw new Error("Quote is empty.");
  }
  if (quote.length > MAX_READ_RANGE_CHARS) {
    throw new Error("Quote exceeds the maximum citation length.");
  }

  if (sourceText === undefined) {
    const quoteMatches = exactOccurrenceStarts(text, quote, 2);
    if (quoteMatches.length === 0) {
      throw new Error("Quote was not found in the PDF text.");
    }
    if (quoteMatches.length > 1) {
      throw new Error(
        "Quote occurs multiple times in the PDF text. Retry with the source text returned by find_pdf_text.",
      );
    }
    return {
      start: quoteMatches[0],
      end: quoteMatches[0] + quote.length,
    };
  }

  const sourceMatches = exactOccurrenceStarts(text, sourceText, 2);
  if (sourceMatches.length === 0) {
    throw new Error("Source text was not found in the PDF text.");
  }
  if (sourceMatches.length > 1) {
    throw new Error(
      "Source text occurs multiple times in the PDF text. Use a longer source text.",
    );
  }
  const quoteMatches = exactOccurrenceStarts(sourceText, quote, 2);
  if (quoteMatches.length === 0) {
    throw new Error(
      "Quote is not an exact substring of the supplied source text.",
    );
  }
  if (quoteMatches.length > 1) {
    throw new Error(
      "Quote occurs multiple times in the supplied source text. Use a narrower source or a longer exact quote.",
    );
  }
  const start = sourceMatches[0] + quoteMatches[0];
  return { start, end: start + quote.length };
}

export async function registerPdfQuote(args: RegisterPdfQuoteArgs): Promise<{
  textVersion: string;
  start: number;
  end: number;
  text: string;
  before: string;
  after: string;
}> {
  const snapshot = await getAttachmentTextSnapshot(
    args.libraryID,
    args.attachmentKey,
  );
  if (snapshot.textVersion !== args.textVersion) {
    throw new Error("PDF text changed after find_pdf_text. Search again.");
  }
  const { start, end } = locateExactPdfQuote(
    snapshot.text,
    args.quote,
    args.sourceText,
  );
  const range = sliceWithContext(
    snapshot.text,
    start,
    end,
    DEFAULT_CONTEXT_CHARS,
    DEFAULT_CONTEXT_CHARS,
  );
  if (range.text !== args.quote) {
    throw new Error("Registered quote does not match the PDF text.");
  }
  return {
    textVersion: snapshot.textVersion,
    start,
    end,
    ...range,
  };
}

export async function readPdfTextRange(args: ReadPdfTextRangeArgs): Promise<{
  textVersion: string;
  start: number;
  end: number;
  text: string;
  before: string;
  after: string;
}> {
  const snapshot = await getAttachmentTextSnapshot(
    args.libraryID,
    args.attachmentKey,
  );
  const contextBefore = DEFAULT_CONTEXT_CHARS;
  const contextAfter = DEFAULT_CONTEXT_CHARS;
  const start = clampInteger(args.start, 0, snapshot.text.length);
  const requestedEnd = clampInteger(args.end, 0, snapshot.text.length);
  const end = Math.min(
    snapshot.text.length,
    Math.max(start, Math.min(requestedEnd, start + MAX_READ_RANGE_CHARS)),
  );
  return {
    textVersion: snapshot.textVersion,
    start,
    end,
    ...sliceWithContext(snapshot.text, start, end, contextBefore, contextAfter),
  };
}

export async function normalizePdfCitationBlocks(
  text: string,
  options: NormalizePdfCitationBlocksOptions = {},
): Promise<PdfCitationNormalizationResult> {
  const replacements: Array<{ from: string; to: string }> = [];
  const warnings: string[] = [];
  let normalizedCount = 0;
  let droppedCount = 0;
  const blocks = [
    ...findPdfCitationBlocks(text),
    ...findLegacyPdfCitationPipeBlocks(text),
  ].sort((left, right) => left.index - right.index);
  for (const match of blocks) {
    const { fullBlock, rawJson, index, hasNestedCitation } = match;
    const displayText = match.displayText.trim();
    try {
      if ("isLegacyPipe" in match) {
        throw new Error(
          "Legacy PDF citation pipe block is not accepted in new responses.",
        );
      }
      if (!match.isClosed) {
        throw new Error("PDF citation block is missing its closing marker.");
      }
      if (options.allowCitationBlocks === false) {
        throw new Error(
          "PDF citation block was returned without PDF tool use.",
        );
      }
      if (hasNestedCitation || /:::\s*citation/i.test(displayText)) {
        throw new Error("PDF citation block contains nested citation syntax.");
      }
      const parsed = JSON.parse(rawJson);
      const rangeId =
        typeof parsed?.rangeId === "string" ? parsed.rangeId.trim() : "";
      let normalized: PdfTextLocator;
      let rawText: string;
      if (rangeId) {
        const entry = options.rangeRegistry?.resolve(rangeId);
        if (!entry) {
          throw new Error(`Unknown PDF citation rangeId: ${rangeId}`);
        }
        if (!entry.text.trim()) {
          throw new Error(`PDF citation range is empty: ${rangeId}`);
        }
        const currentTextVersion = await getCurrentTextVersionForLocator(
          entry.locator,
          options.getCurrentTextVersion,
        );
        if (entry.textVersion !== currentTextVersion) {
          throw new Error(`Stale PDF citation rangeId: ${rangeId}`);
        }
        normalized = {
          ...entry.locator,
          textVersion: currentTextVersion,
        };
        rawText = entry.rawText;
      } else {
        const locator = parseLocator(parsed?.locator);
        if (!locator) {
          throw new Error("Missing or invalid locator.");
        }
        if (!locator.textVersion) {
          throw new Error("PDF citation locator is missing textVersion.");
        }
        warnings.push("Legacy PDF citation locator block normalized.");
        normalized = await normalizeLocator(locator);
        const range = await readPdfTextRange({
          libraryID: normalized.libraryID,
          attachmentKey: normalized.attachmentKey,
          start: normalized.start,
          end: normalized.end,
        });
        rawText = range.text;
      }
      if (normalized.end <= normalized.start) {
        throw new Error("Missing or invalid locator.");
      }
      const pdfFile = findPdfFileForLocator(options.pdfFiles, normalized);
      if (!pdfFile) {
        throw new Error(
          `PDF citation file metadata not found: libraryID=${normalized.libraryID}, attachmentKey=${normalized.attachmentKey}`,
        );
      }
      const renderedDisplayText = options.renderDisplayText
        ? await options.renderDisplayText({
            locator: normalized,
            rawText,
            pdfFile,
            existingDisplayText: displayText,
          })
        : displayText;
      if (!renderedDisplayText.trim()) {
        throw new Error("PDF citation display text is empty.");
      }
      replacements.push({
        from: fullBlock,
        to: `::: citation ${JSON.stringify({ locator: normalized })}\n${renderedDisplayText.trim()}\n:::\n`,
      });
      normalizedCount++;
    } catch (error: any) {
      droppedCount++;
      const warning = error.message || String(error);
      warnings.push(warning);
      Zotero.logError(
        new Error(`[Ask My Paper] Dropped PDF citation block: ${warning}`),
      );
      replacements.push({ from: fullBlock, to: "" });
    }
  }

  return {
    text: replacements.reduce(
      (current, replacement) =>
        current.replace(replacement.from, replacement.to),
      text,
    ),
    normalizedCount,
    droppedCount,
    warnings,
  };
}

export function findPdfCitationBlocks(text: string): PdfCitationBlockMatch[] {
  const blocks: PdfCitationBlockMatch[] = [];
  const lines = splitTextLines(text);
  const fencedLines = findFencedCodeLines(lines);

  for (let i = 0; i < lines.length; i++) {
    if (fencedLines.has(i)) continue;
    const startLine = lines[i];
    const startMatch = startLine.text.match(/:::\s*citation\s+({[^\n]+})\s*$/);
    if (!startMatch) continue;
    const blockStart = startLine.start + (startMatch.index || 0);

    let endLineIndex = -1;
    let hasNestedCitation = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (fencedLines.has(j)) continue;
      const trimmed = lines[j].text.trim();
      if (/^::: citation\s+{[^\n]+}$/.test(trimmed)) {
        hasNestedCitation = true;
      }
      if (trimmed === ":::") {
        endLineIndex = j;
        break;
      }
    }

    const blockEnd = endLineIndex >= 0 ? lines[endLineIndex].end : text.length;
    const displayStart = startLine.end;
    const displayEnd = endLineIndex >= 0 ? lines[endLineIndex].start : blockEnd;
    blocks.push({
      fullBlock: text.slice(blockStart, blockEnd),
      rawJson: startMatch[1],
      displayText: text.slice(displayStart, displayEnd),
      index: blockStart,
      hasNestedCitation,
      isClosed: endLineIndex >= 0,
    });
    i = endLineIndex >= 0 ? endLineIndex : lines.length;
  }
  return blocks;
}

function findLegacyPdfCitationPipeBlocks(
  text: string,
): Array<PdfCitationBlockMatch & { isLegacyPipe: true }> {
  const blocks: Array<PdfCitationBlockMatch & { isLegacyPipe: true }> = [];
  const lines = splitTextLines(text);
  const fencedLines = findFencedCodeLines(lines);

  for (let i = 0; i < lines.length; i++) {
    if (fencedLines.has(i)) continue;
    const startLine = lines[i];
    const startMatch = startLine.text.match(
      /:::\s*citation\s+([^\n]*\|[^\n]*)\s*$/,
    );
    if (!startMatch || isJsonObject(startMatch[1].trim())) continue;
    const blockStart = startLine.start + (startMatch.index || 0);
    let endLineIndex = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (fencedLines.has(j)) continue;
      if (lines[j].text.trim() === ":::") {
        endLineIndex = j;
        break;
      }
    }
    const blockEnd =
      endLineIndex >= 0 ? lines[endLineIndex].end : startLine.end;
    blocks.push({
      fullBlock: text.slice(blockStart, blockEnd),
      rawJson: "",
      displayText: "",
      index: blockStart,
      hasNestedCitation: false,
      isClosed: endLineIndex >= 0,
      isLegacyPipe: true,
    });
    if (endLineIndex >= 0) i = endLineIndex;
  }
  return blocks;
}

interface TextLine {
  text: string;
  start: number;
  end: number;
}

function splitTextLines(text: string): TextLine[] {
  const linePattern = /[^\n]*(?:\n|$)/g;
  const lines: TextLine[] = [];
  for (const match of text.matchAll(linePattern)) {
    const line = match[0];
    if (!line) continue;
    const start = match.index || 0;
    lines.push({ text: line, start, end: start + line.length });
  }
  return lines;
}

function findFencedCodeLines(lines: TextLine[]): Set<number> {
  const fencedLines = new Set<number>();
  let fence: { character: string; length: number } | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].text;
    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!opening) continue;
      fence = {
        character: opening[1][0],
        length: opening[1].length,
      };
      fencedLines.add(index);
      continue;
    }

    fencedLines.add(index);
    const closing = new RegExp(
      `^ {0,3}${fence.character}{${fence.length},}\\s*$`,
    );
    if (closing.test(line)) {
      fence = undefined;
    }
  }
  return fencedLines;
}

function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return Boolean(
      parsed && typeof parsed === "object" && !Array.isArray(parsed),
    );
  } catch (_error) {
    return false;
  }
}

function findPdfFileForLocator(
  files: ParentItemFileMetadataFile[] | undefined,
  locator: PdfTextLocator,
): ParentItemFileMetadataFile | undefined {
  return (files || []).find(
    (file) =>
      file.zoteroAttachmentKey === locator.attachmentKey &&
      (typeof file.libraryID !== "number" ||
        file.libraryID === locator.libraryID),
  );
}

export async function recoverPdfCitationText(locator: PdfTextLocator): Promise<{
  text: string;
  textVersion: string;
  isStale: boolean;
}> {
  const range = await readPdfTextRange({
    libraryID: locator.libraryID,
    attachmentKey: locator.attachmentKey,
    start: locator.start,
    end: locator.end,
  });
  const isStale = Boolean(
    locator.textVersion && locator.textVersion !== range.textVersion,
  );
  return {
    text: isStale ? "" : range.text,
    textVersion: range.textVersion,
    isStale,
  };
}

export function formatPdfCitationSource(locator: PdfTextLocator): string {
  try {
    const attachment = Zotero.Items.getByLibraryAndKey(
      locator.libraryID,
      locator.attachmentKey,
    );
    if (attachment) {
      return (
        (attachment.getField("title") as string) ||
        (attachment.getField("filename") as string) ||
        locator.attachmentKey
      );
    }
  } catch (error: any) {
    Zotero.logError(
      new Error(
        `[Ask My Paper] Failed to format PDF citation source: ${
          error.message || String(error)
        }`,
      ),
    );
  }
  return `PDF ${locator.attachmentKey}`;
}

export function parsePdfCitationLocator(value: string): PdfTextLocator | null {
  try {
    const parsed = JSON.parse(value);
    return parseLocator(parsed?.locator);
  } catch (_error) {
    return null;
  }
}

async function normalizeLocator(
  locator: PdfTextLocator,
): Promise<PdfTextLocator> {
  if (locator.start < 0 || locator.end <= locator.start) {
    throw new Error(
      `Invalid PDF citation range: start=${locator.start}, end=${locator.end}`,
    );
  }
  const snapshot = await getAttachmentTextSnapshot(
    locator.libraryID,
    locator.attachmentKey,
  );
  const start = clampInteger(locator.start, 0, snapshot.text.length);
  const end = clampInteger(locator.end, 0, snapshot.text.length);
  if (end <= start) {
    throw new Error(
      `Invalid PDF citation range: start=${locator.start}, end=${locator.end}`,
    );
  }
  return {
    libraryID: locator.libraryID,
    attachmentKey: locator.attachmentKey,
    textVersion: snapshot.textVersion,
    start,
    end,
  };
}

async function getCurrentTextVersionForLocator(
  locator: PdfTextLocator,
  getCurrentTextVersion?: (locator: PdfTextLocator) => Promise<string>,
): Promise<string> {
  if (getCurrentTextVersion) {
    return getCurrentTextVersion(locator);
  }
  const snapshot = await getAttachmentTextSnapshot(
    locator.libraryID,
    locator.attachmentKey,
  );
  return snapshot.textVersion;
}

function parseLocator(value: unknown): PdfTextLocator | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    !Number.isInteger(record.libraryID) ||
    typeof record.attachmentKey !== "string" ||
    !Number.isInteger(record.start) ||
    !Number.isInteger(record.end) ||
    (record.start as number) < 0 ||
    (record.end as number) <= (record.start as number)
  ) {
    return null;
  }
  return {
    libraryID: record.libraryID as number,
    attachmentKey: record.attachmentKey,
    ...(typeof record.textVersion === "string"
      ? { textVersion: record.textVersion }
      : {}),
    start: record.start as number,
    end: record.end as number,
  };
}

async function getAttachmentTextSnapshot(
  libraryID: number,
  attachmentKey: string,
): Promise<AttachmentTextSnapshot> {
  const attachment = await Zotero.Items.getByLibraryAndKeyAsync(
    libraryID,
    attachmentKey,
  );
  if (!attachment) {
    throw new Error(
      `PDF attachment not found: libraryID=${libraryID}, key=${attachmentKey}`,
    );
  }
  if ((attachment.itemType as string) !== "attachment") {
    throw new Error(`Item is not an attachment: ${attachmentKey}`);
  }
  const text = await attachment.attachmentText;
  if (!text) {
    throw new Error(`Zotero attachmentText is empty: ${attachmentKey}`);
  }
  return {
    text,
    textVersion: await sha256Text(text),
  };
}

async function sha256Text(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  const hex = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function exactFind(
  text: string,
  query: string,
  maxMatches: number,
  contextBefore: number,
  contextAfter: number,
): PdfTextMatch[] {
  if (!query) return [];
  const matches: PdfTextMatch[] = [];
  let fromIndex = 0;
  while (matches.length < maxMatches) {
    const start = text.indexOf(query, fromIndex);
    if (start === -1) break;
    const end = start + query.length;
    matches.push({
      start,
      end,
      ...sliceWithContext(text, start, end, contextBefore, contextAfter),
    });
    fromIndex = Math.max(end, start + 1);
  }
  return matches;
}

function exactOccurrenceStarts(
  text: string,
  value: string,
  limit: number,
): number[] {
  if (!value || limit <= 0) return [];
  const starts: number[] = [];
  let fromIndex = 0;
  while (starts.length < limit) {
    const start = text.indexOf(value, fromIndex);
    if (start === -1) break;
    starts.push(start);
    fromIndex = start + 1;
  }
  return starts;
}

function normalizedFind(
  text: string,
  query: string,
  maxMatches: number,
  contextBefore: number,
  contextAfter: number,
): PdfTextMatch[] {
  const textIndex = buildNormalizedSearchIndex(text);
  const queryIndex = buildNormalizedSearchIndex(query);
  if (!queryIndex.text) return [];
  const matches: PdfTextMatch[] = [];
  let fromIndex = 0;
  while (matches.length < maxMatches) {
    const normalizedStart = textIndex.text.indexOf(queryIndex.text, fromIndex);
    if (normalizedStart === -1) break;
    const normalizedEnd = normalizedStart + queryIndex.text.length - 1;
    const start = textIndex.originalOffsets[normalizedStart];
    const lastOffset = textIndex.originalOffsets[normalizedEnd];
    const end = lastOffset + originalCharLengthAt(text, lastOffset);
    matches.push({
      start,
      end,
      ...sliceWithContext(text, start, end, contextBefore, contextAfter),
    });
    fromIndex = Math.max(normalizedStart + 1, normalizedEnd + 1);
  }
  return matches;
}

function buildNormalizedSearchIndex(value: string): SearchIndex {
  const chars: string[] = [];
  const originalOffsets: number[] = [];
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    const raw = String.fromCodePoint(codePoint || value.charCodeAt(index));
    if (!shouldSkipForNormalizedSearch(value, index, raw)) {
      const normalized = raw.normalize("NFKC").toLocaleLowerCase();
      for (const normalizedChar of normalized) {
        if (!/\s/u.test(normalizedChar)) {
          chars.push(normalizedChar);
          originalOffsets.push(index);
        }
      }
    }
    index += raw.length;
  }
  return {
    text: chars.join(""),
    originalOffsets,
  };
}

function shouldSkipForNormalizedSearch(
  value: string,
  index: number,
  raw: string,
): boolean {
  if (/\s/u.test(raw) || raw === "\u00ad") return true;
  if (raw === "-" || raw === "‐" || raw === "‑") {
    return /\s/u.test(value[index + raw.length] || "");
  }
  return false;
}

function originalCharLengthAt(text: string, index: number): number {
  const codePoint = text.codePointAt(index);
  return codePoint && codePoint > 0xffff ? 2 : 1;
}

function sliceWithContext(
  text: string,
  start: number,
  end: number,
  contextBefore: number,
  contextAfter: number,
): { text: string; before: string; after: string } {
  return {
    text: text.slice(start, end),
    before: text.slice(Math.max(0, start - contextBefore), start),
    after: text.slice(end, Math.min(text.length, end + contextAfter)),
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseToolResult(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch (_error) {
      return { text: value };
    }
  }
  return asRecord(value);
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function copyNumber(
  source: Record<string, any>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = asNumber(source[key]);
  if (typeof value === "number") {
    target[key] = value;
  }
}

function copyString(
  source: Record<string, any>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (typeof source[key] === "string") {
    target[key] = source[key];
  }
}

function previewText(value: unknown): string {
  if (typeof value !== "string") return "";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > DIAGNOSTIC_PREVIEW_CHARS
    ? `${compact.slice(0, DIAGNOSTIC_PREVIEW_CHARS)}...`
    : compact;
}

function shortTextVersion(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (value.startsWith("sha256:")) {
    return `sha256:${value.slice("sha256:".length, "sha256:".length + 12)}`;
  }
  return previewText(value);
}
