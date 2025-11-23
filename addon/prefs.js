pref("__prefsPrefix__.geminiApiKey", "");
pref("__prefsPrefix__.geminiSystemPrompt", "あなたは優秀なアシスタントです。提供されたコンテキストに基づいて質問に答えてください。回答は必ず日本語で行い、数式にはKatexを使用したマークダウン形式で記述してください。");
pref("__prefsPrefix__.contextWindowSize", 32);
pref("__prefsPrefix__.promptForSelection", "あなたは正確性を重視する専門的なリサーチアシスタントです。\n提示されたテキストについて以下の2点を日本語で解説してください。\n\n1.  **一般的な説明**: 概念の定義・背景について、Google検索を用いて正確かつ一般性を意識し解説\n2.  **PDFでの文脈**: このPDFにおける概念の意味と重要性を、その文脈から深く掘り下げて解説。\n\n追加のコメントや余計な内容は含めず、以下の形式で出力してください。\n\n### 一般的な説明\n\n### PDFにおける関連性\n\n---\n\n**選択されたテキスト:**\n{selectedText}");
pref("__prefsPrefix__.geminiModelList", "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.5-pro,gemini-3-pro-preview");
pref("__prefsPrefix__.geminiSelectedModel", "gemini-2.5-flash-lite");
pref("__prefsPrefix__.geminiUseGoogleSearch", false);