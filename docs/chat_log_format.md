# Ask My Paper Plugin Chat Log Format Specification

This document details the JSON formats used for persisting Ask My Paper data within Zotero. To avoid one visible Zotero item per chat session, PDF upload metadata and chat sessions are stored in one aggregate JSON attachment linked to each Zotero parent item.

1.  **Parent Item Data**: Manages information about all PDF attachments associated with a Zotero parent item, including provider-specific upload references and chat sessions.
2.  **Chat Session History**: Stored as entries in `chatSessions`, not as separate Zotero attachments.

PDF citation block syntax is specified separately in `docs/pdf_citation_format.md`.

## 1. Parent Item Data Format

This JSON attachment (e.g., named `Ask My Paper Data - [ParentItemKey].json`) is unique to each Zotero parent item and centralizes metadata for all its associated PDF attachments and chat sessions.

### Overall Structure (Parent Item Data)

```json
{
  "zoteroParentItemKey": "PARENT_XYZ",
  "files": [
    {
      "zoteroAttachmentKey": "ATTACH_123",
      "fileName": "main_article.pdf",
      "lastModified": 1763463600000,
      "uploads": [
        {
          "provider": "gemini",
          "fileUri": "files/uri_for_pdf1",
          "uploadedAt": "2026-05-20T11:00:00Z"
        },
        {
          "provider": "openai",
          "fileId": "file_abc123",
          "uploadedAt": "2026-05-20T11:02:00Z"
        }
      ]
    },
    {
      "zoteroAttachmentKey": "ATTACH_456",
      "fileName": "supplementary_info.pdf",
      "uploads": []
    }
  ],
  "chatSessions": [
    {
      "schemaVersion": 2,
      "metadata": {
        "zoteroParentItemKey": "PARENT_XYZ",
        "chatId": "CHAT_UUID_12345",
        "chatTitle": "要約と重要ポイント",
        "isTitleGenerated": true,
        "createdTimestamp": "2026-05-20T11:01:00Z",
        "updatedTimestamp": "2026-05-20T11:02:30Z"
      },
      "messages": []
    }
  ]
}
```

### Field Descriptions (Parent Item Data)

- `zoteroParentItemKey` (String):
  - **Description:** The unique identifier (`itemKey`) of the Zotero parent item.
  - **Example:** `"PARENT_XYZ"`

- `files` (Array of Objects):
  - **Description:** An array containing metadata for each PDF attachment associated with the `zoteroParentItemKey`.
  - **Object Structure:**
    - `zoteroAttachmentKey` (String): The unique `itemKey` of the Zotero PDF attachment.
    - `fileName` (String): The original filename of the attachment, useful for display purposes.
    - `lastModified` (Number, Optional): The PDF file modification timestamp used to decide whether an upload reference may be stale.
    - `uploads` (Array): Provider-specific upload references. Gemini stores `fileUri`; OpenAI and Anthropic store `fileId`.

- `chatSessions` (Array of Chat Session History Objects):
  - **Description:** An array containing all chat sessions associated with the `zoteroParentItemKey`.
  - **Storage:** These are records within the aggregate parent item data attachment. They are not individual Zotero child attachments.

## 2. Chat Session History Format

Each individual chat session is stored as an object inside the aggregate parent item data attachment. This allows for multiple distinct conversations per parent item without cluttering the Zotero item tree.

### Overall Structure (Chat Session History)

```json
{
  "schemaVersion": 2,
  "metadata": {
    "zoteroParentItemKey": "PARENT_XYZ",
    "chatId": "CHAT_UUID_12345",
    "chatTitle": "要約と重要ポイント",
    "isTitleGenerated": true,
    "createdTimestamp": "2026-05-20T11:01:00Z",
    "updatedTimestamp": "2026-05-20T11:02:30Z"
  },
  "messages": [
    {
      "type": "human",
      "data": {
        "content": "この論文と補足資料の内容を比較して要約してください。",
        "role": "human",
        "name": null,
        "tool_call_id": null,
        "response_metadata": {
          "askMyPaper": {
            "timestamp": "2026-05-20T11:01:05Z"
          }
        }
      }
    },
    {
      "type": "ai",
      "data": {
        "content": "承知いたしました。論文と補足資料を比較した結果...",
        "role": "ai",
        "name": null,
        "tool_call_id": null,
        "response_metadata": {
          "provider": "openai",
          "model": "gpt-5.5-mini",
          "model_name": "gpt-5.5-mini",
          "askMyPaper": {
            "timestamp": "2026-05-20T11:01:15Z",
            "provider": "openai",
            "model": "gpt-5.5-mini",
            "thoughts": [],
            "citations": []
          }
        }
      }
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
    - `isTitleGenerated` (Boolean): Whether the title was generated automatically.
    - `createdTimestamp` / `updatedTimestamp` (String): ISO 8601 timestamps for the session lifecycle.

- `messages` (Array of LangChain `StoredMessage` Objects):
  - **Description:** An ordered list of LangChain serialized messages. All PDFs associated with the `zoteroParentItemKey` are considered active context for this chat.
  - **Object Structure:**
    - `type` / `data`: The standard LangChain `StoredMessage` shape produced by `BaseMessage.toDict()`.
    - `data.response_metadata`: Provider and LangChain raw metadata. This is not duplicated under the Ask My Paper metadata object.
    - `data.response_metadata.askMyPaper`: Ask My Paper UI metadata such as timestamp, provider, model, thoughts, citations, and diagnostics.
