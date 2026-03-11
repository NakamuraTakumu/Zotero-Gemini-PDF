# Gemini PDF

Gemini PDF is a Zotero plugin that adds a Gemini-powered chat panel to the
Zotero PDF reader.

The plugin is focused on in-reader workflows: you can ask questions about the
current PDF, send selected text to Gemini, and keep chat history attached to
the Zotero item.

> [!IMPORTANT]
> This project is being developed with Codex assistance and is still under
> active iteration. Review behavior and outputs carefully before relying on it
> in production or research workflows.

![Gemini PDF screenshot](./image.png)

## Current capabilities

- Adds a chat pane to the Zotero PDF reader
- Automatically uploads and synchronizes PDF attachments with the Gemini File
  API when chat starts
- Sends free-form prompts to Gemini from inside Zotero
- Lets you ask about selected text from the reader context menu
- Stores chat sessions as JSON attachments on the related Zotero item
- Renders responses with Markdown and KaTeX support
- Supports configurable API key, system prompt, model list, title generation,
  and chat history limit

## How it works

When a chat starts, the plugin automatically uploads and synchronizes the PDF
attachments of the current Zotero item with the Gemini File API. Metadata for
uploaded files is stored as a Zotero attachment so the plugin can reuse
existing Gemini files when possible.

## Setup

1. Build or install the plugin in Zotero.
2. Open Zotero Preferences and find `Gemini PDF Settings`.
3. Set your Gemini API key.
4. Optionally adjust:
   - system prompt
   - prompt used for selected text
   - available model list
   - title generation model and prompt
   - chat history limit

## Development

```bash
npm install
npm run start
```

For a production build:

```bash
npm run build
```

## Notes

- A valid Gemini API key is required.
- PDF files may be uploaded to Gemini in order to provide document context.
- This repository is based on the Zotero plugin template and is still under
  active development.
