import { getPref, getPrefPath, setPref } from "../../utils/prefs";
import {
  PREF_LLM_PROVIDER,
  PREF_REASONING_MODE,
  PREF_USE_WEB_SEARCH,
} from "../../utils/constants";
import { PROVIDERS, PROVIDER_CONFIGS } from "../../utils/providerConfig";
import {
  getProviderModelList,
  getSelectedModel,
  getSelectedProvider,
  setSelectedModel,
  setSelectedProvider,
} from "../llm/provider";
import { toStoredMessageView } from "../llm/langChainMessages";
import { normalizeAssistantMarkdown } from "../llm/assistantMarkdown";
import { LlmCitation, LlmDiagnostics, ProviderId } from "../../types/chat";

import { ChatSessionManager } from "./chatSessionManager";
import { ChatSession } from "./chatSession";
import {
  formatPdfCitationSource,
  parsePdfCitationLocator,
  recoverPdfCitationText,
} from "../pdfCitation";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import markdownItKatex from "@vscode/markdown-it-katex";
import markdownItContainer from "markdown-it-container";
import markdownItCollapsible from "markdown-it-collapsible";
import type { Token } from "markdown-it";

const MESSAGE_HTML_SANITIZE_OPTIONS = {
  ADD_TAGS: [
    "math",
    "mi",
    "mo",
    "mn",
    "mtext",
    "mrow",
    "mfrac",
    "msup",
    "msub",
    "msubsup",
    "mover",
    "munder",
    "munderover",
    "msqrt",
    "mroot",
    "mfenced",
    "menclose",
    "mstyle",
    "mphantom",
    "mglyph",
    "mlabeledtr",
    "mtable",
    "mtr",
    "mtd",
    "maligngroup",
    "malignmark",
    "msgroup",
    "msrow",
    "mscol",
    "msline",
    "semantics",
    "annotation",
    "annotation-xml",
  ],
  ADD_ATTR: [
    "xmlns",
    "encoding",
    "class",
    "aria-hidden",
    "data-citation-locator",
    "data-original-quote",
    "target",
    "rel",
    "open",
    "mathvariant",
    "stretchy",
    "separator",
    "accent",
    "fence",
    "largeop",
    "lspace",
    "rspace",
    "scriptlevel",
    "displaystyle",
  ],
  FORBID_TAGS: ["script", "iframe", "object", "embed"],
};

interface MarkdownRenderer {
  renderMarkdown: (text: string) => string;
  sanitizeHtmlToFragment: (html: string) => DocumentFragment;
}

function toSafePdfCitationSource(locator: {
  libraryID: number;
  attachmentKey: string;
}): string {
  try {
    return formatPdfCitationSource({
      libraryID: locator.libraryID,
      attachmentKey: locator.attachmentKey,
      start: 0,
      end: 1,
    });
  } catch {
    Zotero.logError(
      new Error("[Ask My Paper] Failed to resolve PDF citation source."),
    );
    return `PDF ${locator.attachmentKey}`;
  }
}

// Helper for rendering markdown (moved from chat.ts)
const initMarkdownRenderer = (window: Window): MarkdownRenderer => {
  const DOMPurify = createDOMPurify(window as any); // Cast window to any

  // Handle CJS/ESM interop issue with the imported module
  const katexPlugin =
    typeof markdownItKatex === "function"
      ? markdownItKatex
      : (markdownItKatex as any).default;

  const createMarkdownItRenderer = (options: {
    citationContainer: boolean;
    collapsible: boolean;
  }) => {
    const md = new MarkdownIt({ xhtmlOut: true }).use(katexPlugin, {
      throwOnError: false,
      errorColor: "#cc0000",
      output: "mathml",
      strict: false,
    });

    if (options.citationContainer) {
      md.use(markdownItContainer, "citation", {
        validate: function (params: string) {
          const trimmed = params.trim();
          return (
            /^citation\s+\{.*\}$/.test(trimmed) ||
            /^citation\s+(.*)\|(.+)/.test(trimmed)
          );
        },
        render: function (tokens: Token[], idx: number) {
          if (tokens[idx].nesting === 1) {
            const info = tokens[idx].info.trim();
            const jsonPayload = info.replace(/^citation\s+/, "");
            const locator = parsePdfCitationLocator(jsonPayload);
            if (locator) {
              const source = md.renderInline(toSafePdfCitationSource(locator));
              const locatorAttribute = md.utils.escapeHtml(jsonPayload);
              return (
                `<div class="citation-container" data-citation-locator="${locatorAttribute}">\n` +
                `<div class="citation-source">${source}</div>\n` +
                `<div class="citation-content">\n`
              );
            }

            const m = info.match(/^citation\s+(.*)\|(.+)/);
            if (m) {
              const source = md.renderInline(m[1].trim());
              const originalRawText = m[2].trim();
              const originalQuote = md.utils.escapeHtml(originalRawText);
              return (
                `<div class="citation-container" data-original-quote="${originalQuote}">\n` +
                `<div class="citation-source">${source}</div>\n` +
                `<div class="citation-content">\n`
              );
            }
          } else {
            return "</div>\n</div>\n";
          }
          return "";
        },
      });
    }

    if (options.collapsible) {
      md.use(markdownItCollapsible);
    }

    return md;
  };

  const fullRenderer = createMarkdownItRenderer({
    citationContainer: true,
    collapsible: true,
  });

  const sanitizeHtmlToFragment = (html: string): DocumentFragment =>
    DOMPurify.sanitize(html, {
      ...MESSAGE_HTML_SANITIZE_OPTIONS,
      RETURN_DOM_FRAGMENT: true,
    } as any) as unknown as DocumentFragment;

  return {
    renderMarkdown(text: string): string {
      try {
        return fullRenderer.render(text || "");
      } catch (error) {
        Zotero.logError(new Error("[Ask My Paper] Markdown render failed."));
        throw error;
      }
    },
    sanitizeHtmlToFragment,
  };
};

