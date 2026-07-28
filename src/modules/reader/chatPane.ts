import { ParentItemFileMetadata } from "../../types/chat";
import { ChatSession } from "./chatSession";
import { ChatSessionManager } from "./chatSessionManager";
import { UIManager } from "./ui";
import { ReaderItemPaneFactory } from "../readerItemPane";
import { getPref, setPref } from "../../utils/prefs";
import { PREF_CHAT_PANEL_HEIGHT } from "../../utils/constants";
import { PdfFileSyncManager } from "./pdfSyncManager";
import GlobalChatManager from "../globalChatManager"; // Import GlobalChatManager
import { SendMessageUseCase } from "./sendMessageUseCase";

/**
 * Manages the state and behavior of a single chat pane in the Zotero reader.
 */
export class ChatPane {
  public readonly paneId: string;
  public uiElements: { doc: Document; body: HTMLElement };
  public managers: { uiManager: UIManager };
  public chatSessionManager: ChatSessionManager;
  public zoteroContext: {
    itemId?: number;
    actualParentItem?: Zotero.Item | null;
  };
  private parentItemFileMetadata: ParentItemFileMetadata | null;
  public runtimeState: {
    eventHandler: (event: CustomEvent) => void;
    isLlmRequestInProgress: boolean;
  };
  private pdfFileSyncManager: PdfFileSyncManager;
  private sendMessageUseCase?: SendMessageUseCase;

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

    this.pdfFileSyncManager = new PdfFileSyncManager();
    this.uiElements = { doc, body };
    this.managers = undefined as any;
    this.chatSessionManager = undefined as any;
    this.zoteroContext = { itemId: undefined, actualParentItem: null };
    this.parentItemFileMetadata = null;

    const eventHandler = (event: Event) =>
      this._handleAskMyPaperAction(event as CustomEvent);
    this.runtimeState = {
      eventHandler: eventHandler as (event: CustomEvent) => void,
      isLlmRequestInProgress: false,
    };

