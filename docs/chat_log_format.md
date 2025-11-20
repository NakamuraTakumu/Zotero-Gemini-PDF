# Gemini PDF Plugin Chat Log Format Specification (Multi-File)

This document details the JSON format used for persisting chat conversations within the Zotero Gemini PDF plugin. This format is designed to support a multi-file context, where a single chat session can reference all PDF attachments of a Zotero parent item.

## Overall Structure

The chat log is stored as a single JSON object with two top-level keys: `metadata` and `history`. The chat session is keyed to a Zotero Parent Item.

```json
{
  "metadata": {
    "zoteroParentItemKey": "PARENT_XYZ",
    "files": [
      {
        "zoteroAttachmentKey": "ATTACH_123",
        "geminiFileUri": "files/uri_for_pdf1",
        "fileName": "main_article.pdf"
      },
      {
        "zoteroAttachmentKey": "ATTACH_456",
        "geminiFileUri": "files/uri_for_pdf2",
        "fileName": "supplementary_info.pdf"
      }
    ],
    "lastUploadTimestamp": "2025-11-18T11:00:00Z"
  },
  "history": [
    {
      "sequence": 0,
      "timestamp": "2025-11-18T11:01:05Z",
      "role": "user",
      "parts": [{ "text": "この論文と補足資料の内容を比較して要約してください。" }]
    },
    {
      "sequence": 1,
      "timestamp": "2025-11-18T11:01:15Z",
      "role": "model",
      "model": "gemini-2.5-flash",
      "parts": [{ "text": "承知いたしました。論文と補足資料を比較した結果..." }]
    }
  ]
}
```

## Field Descriptions

### `metadata` (Object)

Contains information about the chat session itself, linking it to a Zotero parent item and a collection of files in the Gemini File API.

-   `zoteroParentItemKey` (String):
    -   **Description:** The unique identifier (`itemKey`) of the Zotero parent item that this chat conversation pertains to. This is the primary key for a chat session.
    -   **Example:** `"PARENT_XYZ"`

-   `files` (Array of Objects):
    -   **Description:** An array containing information about each PDF file used as context in this chat session.
    -   **Object Structure:**
        -   `zoteroAttachmentKey` (String): The unique `itemKey` of the Zotero attachment.
        -   `geminiFileUri` (String): The resource name (`file.uri`) for the corresponding file in the Gemini File API.
        -   `fileName` (String): The original filename of the attachment, useful for display purposes.

-   `lastUploadTimestamp` (String, ISO 8601 format):
    -   **Description:** The timestamp indicating when a file in the `files` array was last uploaded or verified. Useful for tracking file lifecycle and potential expiration.
    -   **Example:** `"2025-11-18T11:00:00Z"`

### `history` (Array of Objects)

An ordered list of message entries, representing the turn-by-turn conversation. The structure of each message object remains the same.

-   `sequence` (Number): A zero-based sequential number for each message.
-   `timestamp` (String, ISO 8601 format): The timestamp of when the message was sent or received.
-   `role` (String): The sender of the message (`"user"` or `"model"`).
-   `model` (String, Optional): The name of the Gemini model that generated the response (only for `role: "model"`).
-   `parts` (Array of Objects): The content of the message, typically `[{ "text": "..." }]`.