export class UIManager {
  private static readonly SESSION_TITLE_MAX_CHARS = 32;
  private doc: Document;
  private body: HTMLElement;
  private chatMessages: HTMLDivElement;
  private chatInput: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private prefObserverKeys: symbol[] = [];
  private chatSessionManager: ChatSessionManager;
  public renderMarkdown: (text: string) => string;
  private sanitizeMessageHtmlToFragment: (html: string) => DocumentFragment;
  private citationPopup: HTMLDivElement; // 追加
  private messageContextMenu: HTMLDivElement;
  private contextMenuTargetMessage: HTMLElement | null = null;
  private messageContextMenuClickHandler?: (event: Event) => void;
  private documentClickHandler?: () => void;
  private documentKeydownHandler?: (event: KeyboardEvent) => void;

  constructor(
    doc: Document,
    body: HTMLElement,
    chatMessages: HTMLDivElement,
    chatSessionManager: ChatSessionManager,
  ) {
    this.doc = doc;
    this.body = body;
    this.chatMessages = chatMessages;
    this.chatSessionManager = chatSessionManager;
    this.chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
    this.sendButton = body.querySelector("#send-button") as HTMLButtonElement;
    const markdownRenderer = initMarkdownRenderer(doc.defaultView as Window);
    this.renderMarkdown = markdownRenderer.renderMarkdown;
    this.sanitizeMessageHtmlToFragment =
      markdownRenderer.sanitizeHtmlToFragment;

    // citationPopupの初期化
    this.citationPopup = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLDivElement;
    this.citationPopup.className = "citation-popup";
    this.citationPopup.style.display = "none";
    this.body.appendChild(this.citationPopup);

    this.messageContextMenu = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLDivElement;
    this.messageContextMenu.className = "message-context-menu";
    this.messageContextMenu.style.display = "none";
    const copyPlainTextButton = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    copyPlainTextButton.type = "button";
    copyPlainTextButton.className = "message-context-menu-item";
    copyPlainTextButton.dataset.action = "copy-plain-text";
    copyPlainTextButton.textContent = "全体をテキストでコピー";

    const copyMarkdownButton = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    copyMarkdownButton.type = "button";
    copyMarkdownButton.className = "message-context-menu-item";
    copyMarkdownButton.dataset.action = "copy-markdown";
    copyMarkdownButton.textContent = "全体をMarkdownでコピー";

    const copySelectionButton = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    copySelectionButton.type = "button";
    copySelectionButton.className = "message-context-menu-item";
    copySelectionButton.dataset.action = "copy-selection";
    copySelectionButton.textContent = "選択範囲をコピー";

    this.messageContextMenu.append(
      copyPlainTextButton,
      copyMarkdownButton,
      copySelectionButton,
    );
    this.body.appendChild(this.messageContextMenu);
    this._initMessageContextMenuEvents();
  }

