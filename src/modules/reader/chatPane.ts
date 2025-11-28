
import {
  ParentItemFileMetadata,
} from "../../types/chat";
import { ChatSession } from "./chatSession";
import { ChatSessionManager } from "./chatSessionManager";
import { ConversationManager } from "./conversation";
import { UIManager } from "./ui";
import { ReaderItemPaneFactory } from "../readerItemPane";
import { getPref, setPref } from "../../utils/prefs";
import { PREF_CHAT_PANEL_HEIGHT } from "../../utils/constants";

/**
 * Manages the state and behavior of a single chat pane in the Zotero reader.
 */
export class ChatPane {
  public readonly paneId: string;
  public uiElements: { doc: Document; body: HTMLElement; };
  public managers: { uiManager: UIManager };
  public chatSessionManager: ChatSessionManager;
  public zoteroContext: { itemId?: number; actualParentItem?: Zotero.Item | null; };
  public chatData: { activeSession?: ChatSession | null; parentItemFileMetadata?: ParentItemFileMetadata | null; };
  public runtimeState: { eventHandler: (event: CustomEvent) => void; isGeminiRequestInProgress: boolean; };

  // Bound event handlers for cleanup
  private _boundHandleLinkClick!: (e: Event) => void;
  private _boundHandleSendMessage!: () => Promise<void>;
  private _boundHandleEnterKey!: (e: KeyboardEvent) => void;
  private _boundHandleNewChat!: () => Promise<void>;
  private _boundHandleResize!: (e: MouseEvent) => void;

  constructor(body: HTMLElement) {
    this.paneId = Zotero.Utilities.randomString(8);
    body.dataset.paneId = this.paneId;

    const doc = body.ownerDocument;
    if (!doc) {
      throw new Error("Owner document not found for chat pane body.");
    }

    this.uiElements = { doc, body };
    this.managers = undefined as any;
    this.chatSessionManager = undefined as any;
    this.zoteroContext = { itemId: undefined, actualParentItem: null };
    this.chatData = {
      activeSession: null,
      parentItemFileMetadata: null,
    };

    const eventHandler = (event: Event) =>
      this._handleGeminiAction(event as CustomEvent);
    this.runtimeState = {
      eventHandler: eventHandler as (event: CustomEvent) => void,
      isGeminiRequestInProgress: false,
    };

    Zotero.getMainWindow().document.addEventListener(
      "gemini-pdf-action",
      eventHandler
    );
  }

  public async render(item: Zotero.Item) {
    const actualParentItem: Zotero.Item | null =
      item.isAttachment() && item.parentID
        ? await Zotero.Items.getAsync(item.parentID)
        : item;

    if (!this.managers) {
      await this._initializeManagers(actualParentItem);
      this._setupEventListeners(); // Listeners are now set up only once
    }

    if (!this.managers) {
      Zotero.logError(new Error("Managers not initialized in chatPane."));
      return;
    }

    this._initializeUI();
    this._loadConversation();
    this._updateZoteroContext(actualParentItem);
  }

  private async _initializeManagers(actualParentItem: Zotero.Item | null) {
    if (!actualParentItem) {
      Zotero.logError(
        new Error("Cannot initialize managers, no parent item found.")
      );
      return;
    }

    const { doc, body } = this.uiElements;
    const chatMessages = body.querySelector(
      "#chat-messages"
    ) as HTMLDivElement;

    const chatSessionManager = new ChatSessionManager(
      actualParentItem,
      (session) => {
        // onActiveSessionChange
        this.chatData.activeSession = session;
        if (this.managers) {
          this.managers.uiManager.renderChatMessages(session);
          this.managers.uiManager.updateSessionSwitcher();
        }
      }
    );

    const uiManager = new UIManager(doc, body, chatMessages, chatSessionManager);
    uiManager.registerPrefObservers();

    this.managers = { uiManager };
    this.chatSessionManager = chatSessionManager;

    await chatSessionManager.init();
  }

  private _initializeUI() {
    this.managers.uiManager.initModelSelector();
    this.managers.uiManager.initGoogleSearchCheckbox();
    this.managers.uiManager.initIncludeThoughtsCheckbox();
    this.managers.uiManager.initSessionSwitcher();
    this.managers.uiManager.initDeleteButton();
  }

