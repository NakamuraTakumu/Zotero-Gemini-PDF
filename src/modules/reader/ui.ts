import { getPref, setPref } from "../../utils/prefs";
import { PREF_MODEL_LIST, PREF_SELECTED_MODEL, PREF_USE_GOOGLE_SEARCH, PREF_INCLUDE_THOUGHTS } from "../../utils/constants";
import { ChatSessionHistory } from "../../types/chat"; // Import ChatSessionHistory type
import { ChatManager } from "./chat"; // Import ChatManager type

export class UIManager {
  private doc: Document;
  private body: HTMLElement;
  private chatMessages: HTMLDivElement;
  private prefObserverKeys: symbol[] = [];
  private chatManager: ChatManager; // Add chatManager property

  constructor(doc: Document, body: HTMLElement, chatMessages: HTMLDivElement, chatManager: ChatManager) {
    this.doc = doc;
    this.body = body;
    this.chatMessages = chatMessages;
    this.chatManager = chatManager; // Assign chatManager
  }

  registerPrefObservers() {
    const modelObserverKey = Zotero.Prefs.registerObserver(
      `extensions.zotero.GeminiPDF.${PREF_SELECTED_MODEL}`,
      () => {
        const geminiModelSelect = this.body.querySelector("#gemini-model-select") as HTMLSelectElement;
        if (geminiModelSelect) {
          const selectedModel = getPref(PREF_SELECTED_MODEL) || "";
          geminiModelSelect.value = selectedModel;
          Zotero.log(`[Gemini PDF] Pref observer updated model selection to: ${selectedModel}`);
        }
      }
    );
    this.prefObserverKeys.push(modelObserverKey);

    const searchObserverKey = Zotero.Prefs.registerObserver(
      `extensions.zotero.GeminiPDF.${PREF_USE_GOOGLE_SEARCH}`,
      () => {
        const useGoogleSearchCheckbox = this.body.querySelector("#use-google-search-checkbox") as HTMLInputElement;
        if (useGoogleSearchCheckbox) {
          const useGoogleSearch = getPref(PREF_USE_GOOGLE_SEARCH) as boolean;
          useGoogleSearchCheckbox.checked = useGoogleSearch;
          Zotero.log(`[Gemini PDF] Pref observer updated Google Search to: ${useGoogleSearch}`);
        }
      }
    );
    this.prefObserverKeys.push(searchObserverKey);
  }

  unregisterPrefObservers() {
    this.prefObserverKeys.forEach(key => Zotero.Prefs.unregisterObserver(key));
    Zotero.log("[Gemini PDF] Unregistered preference observers.");
    this.prefObserverKeys = [];
  }

