# Gemini PDF Plugin Chat Log Format Specification

This document details the JSON formats used for persisting Gemini chat-related data within Zotero. To support multiple chat sessions per parent item and flexible file management, data is now stored in two distinct types of JSON attachments linked to a Zotero parent item:

1.  **Parent Item File Metadata**: Manages information about all PDF attachments associated with a Zotero parent item, including their Gemini File API status.
2.  **Chat Session History**: Stores the conversation history for a specific chat session, linked to a Zotero parent item.

## 1. Parent Item File Metadata Format

This JSON attachment (e.g., named `Gemini File Metadata - [ParentItemKey].json`) is unique to each Zotero parent item and centralizes metadata for all its associated PDF attachments relevant to the Gemini API.

### Overall Structure (Parent Item File Metadata)

```json
{
  "zoteroParentItemKey": "PARENT_XYZ",
  "files": [
    {
      "zoteroAttachmentKey": "ATTACH_123",
      "geminiFileUri": "files/uri_for_pdf1",
      "fileName": "main_article.pdf",
      "lastUploadTimestamp": "2025-11-18T11:00:00Z"
    },
    {
      "zoteroAttachmentKey": "ATTACH_456",
      "geminiFileUri": "files/uri_for_pdf2",
      "fileName": "supplementary_info.pdf",
      "lastUploadTimestamp": "2025-11-18T12:00:00Z"
    }
  ]
}
```

### Field Descriptions (Parent Item File Metadata)

- `zoteroParentItemKey` (String):
  - **Description:** The unique identifier (`itemKey`) of the Zotero parent item. This serves as the primary link for all Gemini-related attachments.
  - **Example:** `"PARENT_XYZ"`

- `files` (Array of Objects):
  - **Description:** An array containing metadata for each PDF attachment associated with the `zoteroParentItemKey` that has been processed or is intended for use with the Gemini API.
  - **Object Structure:**
    - `zoteroAttachmentKey` (String): The unique `itemKey` of the Zotero PDF attachment.
    - `geminiFileUri` (String): The resource name (`file.uri`) for the corresponding file in the Gemini File API.
    - `fileName` (String): The original filename of the attachment, useful for display purposes.
    - `lastUploadTimestamp` (String, ISO 8601 format): The timestamp indicating when this specific PDF file was last successfully uploaded or its presence in the Gemini File API was verified. This helps manage file lifecycle and potential expiration.

## 2. Chat Session History Format

Each individual chat session (e.g., named `Gemini Chat - [chatTitle].json`) is stored as a separate JSON attachment to the Zotero parent item. This allows for multiple distinct conversations per parent item.

### Overall Structure (Chat Session History)

```json
{
  "metadata": {
    "zoteroParentItemKey": "PARENT_XYZ",
    "chatId": "CHAT_UUID_12345",
    "chatTitle": "要約と重要ポイント"
  },
  "history": [
    {
      "timestamp": "2025-11-18T11:01:05Z",
      "role": "user",
      "parts": [
        { "text": "この論文と補足資料の内容を比較して要約してください。" }
      ]
    },
    {
      "timestamp": "2025-11-18T11:01:15Z",
      "role": "model",
      "model": "gemini-2.5-flash",
      "parts": [{ "text": "承知いたしました。論文と補足資料を比較した結果..." }]
    }
  ]
}
```

### Field Descriptions (Chat Session History)

- `metadata` (Object):
  - **Description:** Contains information specific to this individual chat session.
  - **Object Structure:**
    - `zoteroParentItemKey` (String): The unique identifier (`itemKey`) of the Zotero parent item. This links the chat session to its parent and, indirectly, to the Parent Item File Metadata for its associated PDFs.
    - `chatId` (String): A unique identifier for this specific chat session. This distinguishes it from other chat sessions attached to the same `zoteroParentItemKey`. A UUID is recommended.
    - `chatTitle` (String): A user-friendly title for this chat session, allowing for easier identification within the Zotero interface. If not provided by the user, a default title (e.g., based on creation timestamp) should be used.

- `history` (Array of Objects):
  - **Description:** An ordered list of message entries, representing the turn-by-turn conversation for this chat session. All PDFs associated with the `zoteroParentItemKey` (as defined in the Parent Item File Metadata) are considered active context for this chat.
  - **Object Structure:**
    - `timestamp` (String, ISO 8601 format): The timestamp of when the message was sent or received.
    - `role` (String): The sender of the message (`"user"` or `"model"`).
    - `model` (String, Optional): The name of the Gemini model that generated the response (only for `role: "model"`).
    - `parts` (Array of Objects): The content of the message, typically `[{ "text": "..." }]`.