  private _setupEventListeners() {
    const { body } = this.uiElements;
    const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
    const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
    const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
    const chatResizer = body.querySelector("#chat-resizer") as HTMLDivElement;
    const newChatButton = body.querySelector("#new-chat-button") as HTMLButtonElement;

    if (!chatMessages || !chatInput || !sendButton || !chatResizer || !newChatButton) {
      Zotero.logError(new Error("One or more UI elements not found for event listeners."));
      return;
    }

    // Bind handlers and store them for later removal
    this._boundHandleLinkClick = this._handleLinkClick.bind(this);
    // this._boundHandleSendMessage = this._handleSendMessage.bind(this); // もはや使用されないため削除
    this._boundHandleEnterKey = this._handleEnterKey.bind(this);
    this._boundHandleNewChat = this._handleNewChat.bind(this);
    this._boundHandleResize = this._handleResize.bind(this);

    chatMessages.addEventListener("click", this._boundHandleLinkClick);
    sendButton.addEventListener("click", () => {
      const chatInput = this.uiElements.body.querySelector("#chat-input") as HTMLTextAreaElement;
      const messageText = chatInput.value;
      if (messageText.trim() === "") return; // 空メッセージは送信しない

      this._handleSendMessage(messageText, messageText);
      this.managers.uiManager.clearChatInput(); // 送信後にクリア
    });
    chatInput.addEventListener("keydown", this._boundHandleEnterKey);
    newChatButton.addEventListener("click", this._boundHandleNewChat);
    chatResizer.addEventListener("mousedown", this._boundHandleResize);
  }

  private _loadConversation() {
    const activeSession = this.chatSessionManager.getActiveSession();
    this.chatData.activeSession = activeSession;
    if (activeSession) {
      this.managers.uiManager.renderChatMessages(activeSession);
    } else {
      Zotero.logError(new Error("No active session found after init."));
      this.managers.uiManager.addBotMessage(
        "チャットの読み込みに失敗しました。",
        "error-message"
      );
    }
  }

  private _updateZoteroContext(actualParentItem: Zotero.Item | null) {
    if (actualParentItem) {
      this.zoteroContext.itemId = actualParentItem.id;
    } else {
      this.zoteroContext.itemId = undefined;
    }
    Zotero.log(
      `[Gemini PDF] Pane ${this.paneId} onRender: Stored itemId is ${this.zoteroContext.itemId}`
    );
    this.zoteroContext.actualParentItem = actualParentItem;

    const chatMessages = this.uiElements.body.querySelector("#chat-messages") as HTMLDivElement;
    if (chatMessages) {
        const savedHeight = getPref(PREF_CHAT_PANEL_HEIGHT) as number;
        if (savedHeight) {
        chatMessages.style.height = `${savedHeight}px`;
        chatMessages.style.maxHeight = "none";
        }
    }
  }

  private async _ensurePdfContext(): Promise<boolean> {
    if (this.chatData.parentItemFileMetadata) {
      return true;
    }

    if (!this.zoteroContext.actualParentItem) {
      Zotero.logError(new Error("Cannot sync PDF context, no parent item."));
      return false;
    }

    try {
      this.chatData.parentItemFileMetadata =
        await ConversationManager.synchronizePdfContext(
          this.zoteroContext.actualParentItem,
          this.managers.uiManager
        );
      return true;
    } catch (e: any) {
      Zotero.logError(
        new Error(`Error synchronizing PDFs: ${e.message || String(e)}`)
      );
      this.managers.uiManager.addBotMessage(
        `Error synchronizing PDFs: ${e.message || String(e)}`,
        "error-message"
      );
      return false;
    }
  }

  private _handleLinkClick(e: Event) {
    const target = e.target as HTMLElement;
    const link = target.closest("a[href]");
    if (link) {
      const url = link.getAttribute("href");
      if (url && (url.startsWith("http:") || url.startsWith("https:"))) {
        e.preventDefault();
        e.stopPropagation();
        Zotero.launchURL(url);
      }
    }
  }

