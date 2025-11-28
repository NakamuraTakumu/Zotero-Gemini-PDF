
import {
  ChatSessionHistory,
  ParentItemFileMetadata,
} from "../../types/chat";
import { ChatManager } from "./chat";
import { ChatSessionManager } from "./chatSessionManager";
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
  public managers: { chatManager: ChatManager; uiManager: UIManager; };
  public chatSessionManager: ChatSessionManager;
  public zoteroContext: { itemId?: number; actualParentItem?: Zotero.Item | null; };
  public chatData: { currentConversation?: ChatSessionHistory | null; parentItemFileMetadata?: ParentItemFileMetadata | null; };
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
      currentConversation: null,
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
    this._loadConversation(actualParentItem);
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
    const window = doc.defaultView as any;
    const chatMessages = body.querySelector(
      "#chat-messages"
    ) as HTMLDivElement;

    let chatManager: ChatManager;

    const chatSessionManager = new ChatSessionManager(
      actualParentItem,
      (session) => {
        // onActiveSessionChange
        if (this.managers) {
          this.managers.uiManager._renderChatMessages(session);
          this.chatData.currentConversation = session;
          this.managers.uiManager.updateSessionSwitcher();
        }
      },
      (session) => {
        // onGenerateTitle
        if (chatManager) {
          chatManager.generateAndSetSessionTitle(session);
        }
      }
    );

    chatManager = new ChatManager(window, chatSessionManager);
    const uiManager = new UIManager(doc, body, chatMessages, chatManager);
    uiManager.registerPrefObservers();

    this.managers = { chatManager, uiManager };
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
    this._boundHandleSendMessage = this._handleSendMessage.bind(this);
    this._boundHandleEnterKey = this._handleEnterKey.bind(this);
    this._boundHandleNewChat = this._handleNewChat.bind(this);
    this._boundHandleResize = this._handleResize.bind(this);

    chatMessages.addEventListener("click", this._boundHandleLinkClick);
    sendButton.addEventListener("click", this._boundHandleSendMessage);
    chatInput.addEventListener("keydown", this._boundHandleEnterKey);
    newChatButton.addEventListener("click", this._boundHandleNewChat);
    chatResizer.addEventListener("mousedown", this._boundHandleResize);
  }

  private _loadConversation(actualParentItem: Zotero.Item | null) {
    const currentConversation = this.chatSessionManager.getActiveSession();

    if (actualParentItem) {
      try {
        this.chatData.currentConversation = currentConversation;
        if (currentConversation) {
          this.managers.uiManager._renderChatMessages(
            currentConversation
          );
        } else {
          Zotero.logError(new Error("No active conversation found after init."));
          this.managers.uiManager.addBotMessage(
            "チャットの読み込みに失敗しました。",
            "error-message"
          );
        }
      } catch (e: any) {
        Zotero.logError(
          new Error(
            `Error loading conversation or syncing PDFs: ${
              e.message || String(e)
            }`
          )
        );
        this.managers.uiManager.addBotMessage(
          `Error loading conversation or syncing PDFs: ${
            e.message || String(e)
          }`,
          "error-message"
        );
      }
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
      this._handleSendMessage();
    }
  }

  private async _handleSendMessage() {
    const chatInput = this.uiElements.body.querySelector(
      "#chat-input"
    ) as HTMLTextAreaElement;
    const messageText = chatInput.value;
    if (messageText.trim() === "") return;

    if (this.runtimeState.isGeminiRequestInProgress) {
      Zotero.debug(
        `[Gemini PDF] Request already in progress for pane ${this.paneId}. Skipping message send.`
      );
      return;
    }

    if (this.zoteroContext.actualParentItem && this.chatData.currentConversation) {
      this.runtimeState.isGeminiRequestInProgress = true;
      ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(this.paneId, true);

      if (!this.chatData.parentItemFileMetadata) {
        try {
          this.chatData.parentItemFileMetadata =
            await this.managers.chatManager.synchronizePdfContext(
              this.zoteroContext.actualParentItem,
              {
                addBotMessage: this.managers.uiManager.addBotMessage,
                updateBotMessage: this.managers.uiManager.updateBotMessage,
              }
            );
        } catch (e: any) {
          Zotero.logError(
            new Error(
              `Error synchronizing PDFs on first message: ${
                e.message || String(e)
              }`
            )
          );
          this.managers.uiManager.addBotMessage(
            `Error synchronizing PDFs: ${e.message || String(e)}`,
            "error-message"
          );
          this.runtimeState.isGeminiRequestInProgress = false;
          ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(
            this.paneId,
            false
          );
          return;
        }
      }

      if (this.chatData.parentItemFileMetadata) {
        const sendButton = this.uiElements.body.querySelector("#send-button") as HTMLButtonElement;
        const chatMessages = this.uiElements.body.querySelector("#chat-messages") as HTMLDivElement;

        await this.managers.chatManager.processAndSendMessage(
          this.paneId,
          messageText,
          messageText,
          this.zoteroContext.actualParentItem,
          this.chatData.parentItemFileMetadata,
          {
            uiManager: this.managers.uiManager,
            addBotMessage: this.managers.uiManager.addBotMessage,
            updateBotMessage: this.managers.uiManager.updateBotMessage,
            chatInput,
            sendButton,
            chatMessages,
            popupTriggerButton: null,
            originalButtonText: undefined,
          }
        );
      } else {
        Zotero.logError(
          new Error(
            "parentItemFileMetadata is unexpectedly null after ensureParentItemFileMetadata."
          )
        );
      }
    }
  }

  private async _handleNewChat() {
    if (!this.zoteroContext.actualParentItem) {
      Zotero.debug(
        "[Gemini PDF] Cannot start new chat: No parent item selected."
      );
      return;
    }

    const newConversation = await this.chatSessionManager?.createSession(
      "新しいチャット"
    );
    if (newConversation) {
      this.managers.uiManager.updateSessionSwitcher();
      const chatInput = this.uiElements.body.querySelector("#chat-input") as HTMLTextAreaElement;
      chatInput.value = "";
      this.chatData.parentItemFileMetadata = null;
      Zotero.debug(
        `[Gemini PDF] New chat session started with ID: ${newConversation.metadata.chatId}`
      );
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
    const resizer = body.querySelector("#chat-resizer") as HTMLDivElement;

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
    Zotero.log(
      `[Gemini PDF] Pane ${this.paneId} received event. My itemId is ${
        this.zoteroContext.itemId
      }. Event detail: ${JSON.stringify(event.detail)}`
    );

    if (
      !this.zoteroContext.itemId ||
      this.zoteroContext.itemId !== event.detail.itemId
    ) {
      return;
    }

    if (this.runtimeState.isGeminiRequestInProgress) {
      Zotero.debug(
        `[Gemini PDF] Request already in progress for pane ${this.paneId}. Skipping action.`
      );
      return;
    }

    Zotero.log(
      `[Gemini PDF] Action event received for matching item ${this.zoteroContext.itemId}`
    );

    const { fullPrompt, summaryText, popupTriggerButton, originalButtonText } =
      event.detail;
    
    if (!this.chatSessionManager || !this.managers.chatManager || !this.managers.uiManager) {
      Zotero.logError(
        new Error(
          "ChatSessionManager or ChatManager/UIManager is not initialized in paneState for handleGeminiAction."
        )
      );
      return;
    }

    const currentConversation = this.chatSessionManager.getActiveSession();
    if (!currentConversation) {
      Zotero.logError(
        new Error(
          "No active conversation found in ChatSessionManager for handleGeminiAction."
        )
      );
      this.runtimeState.isGeminiRequestInProgress = false;
      ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(this.paneId, false);
      return;
    }

    const { body } = this.uiElements;
    const chatInput = body.querySelector("#chat-input") as HTMLTextAreaElement;
    const sendButton = body.querySelector("#send-button") as HTMLButtonElement;
    const chatMessages = body.querySelector("#chat-messages") as HTMLDivElement;
    this.runtimeState.isGeminiRequestInProgress = true;
    ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(this.paneId, true);

    if (!await ReaderItemPaneFactory.ensureParentItemFileMetadata(this)) {
      this.runtimeState.isGeminiRequestInProgress = false;
      ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(this.paneId, false);
      return;
    }

    if (!this.zoteroContext.actualParentItem) {
      Zotero.logError(
        new Error("Cannot process and send message: actualParentItem is null.")
      );
      this.runtimeState.isGeminiRequestInProgress = false;
      ReaderItemPaneFactory.dispatchRequestStatusChangedEvent(this.paneId, false);
      return;
    }

    if (this.chatData.parentItemFileMetadata) {
      await this.managers.chatManager.processAndSendMessage(
        this.paneId,
        summaryText,
        fullPrompt,
        this.zoteroContext.actualParentItem,
        this.chatData.parentItemFileMetadata,
        {
          uiManager: this.managers.uiManager,
          addBotMessage: this.managers.uiManager.addBotMessage,
          updateBotMessage: this.managers.uiManager.updateBotMessage,
          chatInput,
          sendButton,
          chatMessages,
          popupTriggerButton,
          originalButtonText,
        }
      );
    }
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
    const chatResizer = body.querySelector("#chat-resizer") as HTMLDivElement;
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

    this.managers?.uiManager?.unregisterPrefObservers();
    Zotero.log(`[Gemini PDF] Destroyed pane: ${this.paneId}`);
  }
}
