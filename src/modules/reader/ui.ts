import { getPref, setPref } from "../../utils/prefs";
import {
  PREF_MODEL_LIST,
  PREF_SELECTED_MODEL,
  PREF_USE_GOOGLE_SEARCH,
  PREF_INCLUDE_THOUGHTS,
} from "../../utils/constants";
import { ChatSessionHistory } from "../../types/chat";
import { ChatSessionManager } from "./chatSessionManager";
import { ChatSession } from "./chatSession";
import MarkdownIt from "markdown-it";
import createDOMPurify from "dompurify";
import markdownItKatex from "@vscode/markdown-it-katex";
import markdownItContainer from "markdown-it-container";
import type { Token } from "markdown-it";

// Helper for rendering markdown (moved from chat.ts)
const initMarkdownRenderer = (window: Window) => {
  const DOMPurify = createDOMPurify(window as any); // Cast window to any

  // Handle CJS/ESM interop issue with the imported module
  const katexPlugin =
    typeof markdownItKatex === "function"
      ? markdownItKatex
      : (markdownItKatex as any).default;

  const md = new MarkdownIt({ xhtmlOut: true })
    .use(markdownItContainer, "citation", {
      validate: function (params: string) {
        return params.trim().match(/^citation\s+(.*)\|(.+)/);
      },
      render: function (tokens: Token[], idx: number) {
        if (tokens[idx].nesting === 1) {
          const m = tokens[idx].info.trim().match(/^citation\s+(.*)\|(.+)/);
          if (m) {
            const source = md.utils.escapeHtml(m[1].trim());
            const originalQuote = md.utils.escapeHtml(m[2].trim());
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
    })
    .use(katexPlugin, {
      throwOnError: false,
      errorColor: "#cc0000",
      output: "mathml",
      strict: false,
    });
  // ▼▼▼ ここを追加 ▼▼▼
  // 既存の数式レンダラーを取得（なければデフォルト処理）
  // const oldMathBlock = md.renderer.rules.math_block || function(tokens, idx) {
  //   return '<div class="katex-block">' + tokens[idx].content + '</div>';
  // };

  // // 数式ブロックのレンダラーを「スクロール用divで包む処理」で上書きする
  // md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
  //   const html = oldMathBlock(tokens, idx, options, env, self);
  //   // ここで強制的に div class="math-scroll" で包む
  //   return `<div class="math-scroll">${html}</div>`;
  // };
  return (text: string): string => {
    const sanitizedText = DOMPurify.sanitize(text, {
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
        "span",
        "svg",
        "path",
        "g",
        "rect",
        "use",
      ],
      ADD_ATTR: [
        "xmlns",
        "encoding",
        "class",
        "aria-hidden",
        "width",
        "height",
        "viewBox",
        "x",
        "y",
        "transform",
        "fill",
        "stroke",
        "stroke-width",
        "d",
        "style",
        "fill-opacity",
      ],
    });
    return md.render(sanitizedText);
  };
};

export class UIManager {
  private doc: Document;
  private body: HTMLElement;
  private chatMessages: HTMLDivElement;
  private chatInput: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private prefObserverKeys: symbol[] = [];
  private chatSessionManager: ChatSessionManager;
  public renderMarkdown: (text: string) => string;

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
    this.renderMarkdown = initMarkdownRenderer(doc.defaultView as Window);
  }

  registerPrefObservers() {
    const modelObserverKey = Zotero.Prefs.registerObserver(
      `extensions.zotero.GeminiPDF.${PREF_SELECTED_MODEL}`,
      () => {
        const geminiModelSelect = this.body.querySelector(
          "#gemini-model-select",
        ) as HTMLSelectElement;
        if (geminiModelSelect) {
          const selectedModel = getPref(PREF_SELECTED_MODEL) || "";
          geminiModelSelect.value = selectedModel;
          Zotero.log(
            `[Gemini PDF] Pref observer updated model selection to: ${selectedModel}`,
          );
        }
      },
    );
    this.prefObserverKeys.push(modelObserverKey);

    const searchObserverKey = Zotero.Prefs.registerObserver(
      `extensions.zotero.GeminiPDF.${PREF_USE_GOOGLE_SEARCH}`,
      () => {
        const useGoogleSearchCheckbox = this.body.querySelector(
          "#use-google-search-checkbox",
        ) as HTMLInputElement;
        if (useGoogleSearchCheckbox) {
          const useGoogleSearch = getPref(PREF_USE_GOOGLE_SEARCH) as boolean;
          useGoogleSearchCheckbox.checked = useGoogleSearch;
          Zotero.log(
            `[Gemini PDF] Pref observer updated Google Search to: ${useGoogleSearch}`,
          );
        }
      },
    );
    this.prefObserverKeys.push(searchObserverKey);
  }

  private unregisterPrefObservers() {
    this.prefObserverKeys.forEach((key) =>
      Zotero.Prefs.unregisterObserver(key),
    );
    Zotero.log("[Gemini PDF] Unregistered preference observers.");
    this.prefObserverKeys = [];
  }

  initModelSelector() {
    const geminiModelSelect = this.body.querySelector(
      "#gemini-model-select",
    ) as HTMLSelectElement;
    if (!geminiModelSelect) return;

    const availableModelsString = getPref(PREF_MODEL_LIST) || "";
    const availableModels = availableModelsString
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    const selectedModel = getPref(PREF_SELECTED_MODEL) || "";
    Zotero.log(
      `[Gemini PDF] UI: Initializing model selector. Saved PREF_SELECTED_MODEL value is: '${selectedModel}'.`,
    );
    Zotero.log(
      `[Gemini PDF] UI: Currently selected model from preferences: '${selectedModel}'.`,
    );

    geminiModelSelect.innerHTML = "";
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
      geminiModelSelect.appendChild(option);
    });

    geminiModelSelect.addEventListener("change", (e) => {
      const newValue = (e.target as HTMLSelectElement).value;
      Zotero.log(`[Gemini PDF] UI: Model selection changed to: ${newValue}.`);
      setPref(PREF_SELECTED_MODEL, newValue);
      const retrievedValue = getPref(PREF_SELECTED_MODEL);
      Zotero.log(
        `[Gemini PDF] UI: Immediately after setPref, getPref returns: ${retrievedValue}.`,
      );
    });
  }

  initGoogleSearchCheckbox() {
    const useGoogleSearchCheckbox = this.body.querySelector(
      "#use-google-search-checkbox",
    ) as HTMLInputElement;
    if (!useGoogleSearchCheckbox) return; // Added null check

    const useGoogleSearch = getPref(PREF_USE_GOOGLE_SEARCH) as boolean;
    Zotero.log(
      `[Gemini PDF] UI: Initializing Google Search checkbox. Saved PREF_USE_GOOGLE_SEARCH value is: ${useGoogleSearch}.`,
    );
    useGoogleSearchCheckbox.checked = useGoogleSearch;

    useGoogleSearchCheckbox.addEventListener("change", (e) => {
      const newValue = (e.target as HTMLInputElement).checked;
      setPref(PREF_USE_GOOGLE_SEARCH, newValue);
      Zotero.log(`[Gemini PDF] UI: Use Google Search changed to: ${newValue}.`);
    });
  }

  initIncludeThoughtsCheckbox() {
    const includeThoughtsCheckbox = this.body.querySelector(
      "#include-thoughts-checkbox",
    ) as HTMLInputElement;
    if (!includeThoughtsCheckbox) return;

    const includeThoughts = getPref(PREF_INCLUDE_THOUGHTS) as boolean;
    Zotero.log(
      `[Gemini PDF] UI: Initializing Include Thoughts checkbox. Saved PREF_INCLUDE_THOUGHTS value is: ${includeThoughts}.`,
    );
    includeThoughtsCheckbox.checked = includeThoughts;

    includeThoughtsCheckbox.addEventListener("change", (e) => {
      const newValue = (e.target as HTMLInputElement).checked;
      setPref(PREF_INCLUDE_THOUGHTS, newValue);
      Zotero.log(`[Gemini PDF] UI: Include Thoughts changed to: ${newValue}.`);
    });
  }

  initSessionSwitcher() {
    const sessionSwitcher = this.body.querySelector(
      "#chat-session-switcher",
    ) as HTMLSelectElement;
    if (!sessionSwitcher) return;

    this.updateSessionSwitcher(); // Populate with initial data

    sessionSwitcher.onchange = (e) => {
      const newSessionId = (e.target as HTMLSelectElement).value;
      if (newSessionId) {
        this.chatSessionManager.switchSession(newSessionId);
      }
    };
  }

  updateSessionSwitcher() {
    const sessionSwitcher = this.body.querySelector("#chat-session-switcher") as HTMLSelectElement;
    if (!sessionSwitcher) return;
    
    const sessions = this.chatSessionManager.getAllSessions();
    const activeSession = this.chatSessionManager.getActiveSession();

    Zotero.log(`[Gemini PDF] UIManager.updateSessionSwitcher: Called. Active Session ID: ${activeSession?.id}, Title: "${activeSession?.title}"`);

    sessionSwitcher.innerHTML = "";

    sessions.forEach(session => {
      const option = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "option") as HTMLOptionElement;
      option.value = session.id;
      option.textContent = session.title;
      sessionSwitcher.appendChild(option);
      Zotero.log(`[Gemini PDF] UIManager.updateSessionSwitcher: Added option for Session ID: ${session.id}, Title: "${session.title}"`);
    });

    if (activeSession) {
      sessionSwitcher.value = activeSession.id;
      Zotero.log(`[Gemini PDF] UIManager.updateSessionSwitcher: Set sessionSwitcher.value to: ${sessionSwitcher.value}`);
    } else {
      Zotero.log(`[Gemini PDF] UIManager.updateSessionSwitcher: No active session to set.`);
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
        Zotero.debug("[Gemini PDF] No active session to delete.");
        return;
      }

      const confirmDelete = Zotero.getMainWindow().confirm(
        `チャット「${activeSession.title}」を削除しますか？この操作は元に戻せません。`,
      );

      if (confirmDelete) {
        Zotero.debug(`[Gemini PDF] Deleting session: ${activeSession.title}`);
        const success = await this.chatSessionManager.deleteActiveSession();
        if (success) {
          // ドロップダウンの更新はdeleteActiveSession内のonActiveSessionChangeコールバックがトリガーする
          // ここで直接updateSessionSwitcher()を呼ぶ必要はない
        } else {
          Zotero.logError(new Error("[Gemini PDF] Failed to delete session."));
        }
      }
    };
  }

  renderChatMessages(session: ChatSession | null) {
    this.chatMessages.innerHTML = "";
    if (!session) {
      return;
    }
    for (const message of session.history.history) {
      const messageDiv = this.doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLDivElement;
      messageDiv.className = `message ${message.role}-message`;
      let messageHtml = this.renderMarkdown(message.parts[0].text);
      if (message.role === "model" && message.groundingMetadata) {
        let sources = "";
        if (
          message.groundingMetadata.groundingChunks &&
          message.groundingMetadata.groundingChunks.length > 0
        ) {
          sources = message.groundingMetadata.groundingChunks
            .map((chunk: any, index: number) => {
              if (chunk.web) {
                return `<a href="${chunk.web.uri}" target="_blank">[${index + 1}] ${chunk.web.title}</a>`;
              }
              return null;
            })
            .filter(Boolean)
            .join("");
        } else if (
          message.groundingMetadata.retrievedReferences &&
          message.groundingMetadata.retrievedReferences.length > 0
        ) {
          sources = message.groundingMetadata.retrievedReferences
            .map(
              (ref: any, index: number) =>
                `<a href="${ref.uri}" target="_blank">[${index + 1}] ${ref.title}</a>`,
            )
            .join("");
        }
        if (sources) {
          messageHtml += `<div class="sources-container"><b>参照元:</b>${sources}</div>`;
        }
      }
      messageDiv.innerHTML = messageHtml;
      this.chatMessages.appendChild(messageDiv);
    }
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  addUserMessage(text: string): void {
    const userMessageDiv = this.doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    userMessageDiv.className = "message user-message";
    userMessageDiv.innerHTML = this.renderMarkdown(text);
    this.chatMessages.appendChild(userMessageDiv);
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
    div.innerHTML = html;
    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    return div;
  };

  updateBotMessage = (
    element: HTMLDivElement,
    responseText: string,
    thoughts?: string[],
    groundingMetadata?: any,
  ) => {
    let messageHtml = this.renderMarkdown(responseText || "No response.");

    if (thoughts && thoughts.length > 0) {
      const thoughtsHtml = thoughts
        .map((t) => `<div class="thought">${this.renderMarkdown(t)}</div>`)
        .join("");
      messageHtml =
        `<details class="thoughts-container"><summary>思考プロセスを表示</summary>${thoughtsHtml}</details>` +
        messageHtml;
    }

    if (groundingMetadata) {
      let sources = "";
      if (
        groundingMetadata.groundingChunks &&
        groundingMetadata.groundingChunks.length > 0
      ) {
        sources = groundingMetadata.groundingChunks
          .map((chunk: any, index: number) => {
            if (chunk.web) {
              return `<a href="${chunk.web.uri}" target="_blank">[${index + 1}] ${chunk.web.title}</a>`;
            }
            return null;
          })
          .filter(Boolean)
          .join("");
      } else if (
        groundingMetadata.retrievedReferences &&
        groundingMetadata.retrievedReferences.length > 0
      ) {
        sources = groundingMetadata.retrievedReferences
          .map(
            (ref: any, index: number) =>
              `<a href="${ref.uri}" target="_blank">[${index + 1}] ${ref.title}</a>`,
          )
          .join("");
      }

      if (sources) {
        messageHtml += `<div class="sources-container"><b>参照元:</b>${sources}</div>`;
      }
    }
    element.innerHTML = messageHtml;
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  };

  setInputsDisabled(disabled: boolean): void {
    this.chatInput.disabled = disabled;
    this.sendButton.disabled = disabled;
  }

  clearChatInput(): void {
    this.chatInput.value = "";
    this.chatInput.focus();
  }
}