  registerPrefObservers() {
    const providerObserverKey = Zotero.Prefs.registerObserver(
      getPrefPath(PREF_LLM_PROVIDER),
      () => {
        this.refreshProviderControls();
      },
    );
    this.prefObserverKeys.push(providerObserverKey);

    PROVIDERS.forEach((provider) => {
      const prefKey = PROVIDER_CONFIGS[provider].selectedModelPref;
      const modelObserverKey = Zotero.Prefs.registerObserver(
        getPrefPath(prefKey),
        () => {
          this.initModelSelector();
        },
      );
      this.prefObserverKeys.push(modelObserverKey);
    });

    const webSearchObserverKey = Zotero.Prefs.registerObserver(
      getPrefPath(PREF_USE_WEB_SEARCH),
      () => {
        const useWebSearchCheckbox = this.body.querySelector(
          "#use-web-search-checkbox",
        ) as HTMLInputElement;
        if (useWebSearchCheckbox) {
          const useWebSearch = getPref(PREF_USE_WEB_SEARCH) as boolean;
          useWebSearchCheckbox.checked = useWebSearch;
          Zotero.log(
            `[Ask My Paper] Pref observer updated Web Search to: ${useWebSearch}`,
          );
        }
      },
    );
    this.prefObserverKeys.push(webSearchObserverKey);

    const reasoningModeObserverKey = Zotero.Prefs.registerObserver(
      getPrefPath(PREF_REASONING_MODE),
      () => {
        this.initReasoningModeSelector();
      },
    );
    this.prefObserverKeys.push(reasoningModeObserverKey);
  }

  private unregisterPrefObservers() {
    this.prefObserverKeys.forEach((key) =>
      Zotero.Prefs.unregisterObserver(key),
    );
    Zotero.log("[Ask My Paper] Unregistered preference observers.");
    this.prefObserverKeys = [];
  }

  setChatSessionManager(chatSessionManager: ChatSessionManager): void {
    this.chatSessionManager = chatSessionManager;
  }

  destroy(): void {
    this.unregisterPrefObservers();
    if (this.messageContextMenuClickHandler) {
      this.messageContextMenu.removeEventListener(
        "click",
        this.messageContextMenuClickHandler,
      );
    }
    if (this.documentClickHandler) {
      this.doc.removeEventListener("click", this.documentClickHandler);
    }
    if (this.documentKeydownHandler) {
      this.doc.removeEventListener("keydown", this.documentKeydownHandler);
    }
    this.citationPopup.remove();
    this.messageContextMenu.remove();
  }

  initProviderSelector() {
    const providerSelect = this.body.querySelector(
      "#llm-provider-select",
    ) as HTMLSelectElement;
    if (!providerSelect) return;

    const selectedProvider = getSelectedProvider();
    providerSelect.value = selectedProvider;
    providerSelect.onchange = (e) => {
      const provider = (e.target as HTMLSelectElement).value as ProviderId;
      setSelectedProvider(provider);
      this.refreshProviderControls();
      Zotero.log(`[Ask My Paper] UI: Provider changed to: ${provider}.`);
    };
    this.refreshProviderControls();
  }

  private refreshProviderControls() {
    const providerSelect = this.body.querySelector(
      "#llm-provider-select",
    ) as HTMLSelectElement;
    if (providerSelect) {
      providerSelect.value = getSelectedProvider();
    }
    this.initModelSelector();
  }

  initModelSelector() {
    const modelSelect = this.body.querySelector(
      "#llm-model-select",
    ) as HTMLSelectElement;
    if (!modelSelect) return;

    const provider = getSelectedProvider();
    const availableModels = getProviderModelList(provider);
    const selectedModel = getSelectedModel(provider);
    Zotero.log(
      `[Ask My Paper] UI: Initializing model selector. Provider=${provider}, selected='${selectedModel}'.`,
    );

    modelSelect.innerHTML = "";
    availableModels.forEach((modelName) => {
      const option = this.doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "option",
      ) as HTMLOptionElement;
      option.value = modelName;
      option.textContent = modelName;
      if (modelName === selectedModel) {
        option.selected = true;
      }
      modelSelect.appendChild(option);
    });

