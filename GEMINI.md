# Gemini PDF Plugin: Zotero Integration with Generative AI

## Project Overview

The "Gemini PDF" Zotero plugin aims to revolutionize PDF interaction within Zotero by integrating the powerful Gemini API. This plugin provides an interactive chat interface directly within the Zotero PDF reader, enabling users to leverage a Large Language Model (LLM) for intelligent processing and interaction with PDF content.

## Current Features & Development Status

This codebase, originating from a Zotero plugin template, now includes foundational elements for Gemini integration:

*   **Interactive Chat Interface**: A dedicated chat panel is seamlessly integrated into the Zotero PDF reader's item pane, offering a familiar messaging experience.
*   **Persistent Chat History**: All chat conversations are automatically saved as JSON attachments to their respective Zotero items, ensuring continuity and retrievability.
*   **Gemini API Integration (Basic)**:
    *   The Google Generative AI SDK (`@google/generative-ai`) is installed and configured.
    *   `src/modules/geminiApi.ts` encapsulates core Gemini API interaction logic (initialization, message sending).
    *   The chat interface now sends user queries to the Gemini API (currently using `gemini-2.5-flash`) and displays its responses, replacing the initial placeholder bot.
    *   Multi-turn conversation support has been implemented, allowing Gemini to access the full chat history for contextual responses.
*   **Development Tooling**: A robust development environment is set up with `zotero-plugin-toolkit`, TypeScript, Webpack, ESLint, and Prettier.
*   **Localization Support**: The plugin is prepared for internationalization using FTL files.

## Next Steps for Enhanced Functionality

To evolve "Gemini PDF" into a comprehensive and highly functional tool, the following key areas are prioritized for development:

1.  **Advanced Gemini Model Configuration**:
    *   **Dynamic Model Selection**: Implement UI elements in `addon/content/preferences.xhtml` to allow users to select different Gemini models (e.g., `gemini-1.0-pro`, `gemini-1.5-flash`, `gemini-2.5-flash`) directly from the preferences pane.
    *   **Model Parameters**: Introduce settings for other model parameters (e.g., temperature, max output tokens, top_p, top_k) to give users fine-grained control over Gemini's response generation.
    *   **API Key Management**: Ensure robust saving and retrieval of Gemini API keys and other model settings via `src/modules/preferenceScript.ts` and `src/utils/prefs.ts`.

2.  **Intelligent PDF Content Processing**:
    *   **Text Extraction**: Develop robust functionality to accurately extract text content from the currently viewed PDF document.
    *   **Contextual Chunking**: Implement strategies for intelligently chunking and sending relevant segments of PDF text to the Gemini API, optimizing for token limits and maintaining conversational context. This will enable Gemini to answer questions directly related to the document content.

3.  **Context Window Management**:
    *   **Configurable History**: Introduce a preference for defining the "context window size" (e.g., number of recent messages or estimated token count) to manage how much chat history is sent to Gemini, balancing context, token limits, and cost.
    *   **Truncation Logic**: Implement logic in `src/modules/readerItemPane.ts` to truncate the chat history based on user-defined preferences before sending it to the Gemini API.

This `GEMINI.md` will be continuously updated to reflect project progress, new features, and strategic insights.

## Interaction Language

Please use Japanese for all interactions and communications related to this project.

## Interaction Language

Please use Japanese for all interactions and communications related to this project.

## Specification Documentation

After receiving specifications, I will summarize them into a document for clarity and record-keeping.