  private _handleEnterKey(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const chatInput = this.uiElements.body.querySelector("#chat-input") as HTMLTextAreaElement;
      const messageText = chatInput.value;
      if (messageText.trim() === "") return;
      this._handleSendMessage(messageText, messageText); // messageText と promptText は同じ
      this.managers.uiManager.clearChatInput(); // 送信後にクリア
    }
  }

  /**
   * ユーザーからのメッセージまたは生成されたプロンプトを処理し、Gemini APIに送信します。
   * UIの更新、セッション履歴への追加、API通信、そしてエラーハンドリングを担当します。
   *
   * @param messageText UIに表示およびセッション履歴に保存するメッセージテキスト。
   *                    通常はユーザーの入力そのままか、PDFアクション時の短い要約。
   * @param promptText  Gemini APIに送信する実際のプロンプトテキスト。
   *                    messageTextと同じであることもあれば、PDFのコンテキストなど追加情報を含むこともある。
   */
  private async _handleSendMessage(messageText: string, promptText: string) {
    Zotero.log(`[Gemini PDF] _handleSendMessage called. messageText: "${messageText}", promptText: "${promptText}"`);
    
    // 引数として渡された messageText を直接利用
    if (messageText.trim() === "") {
      Zotero.log(`[Gemini PDF] _handleSendMessage: messageText is empty. Returning.`);
      return;
    }

    if (this.runtimeState.isGeminiRequestInProgress) {
      Zotero.debug(`[Gemini PDF] Request in progress. Skipping message send.`);
      return;
    }

    const activeSession = this.chatSessionManager.getActiveSession();

    if (!this.zoteroContext.actualParentItem || !activeSession) {
      Zotero.logError(new Error("Cannot send message: missing parent item or active session."));
      return;
    }

    Zotero.log(`[Gemini PDF] _handleSendMessage: Setting isGeminiRequestInProgress to true.`);
    this.runtimeState.isGeminiRequestInProgress = true;
    ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(this.paneId, true);
    this.managers.uiManager.setInputsDisabled(true);
    Zotero.log(`[Gemini PDF] _handleSendMessage: Inputs disabled.`);

    if (!await this._ensurePdfContext()) {
      Zotero.log(`[Gemini PDF] _handleSendMessage: PDF context not ensured. Returning.`);
      this.runtimeState.isGeminiRequestInProgress = false;
      ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(this.paneId, false);
      this.managers.uiManager.setInputsDisabled(false);
      return;
    }
    
    // Add user message to UI and history
    Zotero.log(`[Gemini PDF] _handleSendMessage: Adding user message to UI: "${messageText}"`);
    this.managers.uiManager.addUserMessage(messageText);
    // chatInput.value のクリアは呼び出し元で行う

    Zotero.log(`[Gemini PDF] _handleSendMessage: Adding user message to active session.`);
    activeSession.addUserMessage(messageText);
    Zotero.log(`[Gemini PDF] _handleSendMessage: Saving active session.`);
    await activeSession.save();

    const botMessageDiv = this.managers.uiManager.addBotMessage("Typing...", "bot-message");
    Zotero.log(`[Gemini PDF] _handleSendMessage: Displaying "Typing..." message.`);

    try {
      if (!this.chatData.parentItemFileMetadata) {
        Zotero.logError(new Error("PDF metadata is not available after sync."));
        throw new Error("PDF metadata is not available after sync.");
      }

      Zotero.log(`[Gemini PDF] _handleSendMessage: Sending message to active session.`);
      const { responseText, thoughts, groundingMetadata } = await activeSession.sendMessage(promptText, this.chatData.parentItemFileMetadata);
      Zotero.log(`[Gemini PDF] _handleSendMessage: Received response from active session. responseText length: ${responseText?.length}`);

      this.managers.uiManager.updateBotMessage(botMessageDiv, responseText, thoughts, groundingMetadata);
      Zotero.log(`[Gemini PDF] _handleSendMessage: Updating bot message in UI.`);

    } catch (error: any) {
      const errorMessage = error.message || String(error);
      Zotero.logError(new Error(`[Gemini PDF] _handleSendMessage: Error during message sending: ${errorMessage}`));
      this.managers.uiManager.updateBotMessage(botMessageDiv, `Error: ${errorMessage}`);
    } finally {
      Zotero.log(`[Gemini PDF] _handleSendMessage: Finally block executed.`);
      this.runtimeState.isGeminiRequestInProgress = false;
      ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(this.paneId, false);
      this.managers.uiManager.setInputsDisabled(false);
      Zotero.log(`[Gemini PDF] _handleSendMessage: Inputs re-enabled.`);
      // chatInput.focus(); は呼び出し元で行う、または UIManager.clearChatInput に含める
    }
  }

  private async _handleNewChat() {
    const newSession = await this.chatSessionManager?.createSession(
      "新しいチャット"
    );
    if (newSession) {
      this.managers.uiManager.updateSessionSwitcher();
      this.managers.uiManager.clearChatInput(); // ここを修正
      this.chatData.parentItemFileMetadata = null;
      Zotero.log(
        `[Gemini PDF] New chat session started with ID: ${newSession.id}`
      );
      // 新しいセッションがアクティブになったかを確認
      Zotero.log(`[Gemini PDF] After _handleNewChat, active session ID: ${this.chatSessionManager?.getActiveSession()?.id}`);
    }
  }

  private _handleResize(e: MouseEvent) {
    e.preventDefault();
    const { doc, body } = this.uiElements;
    const startY = e.clientY;
    const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
    const startHeight = chatMessages.clientHeight;
    const chatContainer = body.querySelector(".chat-container") as HTMLDivElement;
    const chatInputArea = body.querySelector(".chat-input-area") as HTMLDivElement;
    const resizer = body.querySelector(".chat-resizer") as HTMLDivElement; // セレクタをIDからクラスへ変更

    const doDrag = (e: MouseEvent) => {
      const newHeight = startHeight + (e.clientY - startY);
      const minHeight = 50;
      if (chatContainer && chatInputArea && resizer) {
        const maxHeight =
          chatContainer.clientHeight -
          chatInputArea.clientHeight -
          resizer.clientHeight -
          30;
        if (newHeight > minHeight && newHeight < maxHeight) {
          chatMessages.style.height = `${newHeight}px`;
          chatMessages.style.maxHeight = "none";
        }
      }
    };

    const stopDrag = () => {
      doc.removeEventListener("mousemove", doDrag, false);
      doc.removeEventListener("mouseup", stopDrag, false);
      setPref(PREF_CHAT_PANEL_HEIGHT, chatMessages.clientHeight);
    };

    doc.addEventListener("mousemove", doDrag, false);
    doc.addEventListener("mouseup", stopDrag, false);
  }

  private async _handleGeminiAction(event: CustomEvent) {
    if (
      !this.zoteroContext.itemId ||
      this.zoteroContext.itemId !== event.detail.itemId
    ) {
      return;
    }

    Zotero.log(
      `[Gemini PDF] Action event received for matching item ${this.zoteroContext.itemId}`
    );
    Zotero.log(`[Gemini PDF] _handleGeminiAction: event.detail: ${JSON.stringify(event.detail)}`);

    const { fullPrompt, summaryText } = event.detail;
    Zotero.log(`[Gemini PDF] _handleGeminiAction: fullPrompt: ${fullPrompt}, summaryText: ${summaryText}`);
    
    // For now, we reuse the general send message handler
    await this._handleSendMessage(summaryText, fullPrompt);
  }

  public destroy() {
    // Remove global listener
    if (this.runtimeState.eventHandler) {
      Zotero.getMainWindow().document.removeEventListener(
        "gemini-pdf-action",
        this.runtimeState.eventHandler
      );
    }

    // Remove local listeners
    const { body } = this.uiElements;
    const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
    const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
    const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
    const chatResizer = body.querySelector(".chat-resizer") as HTMLDivElement;
    const newChatButton = body.querySelector("#new-chat-button") as HTMLButtonElement;

    if (chatMessages && this._boundHandleLinkClick) {
      chatMessages.removeEventListener("click", this._boundHandleLinkClick);
    }
    if (sendButton && this._boundHandleSendMessage) {
      sendButton.removeEventListener("click", this._boundHandleSendMessage);
    }
    if (chatInput && this._boundHandleEnterKey) {
      chatInput.removeEventListener("keydown", this._boundHandleEnterKey);
    }
    if (newChatButton && this._boundHandleNewChat) {
      newChatButton.removeEventListener("click", this._boundHandleNewChat);
    }
    if (chatResizer && this._boundHandleResize) {
      chatResizer.removeEventListener("mousedown", this._boundHandleResize);
    }
  }
}
