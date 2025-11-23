import { getPref, setPref } from "../../utils/prefs";
import { PREF_MODEL_LIST, PREF_SELECTED_MODEL, PREF_USE_GOOGLE_SEARCH } from "../../utils/constants";

export class UIManager {
  private doc: Document;
  private chatMessages: HTMLDivElement;

  constructor(doc: Document, chatMessages: HTMLDivElement) {
    this.doc = doc;
    this.chatMessages = chatMessages;
  }

  initModelSelector() {
    const geminiModelSelect = this.chatMessages.ownerDocument!.querySelector("#gemini-model-select") as HTMLSelectElement;
    if (!geminiModelSelect) return;

    const availableModelsString = getPref(PREF_MODEL_LIST) || "";
    const availableModels = availableModelsString.split(',').map(m => m.trim()).filter(m => m.length > 0);
    const selectedModel = getPref(PREF_SELECTED_MODEL) || "";
    Zotero.log(`[Gemini PDF] UI: Initializing model selector. Saved PREF_SELECTED_MODEL value is: '${selectedModel}'.`);
    Zotero.log(`[Gemini PDF] UI: Initializing model selector. Saved PREF_MODEL_LIST value is: '${availableModelsString}'.`);


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
    const useGoogleSearchCheckbox = this.chatMessages.ownerDocument!.querySelector("#use-google-search-checkbox") as HTMLInputElement;
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