  initModelSelector() {
    const geminiModelSelect = this.body.querySelector("#gemini-model-select") as HTMLSelectElement;
    if (!geminiModelSelect) return;

    const availableModelsString = getPref(PREF_MODEL_LIST) || "";
    const availableModels = availableModelsString.split(',').map(m => m.trim()).filter(m => m.length > 0);
    const selectedModel = getPref(PREF_SELECTED_MODEL) || "";
    Zotero.log(`[Gemini PDF] UI: Initializing model selector. Saved PREF_SELECTED_MODEL value is: '${selectedModel}'.`);
    Zotero.log(`[Gemini PDF] UI: Currently selected model from preferences: '${selectedModel}'.`);


    geminiModelSelect.innerHTML = "";
    availableModels.forEach(modelName => {
      const option = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "option") as HTMLOptionElement;
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
      Zotero.log(`[Gemini PDF] UI: Immediately after setPref, getPref returns: ${retrievedValue}.`);
    });
  }

  initGoogleSearchCheckbox() {
    const useGoogleSearchCheckbox = this.body.querySelector("#use-google-search-checkbox") as HTMLInputElement;
    if (!useGoogleSearchCheckbox) return; // Added null check

    const useGoogleSearch = getPref(PREF_USE_GOOGLE_SEARCH) as boolean;
    Zotero.log(`[Gemini PDF] UI: Initializing Google Search checkbox. Saved PREF_USE_GOOGLE_SEARCH value is: ${useGoogleSearch}.`);
    useGoogleSearchCheckbox.checked = useGoogleSearch;

    useGoogleSearchCheckbox.addEventListener("change", (e) => {
      const newValue = (e.target as HTMLInputElement).checked;
      setPref(PREF_USE_GOOGLE_SEARCH, newValue);
      Zotero.log(`[Gemini PDF] UI: Use Google Search changed to: ${newValue}.`);
    });
  }

  initIncludeThoughtsCheckbox() {
    const includeThoughtsCheckbox = this.body.querySelector("#include-thoughts-checkbox") as HTMLInputElement;
    if (!includeThoughtsCheckbox) return;

    const includeThoughts = getPref(PREF_INCLUDE_THOUGHTS) as boolean;
    Zotero.log(`[Gemini PDF] UI: Initializing Include Thoughts checkbox. Saved PREF_INCLUDE_THOUGHTS value is: ${includeThoughts}.`);
    includeThoughtsCheckbox.checked = includeThoughts;

    includeThoughtsCheckbox.addEventListener("change", (e) => {
      const newValue = (e.target as HTMLInputElement).checked;
      setPref(PREF_INCLUDE_THOUGHTS, newValue);
      Zotero.log(`[Gemini PDF] UI: Include Thoughts changed to: ${newValue}.`);
    });
  }

  initSessionSwitcher() {
    const sessionSwitcher = this.body.querySelector("#chat-session-switcher") as HTMLSelectElement;
    if (!sessionSwitcher) return;

    this.updateSessionSwitcher(); // Populate with initial data

    sessionSwitcher.onchange = (e) => {
      const newSessionId = (e.target as HTMLSelectElement).value;
      if (newSessionId) {
        this.chatManager.switchSession(newSessionId);
      }
    };
  }

  updateSessionSwitcher() {
    const sessionSwitcher = this.body.querySelector("#chat-session-switcher") as HTMLSelectElement;
    if (!sessionSwitcher) return;
    
    const sessions = this.chatManager.getAllSessions();
    const activeSession = this.chatManager.getActiveSession();

    const selectedValue = sessionSwitcher.value;
    sessionSwitcher.innerHTML = "";

    sessions.forEach(session => {
      const option = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "option") as HTMLOptionElement;
      option.value = session.metadata.chatId;
      option.textContent = session.metadata.chatTitle;
      sessionSwitcher.appendChild(option);
    });

    if (activeSession) {
      sessionSwitcher.value = activeSession.metadata.chatId;
    } else if (sessions.find(s => s.metadata.chatId === selectedValue)) {
      sessionSwitcher.value = selectedValue;
    }
  }

  initDeleteButton() {
    const deleteButton = this.body.querySelector("#delete-session-button") as HTMLButtonElement;
    if (!deleteButton) return;

    deleteButton.onclick = async () => {
      const activeSession = this.chatManager.getActiveSession();
      if (!activeSession) {
        Zotero.debug("[Gemini PDF] No active session to delete.");
        return;
      }

      const confirmDelete = Zotero.getMainWindow().confirm(
        `チャット「${activeSession.metadata.chatTitle}」を削除しますか？この操作は元に戻せません。`
      );

      if (confirmDelete) {
        Zotero.debug(`[Gemini PDF] Deleting session: ${activeSession.metadata.chatTitle}`);
        const success = await this.chatManager.deleteActiveSession();
        if (success) {
          // ドロップダウンの更新はdeleteActiveSession内のonActiveSessionChangeコールバックがトリガーする
          // ここで直接updateSessionSwitcher()を呼ぶ必要はない
        } else {
          Zotero.logError(new Error("[Gemini PDF] Failed to delete session."));
        }
      }
    };
  }

  _renderChatMessages(conversation: ChatSessionHistory) {
    this.chatMessages.innerHTML = "";
    for (const message of conversation.history) {
      const messageDiv = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLDivElement;
      messageDiv.className = `message ${message.role}-message`;
      let messageHtml = this.chatManager.renderMarkdown(message.parts[0].text);
      if (message.role === 'model' && message.groundingMetadata) {
        let sources = '';
        if (message.groundingMetadata.groundingChunks && message.groundingMetadata.groundingChunks.length > 0) {
          sources = message.groundingMetadata.groundingChunks.map((chunk: any, index: number) => {
            if (chunk.web) {
              return `<a href="${chunk.web.uri}" target="_blank">[${index + 1}] ${chunk.web.title}</a>`;
            }
            return null;
          }).filter(Boolean).join('');
        } else if (message.groundingMetadata.retrievedReferences && message.groundingMetadata.retrievedReferences.length > 0) {
          sources = message.groundingMetadata.retrievedReferences.map((ref: any, index: number) =>
            `<a href="${ref.uri}" target="_blank">[${index + 1}] ${ref.title}</a>`
          ).join('');
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

  addBotMessage = (html: string, className: string = 'bot-message'): HTMLDivElement => {
    const div = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLDivElement;
    div.className = `message ${className}`;
    div.innerHTML = html;
    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    return div;
  };

  updateBotMessage = (element: HTMLDivElement, html: string) => {
    element.innerHTML = html;
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  };
}