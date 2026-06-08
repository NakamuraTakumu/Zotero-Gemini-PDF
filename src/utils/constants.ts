// Prefix for older per-chat history attachments. Only used to migrate current dev data into the aggregate parent item store.
export const CHAT_ATTACHMENT_TITLE_PREFIX = "Ask My Paper Chat - ";
export const PREVIOUS_CHAT_ATTACHMENT_TITLE_PREFIX = "Gemini Chat - ";

// Prefix for the title of the aggregate parent item data attachment. The actual title will include a parent item key.
export const PARENT_ITEM_DATA_TITLE_PREFIX = "Ask My Paper Data - ";
// Prefix for the filename of the aggregate parent item data attachment. The actual filename will include a parent item key.
export const PARENT_ITEM_DATA_FILENAME_PREFIX = "ask_my_paper_data_";

// Previous parent item data title. Used to rename current development data into the aggregate store.
export const PREVIOUS_PARENT_ITEM_FILE_METADATA_TITLE_PREFIX =
  "Ask My Paper File Metadata - ";
export const LEGACY_GEMINI_FILE_METADATA_TITLE_PREFIX =
  "Gemini File Metadata - ";

export const PREF_LLM_PROVIDER = "llmProvider";
export const PREF_OPENAI_API_KEY = "openaiApiKey";
export const PREF_ANTHROPIC_API_KEY = "anthropicApiKey";
export const PREF_GEMINI_API_KEY = "geminiApiKey";
export const PREF_GEMINI_MODEL_LIST = "geminiModelList";
export const PREF_OPENAI_MODEL_LIST = "openaiModelList";
export const PREF_ANTHROPIC_MODEL_LIST = "anthropicModelList";
export const PREF_GEMINI_SELECTED_MODEL = "geminiSelectedModel";
export const PREF_OPENAI_SELECTED_MODEL = "openaiSelectedModel";
export const PREF_ANTHROPIC_SELECTED_MODEL = "anthropicSelectedModel";
export const PREF_USE_WEB_SEARCH = "useWebSearch";
export const PREF_SYSTEM_PROMPT = "systemPrompt";
export const PREF_PROMPT_FOR_SELECTION = "promptForSelection";
export const PREF_CONTEXT_WINDOW_SIZE = "contextWindowSize";
export const PREF_CHAT_PANEL_HEIGHT = "chatPanelHeight";
export const PREF_TITLE_GENERATION_PROVIDER = "titleGenerationProvider";
export const PREF_TITLE_GENERATION_MODEL = "titleGenerationModel";
export const PREF_TITLE_GENERATION_PROMPT = "titleGenerationPrompt";
export const PREF_CITATION_RENDER_PROVIDER = "citationRenderProvider";
export const PREF_CITATION_RENDER_MODEL = "citationRenderModel";
export const PREF_CITATION_RENDER_PROMPT = "citationRenderPrompt";
export const PREF_REASONING_MODE = "reasoningMode";