    Zotero.getMainWindow().document.addEventListener(
      "ask-my-paper-action",
      eventHandler,
    );
  }

  public async render(item: Zotero.Item) {
    Zotero.log(`[Ask My Paper] ChatPane.render called for item: ${item.id}`);
    const actualParentItem: Zotero.Item | null =
      item.isAttachment() && item.parentID
        ? await Zotero.Items.getAsync(item.parentID)
        : item;

    // Ensure chatSessionManager is initialized only once per pane instance
    if (!this.chatSessionManager) {
      await this._initializeManagers(actualParentItem);
      this._setupEventListeners(); // Listeners are now set up only once
    }

    if (!this.chatSessionManager) {
      Zotero.logError(
        new Error("ChatSessionManager not initialized in chatPane."),
      );
      return;
    }

    this._initializeUI();
    this._loadConversation();
    this._updateZoteroContext(actualParentItem);
  }

  private async _initializeManagers(actualParentItem: Zotero.Item | null) {
    Zotero.log(`[Ask My Paper] ChatPane._initializeManagers called.`);
    if (!actualParentItem) {
      Zotero.logError(
        new Error("Cannot initialize managers, no parent item found."),
      );
      return;
    }

    const { doc, body } = this.uiElements;
    const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;

    if (!addon.data.globalChatManager) {
      throw new Error("GlobalChatManager not initialized on addon.data.");
    }

    const chatSessionManager = new ChatSessionManager(
      actualParentItem,
      addon.data.globalChatManager, // Pass globalChatManager
      {
        rerenderChatMessages: (session: ChatSession | null) => {
          if (this.managers) {
            this.managers.uiManager.renderChatMessages(session);
          }
        },
        rerenderSwitcher: () => {
          if (this.managers) {
            this.managers.uiManager.renderSessionSwitcherList();
            this.managers.uiManager.updateSessionSwitcherSelection();
          }
        },
      },
    );

    const uiManager = new UIManager(
      doc,
      body,
      chatMessages,
      chatSessionManager,
    );
    uiManager.registerPrefObservers();

    this.managers = { uiManager };
    this.chatSessionManager = chatSessionManager;
    this.sendMessageUseCase = new SendMessageUseCase({
      paneId: this.paneId,
      getParentItem: () => this.zoteroContext.actualParentItem,
      getIsRequestInProgress: () => this.runtimeState.isLlmRequestInProgress,
      setIsRequestInProgress: (isRequestInProgress) => {
        this.runtimeState.isLlmRequestInProgress = isRequestInProgress;
      },
      dispatchRequestStatusChanged:
        ReaderItemPaneFactory.dispatchRequestStatusChangedEvent,
      uiManager,
      chatSessionManager,
      pdfFileSyncManager: this.pdfFileSyncManager,
    });

    await chatSessionManager.init();
  }

  private _initializeUI() {
    this.managers.uiManager.initProviderSelector();
    this.managers.uiManager.initModelSelector();
    this.managers.uiManager.initWebSearchCheckbox();
    this.managers.uiManager.initReasoningModeSelector();
    this.managers.uiManager.initSessionSwitcher();
    this.managers.uiManager.initDeleteButton();
    this.managers.uiManager.initRegenerateTitleButton();
  }

  private _setupEventListeners() {
    Zotero.log(`[Ask My Paper] ChatPane._setupEventListeners called.`);
    const { body } = this.uiElements;
    const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
    const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
    const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
    const chatResizer = body.querySelector("#chat-resizer") as HTMLDivElement;
    const newChatButton = body.querySelector(
      "#new-chat-button",
    ) as HTMLButtonElement;

    if (newChatButton) {
      Zotero.log(`[Ask My Paper] _setupEventListeners: newChatButton found.`);
    } else {
      Zotero.logError(
        new Error(
          `[Ask My Paper] _setupEventListeners: newChatButton not found!`,
        ),
      );
    }

    if (
      !chatMessages ||
      !chatInput ||
      !sendButton ||
      !chatResizer ||
      !newChatButton
    ) {
      Zotero.logError(
        new Error("One or more UI elements not found for event listeners."),
      );
      return;
    }

    // Bind all event handlers
    this._boundHandleLinkClick = this._handleLinkClick.bind(this);
    this._boundHandleSendMessage = (async () => {
      const chatInput = this.uiElements.body.querySelector(
        "#chat-input",
      ) as HTMLTextAreaElement;
      const messageText = chatInput.value;
      if (messageText.trim() === "") return; // 空メッセージは送信しない

      this._handleSendMessage(messageText, messageText);
      this.managers.uiManager.clearChatInput(); // 送信後にクリア
    }).bind(this);
    this._boundHandleEnterKey = this._handleEnterKey.bind(this);
    this._boundHandleNewChat = this._handleNewChat.bind(this);
    this._boundHandleResize = this._handleResize.bind(this);

    // Add all event listeners
    sendButton.addEventListener("click", this._boundHandleSendMessage);
    chatInput.addEventListener("keydown", this._boundHandleEnterKey);
    newChatButton.addEventListener("click", this._boundHandleNewChat);
    chatResizer.addEventListener("mousedown", this._boundHandleResize);
    chatMessages.addEventListener("click", this._boundHandleLinkClick);
  }

  private _loadConversation() {
    const activeSession = this.chatSessionManager.getActiveSession();
    if (activeSession) {
      this.managers.uiManager.renderChatMessages(activeSession);
    } else {
      Zotero.logError(new Error("No active session found after init."));
      this.managers.uiManager.addBotMessage(
        "チャットの読み込みに失敗しました。",
        "error-message",
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
      `[Ask My Paper] Pane ${this.paneId} onRender: Stored itemId is ${this.zoteroContext.itemId}`,
    );
    this.zoteroContext.actualParentItem = actualParentItem;

    const chatMessages = this.uiElements.body.querySelector(
      "#chat-messages",
    ) as HTMLDivElement;
    if (chatMessages) {
      const savedHeight = getPref(PREF_CHAT_PANEL_HEIGHT) as number;
      if (savedHeight) {
        chatMessages.style.height = `${this._clampChatMessagesHeight(savedHeight, false)}px`;
        chatMessages.style.maxHeight = "none";
      }
    }
  }

  private _clampChatMessagesHeight(
    requestedHeight: number,
    allowContentGrowth = true,
  ): number {
    const minHeight = 50;
    const chatMessages = this.uiElements.body.querySelector(
      "#chat-messages",
    ) as HTMLDivElement | null;
    const chatContainer = this.uiElements.body.querySelector(
      ".chat-container",
    ) as HTMLDivElement | null;

    if (!chatMessages || !chatContainer) {
      return Math.max(minHeight, Math.round(requestedHeight));
    }

    const maxHeight = this._getMaxChatMessagesHeight(
      chatContainer,
      chatMessages,
      minHeight,
      requestedHeight,
      allowContentGrowth,
    );
    return Math.round(
      Math.min(Math.max(requestedHeight, minHeight), maxHeight),
    );
  }

  private _getMaxChatMessagesHeight(
    chatContainer: HTMLDivElement,
    chatMessages: HTMLDivElement,
    minHeight: number,
    requestedHeight: number,
    allowContentGrowth: boolean,
  ): number {
    const containerStyle =
      this.uiElements.doc.defaultView?.getComputedStyle(chatContainer);
    const containerPadding =
      this._cssPixels(containerStyle?.paddingTop) +
      this._cssPixels(containerStyle?.paddingBottom);
    const containerContentHeight =
      chatContainer.clientHeight - containerPadding;
    const messagesStyle =
      this.uiElements.doc.defaultView?.getComputedStyle(chatMessages);
    const messagesMargins =
      this._cssPixels(messagesStyle?.marginTop) +
      this._cssPixels(messagesStyle?.marginBottom);
    const reservedHeight = Array.from(chatContainer.children).reduce(
      (total, child) => {
        if (child === chatMessages || !(child instanceof HTMLElement)) {
          return total;
        }
        const childStyle =
          this.uiElements.doc.defaultView?.getComputedStyle(child);
        return (
          total +
          child.getBoundingClientRect().height +
          this._cssPixels(childStyle?.marginTop) +
          this._cssPixels(childStyle?.marginBottom)
        );
      },
      0,
    );
    const containerMaxHeight =
      containerContentHeight - reservedHeight - messagesMargins;
    const containerRect = chatContainer.getBoundingClientRect();
    const viewportHeight = this.uiElements.doc.defaultView?.innerHeight ?? 0;
    const viewportMaxHeight =
      viewportHeight - containerRect.top - reservedHeight - messagesMargins - 8;
    const boundedMaxHeight = Math.max(containerMaxHeight, viewportMaxHeight);
    const maxHeight = allowContentGrowth
      ? Math.max(boundedMaxHeight, requestedHeight)
      : boundedMaxHeight;
    return Math.max(minHeight, Math.floor(maxHeight));
  }

  private _cssPixels(value: string | undefined): number {
    const parsed = Number.parseFloat(value || "0");
    return Number.isFinite(parsed) ? parsed : 0;
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
      const chatInput = this.uiElements.body.querySelector(
        "#chat-input",
      ) as HTMLTextAreaElement;
      const messageText = chatInput.value;
      if (messageText.trim() === "") return;
      this._handleSendMessage(messageText, messageText); // messageText と promptText は同じ
      this.managers.uiManager.clearChatInput(); // 送信後にクリア
    }
  }

  /**
   * ユーザーからのメッセージまたは生成されたプロンプトを処理し、LLMに送信します。
   * UIの更新、セッション履歴への追加、API通信、そしてエラーハンドリングを担当します。
   *
   * @param messageText UIに表示およびセッション履歴に保存するメッセージテキスト。
   *                    通常はユーザーの入力そのままか、PDFアクション時の短い要約。
   * @param promptText  LLMに送信する実際のプロンプトテキスト。
   *                    messageTextと同じであることもあれば、PDFのコンテキストなど追加情報を含むこともある。
   */
  private async _handleSendMessage(messageText: string, promptText: string) {
    if (!this.sendMessageUseCase) {
      Zotero.logError(
        new Error("SendMessageUseCase not initialized in chatPane."),
      );
      return;
    }

    this.parentItemFileMetadata = await this.sendMessageUseCase.execute(
      messageText,
      promptText,
    );
  }

  private async _handleNewChat() {
    Zotero.log(`[Ask My Paper] _handleNewChat: New chat button clicked.`);
    const newSession = await this.chatSessionManager.createSession();
    if (newSession) {
      Zotero.log(
        `[Ask My Paper] _handleNewChat: New session created with ID: ${newSession.id}`,
      );
      this.managers.uiManager.clearChatInput();
      this.parentItemFileMetadata = null;
      this.chatSessionManager.switchSession(newSession.id); // UI updates are triggered by this
      Zotero.log(
        `[Ask My Paper] After _handleNewChat, active session ID: ${this.chatSessionManager.getActiveSession()?.id}`,
      );
    } else {
      Zotero.logError(
        new Error(
          "[Ask My Paper] _handleNewChat: Failed to create new session.",
        ),
      );
    }
  }

  private _handleResize(e: MouseEvent) {
    e.preventDefault();
    const { doc, body } = this.uiElements;
    const startY = e.clientY;
    const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
    const startHeight = chatMessages.getBoundingClientRect().height;

    const doDrag = (e: MouseEvent) => {
      const newHeight = startHeight + (e.clientY - startY);
      chatMessages.style.height = `${this._clampChatMessagesHeight(newHeight)}px`;
      chatMessages.style.maxHeight = "none";
    };

    const stopDrag = () => {
      doc.removeEventListener("mousemove", doDrag, false);
      doc.removeEventListener("mouseup", stopDrag, false);
      const effectiveHeight = this._clampChatMessagesHeight(
        chatMessages.getBoundingClientRect().height,
      );
      chatMessages.style.height = `${effectiveHeight}px`;
      chatMessages.style.maxHeight = "none";
      setPref(PREF_CHAT_PANEL_HEIGHT, effectiveHeight);
    };

    doc.addEventListener("mousemove", doDrag, false);
    doc.addEventListener("mouseup", stopDrag, false);
  }

  private async _handleAskMyPaperAction(event: CustomEvent) {
    if (!this.zoteroContext.itemId) {
      return;
    }

    if (event.detail.paneId) {
      if (event.detail.paneId !== this.paneId) {
        return;
      }
    } else if (this.zoteroContext.itemId !== event.detail.itemId) {
      return;
    }

    Zotero.log(
      `[Ask My Paper] Action event received for matching item ${this.zoteroContext.itemId}`,
    );
    Zotero.log(
      `[Ask My Paper] _handleAskMyPaperAction: event.detail: ${JSON.stringify(event.detail)}`,
    );

    const { fullPrompt, summaryText } = event.detail;
    Zotero.log(
      `[Ask My Paper] _handleAskMyPaperAction: fullPrompt: ${fullPrompt}, summaryText: ${summaryText}`,
    );

    // For now, we reuse the general send message handler
    await this._handleSendMessage(summaryText, fullPrompt);
  }

  public destroy() {
    // Remove global listener
    if (this.runtimeState.eventHandler) {
      Zotero.getMainWindow().document.removeEventListener(
        "ask-my-paper-action",
        this.runtimeState.eventHandler,
      );
    }

    // Remove local listeners
    const { body } = this.uiElements;
    const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
    const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
    const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
    const chatResizer = body.querySelector(".chat-resizer") as HTMLDivElement;
    const newChatButton = body.querySelector(
      "#new-chat-button",
    ) as HTMLButtonElement;

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
    // Destroy the chatSessionManager instance
    if (this.chatSessionManager) {
      this.chatSessionManager.destroy();
    }
  }
}