    if (selectedModel && !availableModels.includes(selectedModel)) {
      const option = this.doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "option",
      ) as HTMLOptionElement;
      option.value = selectedModel;
      option.textContent = selectedModel;
      option.selected = true;
      modelSelect.appendChild(option);
    }

    modelSelect.onchange = (e) => {
      const newValue = (e.target as HTMLSelectElement).value;
      Zotero.log(`[Ask My Paper] UI: Model selection changed to: ${newValue}.`);
      setSelectedModel(getSelectedProvider(), newValue);
    };
  }

  initWebSearchCheckbox() {
    const useWebSearchCheckbox = this.body.querySelector(
      "#use-web-search-checkbox",
    ) as HTMLInputElement;
    if (!useWebSearchCheckbox) return;

    const useWebSearch = getPref(PREF_USE_WEB_SEARCH) as boolean;
    Zotero.log(
      `[Ask My Paper] UI: Initializing Web Search checkbox. Saved PREF_USE_WEB_SEARCH value is: ${useWebSearch}.`,
    );
    useWebSearchCheckbox.checked = useWebSearch;

    useWebSearchCheckbox.onchange = (e) => {
      const newValue = (e.target as HTMLInputElement).checked;
      setPref(PREF_USE_WEB_SEARCH, newValue);
      Zotero.log(`[Ask My Paper] UI: Use Web Search changed to: ${newValue}.`);
    };
  }

  initReasoningModeSelector() {
    const reasoningModeSelect = this.body.querySelector(
      "#reasoning-mode-select",
    ) as HTMLSelectElement;
    if (!reasoningModeSelect) return;

    const reasoningMode = (getPref(PREF_REASONING_MODE) as string) || "off";
    Zotero.log(
      `[Ask My Paper] UI: Initializing Thinking selector. Saved PREF_REASONING_MODE value is: ${reasoningMode}.`,
    );
    reasoningModeSelect.value = reasoningMode;

    reasoningModeSelect.onchange = (e) => {
      const newValue = (e.target as HTMLSelectElement).value;
      setPref(PREF_REASONING_MODE, newValue);
      Zotero.log(`[Ask My Paper] UI: Thinking mode changed to: ${newValue}.`);
    };
  }

  initSessionSwitcher() {
    const sessionSwitcher = this.body.querySelector(
      "#chat-session-switcher",
    ) as HTMLSelectElement;
    if (!sessionSwitcher) return;

    this.renderSessionSwitcherList();
    this.updateSessionSwitcherSelection();

    sessionSwitcher.onchange = (e) => {
      const newSessionId = (e.target as HTMLSelectElement).value;
      if (newSessionId) {
        this.chatSessionManager.switchSession(newSessionId);
      }
    };
  }

  private _formatSessionTitleForSwitcher(title: string): string {
    const cleaned = title.replace(/\s+/g, " ").trim();
    if (cleaned.length <= UIManager.SESSION_TITLE_MAX_CHARS) {
      return cleaned;
    }
    return `${cleaned.slice(0, UIManager.SESSION_TITLE_MAX_CHARS - 1)}...`;
  }

  renderSessionSwitcherList() {
    const sessionSwitcher = this.body.querySelector(
      "#chat-session-switcher",
    ) as HTMLSelectElement;
    if (!sessionSwitcher) return;

    const sessions = this.chatSessionManager.getAllSessions();
    Zotero.log(
      `[Ask My Paper] UIManager.renderSessionSwitcherList: Rendering ${sessions.length} sessions.`,
    );

    sessionSwitcher.innerHTML = "";

    sessions.forEach((session) => {
      const option = this.doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "option",
      ) as HTMLOptionElement;
      option.value = session.id;
      option.textContent = this._formatSessionTitleForSwitcher(session.title);
      option.title = session.title;
      sessionSwitcher.appendChild(option);
    });
  }

  updateSessionSwitcherSelection() {
    const sessionSwitcher = this.body.querySelector(
      "#chat-session-switcher",
    ) as HTMLSelectElement;
    if (!sessionSwitcher) return;

    const activeSession = this.chatSessionManager.getActiveSession();
    if (activeSession) {
      sessionSwitcher.value = activeSession.id;
      Zotero.log(
        `[Ask My Paper] UIManager.updateSessionSwitcherSelection: Selected session ID: ${activeSession.id}`,
      );
    }
  }

  initDeleteButton() {
    const deleteButton = this.body.querySelector(
      "#delete-session-button",
    ) as HTMLButtonElement;
    if (!deleteButton) return;

    deleteButton.onclick = async () => {
      const activeSession = this.chatSessionManager.getActiveSession();
      if (!activeSession) {
        Zotero.debug("[Ask My Paper] No active session to delete.");
        return;
      }

      const confirmDelete = Zotero.getMainWindow().confirm(
        `チャット「${activeSession.title}」を削除しますか？この操作は元に戻せません。`,
      );

      if (confirmDelete) {
        Zotero.debug("[Ask My Paper] Deleting active session.");
        const success = await this.chatSessionManager.deleteActiveSession();
        if (success) {
          // ドロップダウンの更新はdeleteActiveSession内のonActiveSessionChangeコールバックがトリガーする
          // ここで直接updateSessionSwitcher()を呼ぶ必要はない
        } else {
          Zotero.logError(
            new Error("[Ask My Paper] Failed to delete session."),
          );
        }
      }
    };
  }

  initRegenerateTitleButton() {
    const regenerateButton = this.body.querySelector(
      "#regenerate-title-button",
    ) as HTMLButtonElement;
    if (!regenerateButton) return;

    regenerateButton.onclick = async () => {
      const activeSession = this.chatSessionManager.getActiveSession();
      if (!activeSession) {
        Zotero.debug("[Ask My Paper] No active session to regenerate title.");
        return;
      }

      regenerateButton.disabled = true;
      try {
        const success = await activeSession.regenerateTitleFromTopHistory();
        if (!success) {
          Zotero.logError(
            new Error("[Ask My Paper] Failed to regenerate session title."),
          );
        }
      } catch {
        Zotero.logError(
          new Error("[Ask My Paper] Error regenerating session title."),
        );
      } finally {
        regenerateButton.disabled = false;
      }
    };
  }

  renderChatMessages(session: ChatSession | null) {
    this.chatMessages.innerHTML = "";
    if (!session) {
      return;
    }
    session.history.messages.forEach((storedMessage) => {
      const message = toStoredMessageView(storedMessage);
      const messageDiv = this.doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLDivElement;
      const roleClass =
        message.role === "assistant" ? "bot-message" : "user-message";
      messageDiv.className = `message ${roleClass}`;
      const displayText = message.displayText;
      if (message.role === "assistant") {
        let messageHtml = this.renderMarkdown(
          normalizeAssistantMarkdown(displayText),
        );
        messageHtml += this.renderMessageDetails(
          message.metadata.provider,
          message.metadata.model,
          message.metadata.thoughts,
          message.metadata.citations,
          message.metadata.llmDiagnostics,
        );
        this.setMessageHtml(messageDiv, messageHtml, displayText);
      } else {
        messageDiv.textContent = displayText;
      }
      messageDiv.dataset.rawText = displayText || "";
      this.chatMessages.appendChild(messageDiv);
      this._attachMiddleClickHandler(messageDiv as HTMLElement);
      this._attachMessageContextMenuHandler(messageDiv as HTMLElement);
      this._attachCitationPopupListeners(messageDiv as HTMLElement);
    });
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  addUserMessage(text: string): void {
    const userMessageDiv = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLDivElement;
    userMessageDiv.className = "message user-message";
    userMessageDiv.textContent = text;
    userMessageDiv.dataset.rawText = text;
    this.chatMessages.appendChild(userMessageDiv);
    this._attachMiddleClickHandler(userMessageDiv as HTMLElement);
    this._attachMessageContextMenuHandler(userMessageDiv as HTMLElement);
    this._attachCitationPopupListeners(userMessageDiv as HTMLElement); // 追加
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  addBotMessage = (
    html: string,
    className: string = "bot-message",
  ): HTMLDivElement => {
    const div = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLDivElement;
    div.className = `message ${className}`;
    this.setMessageHtml(div, html, html);
    div.dataset.rawText = html;
    this.chatMessages.appendChild(div);
    this._attachMiddleClickHandler(div as HTMLElement);
    this._attachMessageContextMenuHandler(div as HTMLElement);
    this._attachCitationPopupListeners(div as HTMLElement);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    return div;
  };

  updateBotMessage = (
    element: HTMLDivElement,
    responseText: string,
    thoughts?: string[],
    citations?: LlmCitation[],
    provider?: ProviderId,
    model?: string,
    diagnostics?: LlmDiagnostics,
  ) => {
    if (element.classList.contains("typing-message")) {
      element.className = "message bot-message";
    }
    let messageHtml = this.renderMarkdown(
      normalizeAssistantMarkdown(responseText || "No response."),
    );
    messageHtml += this.renderMessageDetails(
      provider,
      model,
      thoughts,
      citations,
      diagnostics,
    );
    this.setMessageHtml(element, messageHtml, responseText || "");
    element.dataset.rawText = responseText || "";
    this._attachMiddleClickHandler(element as HTMLElement);
    this._attachMessageContextMenuHandler(element as HTMLElement);
    this._attachCitationPopupListeners(element as HTMLElement); // 追加
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  };

  private setMessageHtml(
    element: HTMLDivElement,
    html: string,
    fallbackText: string,
  ): void {
    try {
      const fragment = this.sanitizeMessageHtmlToFragment(html);
      element.replaceChildren(fragment);
    } catch {
      Zotero.logError(
        new Error("[Ask My Paper] Failed to render message HTML."),
      );
      element.textContent = fallbackText || "Unable to render message.";
    }
  }

  private renderMessageDetails(
    provider?: ProviderId,
    model?: string,
    thoughts?: string[],
    citations?: LlmCitation[],
    diagnostics?: LlmDiagnostics,
  ): string {
    const metadataHtml = this.renderModelMetadata(provider, model);
    const thoughtsHtml = this.renderThoughts(thoughts);
    const sourcesHtml = this.renderSources(citations);
    const diagnosticsHtml = this.renderDiagnostics(diagnostics);
    if (!metadataHtml && !thoughtsHtml && !sourcesHtml && !diagnosticsHtml) {
      return "";
    }

    const providerLabel = provider
      ? this.formatProviderLabel(provider)
      : "unknown";
    const modelLabel = model || "unknown";
    const normalizedCitations = this.getNormalizedCitations(citations);
    const visibleThoughts = this.getVisibleThoughts(thoughts);
    const counts = [
      visibleThoughts.length > 0 ? `Think ${visibleThoughts.length}` : "",
      normalizedCitations.length > 0
        ? `Refs ${normalizedCitations.length}`
        : "",
    ].filter(Boolean);
    const summary =
      `Details · ${providerLabel} · ${modelLabel}` +
      (counts.length > 0 ? ` · ${counts.join(" · ")}` : "");
    return `<details class="message-details"><summary>${this.escapeHtml(summary)}</summary>${metadataHtml}${diagnosticsHtml}${thoughtsHtml}${sourcesHtml}</details>`;
  }

  private renderModelMetadata(provider?: ProviderId, model?: string): string {
    if (!provider && !model) return "";
    const providerLabel = provider
      ? this.formatProviderLabel(provider)
      : "unknown";
    const modelLabel = model || "unknown";
    return `<div class="message-model-metadata"><span>Provider</span><span>${this.escapeHtml(providerLabel)}</span><span>Model</span><span>${this.escapeHtml(modelLabel)}</span></div>`;
  }

  private renderDiagnostics(diagnostics?: LlmDiagnostics): string {
    if (!diagnostics) return "";
    const rows: string[] = [];
    if (typeof diagnostics.pdfCitationToolCallCount === "number") {
      rows.push(
        `<span>PDF tools</span><span>${diagnostics.pdfCitationToolCallCount}</span>`,
      );
    }
    if (typeof diagnostics.pdfCitationCount === "number") {
      rows.push(
        `<span>PDF citations</span><span>${diagnostics.pdfCitationCount}</span>`,
      );
    }
    if (typeof diagnostics.pdfCitationDroppedCount === "number") {
      rows.push(
        `<span>Dropped PDF citations</span><span>${diagnostics.pdfCitationDroppedCount}</span>`,
      );
    }
    if (diagnostics.citationRenderProvider || diagnostics.citationRenderModel) {
      rows.push(
        `<span>Citation render</span><span>${this.escapeHtml(
          [diagnostics.citationRenderProvider, diagnostics.citationRenderModel]
            .filter(Boolean)
            .join(" / "),
        )}</span>`,
      );
    }
    if ((diagnostics.pdfCitationWarnings || []).length > 0) {
      rows.push(
        `<span>PDF citation warnings</span><span>${this.escapeHtml(
          (diagnostics.pdfCitationWarnings || []).join(" | "),
        )}</span>`,
      );
    }
    return rows.length > 0
      ? `<div class="message-model-metadata">${rows.join("")}</div>`
      : "";
  }

  private formatProviderLabel(provider: ProviderId): string {
    return PROVIDER_CONFIGS[provider].label;
  }

  private renderThoughts(thoughts?: string[]): string {
    const visibleThoughts = this.getVisibleThoughts(thoughts);
    if (visibleThoughts.length === 0) return "";
    const thoughtHtml = visibleThoughts
      .map(
        (thought) =>
          `<div class="thought">${this.renderMarkdown(thought)}</div>`,
      )
      .join("");
    return `<section class="thoughts-container"><div class="message-detail-heading">Thinking (${visibleThoughts.length})</div>${thoughtHtml}</section>`;
  }

  private renderSources(citations?: LlmCitation[]): string {
    const normalizedCitations = this.getNormalizedCitations(citations);
    if (normalizedCitations.length === 0) return "";

    const sources = normalizedCitations
      .map((citation, index) => this.renderSourceLink(citation, index))
      .join("");
    return `<div class="sources-container"><b>参照元:</b>${sources}</div>`;
  }

  private getVisibleThoughts(thoughts?: string[]): string[] {
    return (thoughts || []).map((thought) => thought.trim()).filter(Boolean);
  }

  private getNormalizedCitations(citations?: LlmCitation[]): LlmCitation[] {
    return citations || [];
  }

  private renderSourceLink(citation: LlmCitation, index: number): string {
    const label = this.escapeHtml(citation.title || citation.url || "Source");
    const quote = citation.quote
      ? ` title="${this.escapeHtml(citation.quote)}"`
      : "";
    if (citation.url && this.isSafeSourceUrl(citation.url)) {
      return `<a href="${this.escapeHtml(citation.url)}" target="_blank" rel="noopener noreferrer"${quote}>[${index + 1}] ${label}</a>`;
    }
    return `<span${quote}>[${index + 1}] ${label}</span>`;
  }

  private isSafeSourceUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  setInputsDisabled(disabled: boolean): void {
    this.chatInput.disabled = disabled;
    this.sendButton.disabled = disabled;
  }

  clearChatInput(): void {
    this.chatInput.value = "";
    this.chatInput.focus();
  }

  /**
   * Attaches a middle-click handler to a message element to toggle all <details> elements within it.
   */
  private _attachMiddleClickHandler(messageElement: HTMLElement): void {
    if (messageElement.dataset.middleClickAttached === "true") {
      return;
    }
    messageElement.dataset.middleClickAttached = "true";
    messageElement.addEventListener("mouseup", (event: MouseEvent) => {
      if (event.button === 1) {
        // Middle mouse button
        event.preventDefault();
        event.stopPropagation();
        const detailsElements = messageElement.querySelectorAll(
          "details:not(.message-details)",
        );
        let anyClosed = false;
        detailsElements.forEach((details: HTMLDetailsElement) => {
          if (!details.open) {
            anyClosed = true;
          }
        });

        detailsElements.forEach((details: HTMLDetailsElement) => {
          if (anyClosed) {
            details.open = true; // 閉じているものがあれば全て開く
          } else {
            details.open = false; // 全て開いていれば全て閉じる
          }
        });
      }
    });
  }

  private _initMessageContextMenuEvents(): void {
    this.messageContextMenuClickHandler = (event: Event) => {
      void this._handleMessageContextMenuClick(event);
    };
    this.documentClickHandler = () => this._hideMessageContextMenu();
    this.documentKeydownHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        this._hideMessageContextMenu();
      }
    };
    this.messageContextMenu.addEventListener(
      "click",
      this.messageContextMenuClickHandler,
    );
    this.doc.addEventListener("click", this.documentClickHandler);
    this.doc.addEventListener("keydown", this.documentKeydownHandler);
  }

  private async _handleMessageContextMenuClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const button = target.closest(
      ".message-context-menu-item",
    ) as HTMLElement | null;
    if (!button) return;
    const action = button.dataset.action;
    if (action === "copy-plain-text") {
      await this._copyContextMenuTargetMessage("plain");
    } else if (action === "copy-markdown") {
      await this._copyContextMenuTargetMessage("markdown");
    } else if (action === "copy-selection") {
      await this._copySelectedTextInTargetMessage();
    }
    this._hideMessageContextMenu();
  }

  private _attachMessageContextMenuHandler(messageElement: HTMLElement): void {
    if (messageElement.dataset.contextMenuAttached === "true") {
      return;
    }
    messageElement.dataset.contextMenuAttached = "true";
    messageElement.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.contextMenuTargetMessage = messageElement;
      this._showMessageContextMenu(event.clientX, event.clientY);
    });
  }

  private _showMessageContextMenu(x: number, y: number): void {
    const hasSelectionInTarget = this._hasTextSelectionInTargetMessage();
    const menuItems = this.messageContextMenu.querySelectorAll(
      ".message-context-menu-item",
    ) as NodeListOf<HTMLElement>;

    // Whole-message actions are shown only when no range selection exists.
    menuItems.forEach((item: HTMLElement) => {
      const action = item.dataset.action;
      if (action === "copy-selection") {
        item.style.display = hasSelectionInTarget ? "" : "none";
      } else {
        item.style.display = hasSelectionInTarget ? "none" : "";
      }
    });

    let hasVisibleItems = false;
    for (const item of menuItems) {
      if (item.style.display !== "none") {
        hasVisibleItems = true;
        break;
      }
    }
    if (!hasVisibleItems) {
      this._hideMessageContextMenu();
      return;
    }

    this.messageContextMenu.style.left = `${x}px`;
    this.messageContextMenu.style.top = `${y}px`;
    this.messageContextMenu.style.display = "block";
  }

  private _hideMessageContextMenu(): void {
    this.messageContextMenu.style.display = "none";
    this.contextMenuTargetMessage = null;
  }

  private _hasTextSelectionInTargetMessage(): boolean {
    if (!this.contextMenuTargetMessage) return false;
    const selection = this.doc.defaultView?.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) return false;

    const range = selection.getRangeAt(0);
    const elementNodeType = this.doc.defaultView?.Node?.ELEMENT_NODE ?? 1;
    const commonAncestor =
      range.commonAncestorContainer.nodeType === elementNodeType
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (!commonAncestor) return false;

    return this.contextMenuTargetMessage.contains(commonAncestor);
  }

  private async _copySelectedTextInTargetMessage(): Promise<void> {
    if (!this._hasTextSelectionInTargetMessage()) return;
    const selection = this.doc.defaultView?.getSelection();
    const text = selection?.toString() || "";
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_e) {
      const temp = this.doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "textarea",
      ) as HTMLTextAreaElement;
      temp.value = text;
      this.body.appendChild(temp);
      temp.select();
      this.doc.execCommand("copy");
      temp.remove();
    }
  }

  private async _copyContextMenuTargetMessage(
    format: "plain" | "markdown",
  ): Promise<void> {
    if (!this.contextMenuTargetMessage) return;
    const plainText = (() => {
      // Exclude generated metadata from whole-message copy output.
      const clone = this.contextMenuTargetMessage!.cloneNode(
        true,
      ) as HTMLElement;
      clone.querySelectorAll(".message-details").forEach((element: Element) => {
        element.remove();
      });
      return clone.textContent || "";
    })();
    const markdownText =
      this.contextMenuTargetMessage.dataset.rawText || plainText;
    const text = format === "plain" ? plainText : markdownText;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_e) {
      // Fallback for environments where Clipboard API is unavailable.
      const temp = this.doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "textarea",
      ) as HTMLTextAreaElement;
      temp.value = text;
      this.body.appendChild(temp);
      temp.select();
      this.doc.execCommand("copy");
      temp.remove();
    }
  }

  /**
   * Attaches mouse event listeners to citation containers within a message element
   * to display a custom popup with the original raw text.
   */
  private _attachCitationPopupListeners(messageElement: HTMLElement): void {
    if (messageElement.dataset.citationPopupAttached === "true") {
      return;
    }
    messageElement.dataset.citationPopupAttached = "true";
    const citationContainers = messageElement.querySelectorAll(
      ".citation-container",
    );
    citationContainers.forEach((container: Element) => {
      container.addEventListener("mouseenter", async (event: MouseEvent) => {
        const originalQuote = (container as HTMLElement).dataset.originalQuote;
        if (originalQuote) {
          this.citationPopup.textContent = originalQuote;
          this.citationPopup.style.left = `${event.clientX + 10}px`; // カーソルから少しずらす
          this.citationPopup.style.top = `${event.clientY + 10}px`;
          this.citationPopup.style.display = "block";
          return;
        }

        const locatorJson = (container as HTMLElement).dataset.citationLocator;
        if (locatorJson) {
          this.citationPopup.textContent = "引用原文を読み込み中...";
          this.citationPopup.style.left = `${event.clientX + 10}px`;
          this.citationPopup.style.top = `${event.clientY + 10}px`;
          this.citationPopup.style.display = "block";
          try {
            const locator = parsePdfCitationLocator(locatorJson);
            if (!locator) {
              throw new Error("Invalid PDF citation locator.");
            }
            const recovered = await recoverPdfCitationText(locator);
            this.citationPopup.textContent = recovered.isStale
              ? "引用原文を復元できません。PDF本文が引用後に変更されています。"
              : recovered.text;
          } catch {
            Zotero.logError(
              new Error(
                "[Ask My Paper] Failed to recover PDF citation hover text.",
              ),
            );
            this.citationPopup.textContent = "引用原文を復元できませんでした。";
          }
        }
      });

      container.addEventListener("mouseleave", () => {
        this.citationPopup.style.display = "none";
      });

      // マウスが動いてもポップアップ位置を追従させる
      container.addEventListener("mousemove", (event: MouseEvent) => {
        if (this.citationPopup.style.display === "block") {
          this.citationPopup.style.left = `${event.clientX + 10}px`;
          this.citationPopup.style.top = `${event.clientY + 10}px`;
        }
      });
    });
  }
}
