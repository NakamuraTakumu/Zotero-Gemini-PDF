pref("__prefsPrefix__.geminiApiKey", "");
pref("__prefsPrefix__.geminiSystemPrompt", "あなたは優秀なアシスタントです。提供されたコンテキストに基づいて質問に答えてください。回答は必ず日本語で行い、数式にはKatexを使用したマークダウン形式で記述してください。");
pref("__prefsPrefix__.contextWindowSize", 32);
pref("__prefsPrefix__.promptForSelection", "あなたは専門的なリサーチアシスタントです。\n提示されたテキストについて、以下の2点を日本語で解説してください。\n\n1.  **一般的な説明**: Google検索などを活用し、主要な概念の定義・背景を客観的に解説。\n2.  **PDFでの文脈**: このPDFにおける概念の意味と重要性を解説。\n\n必ず以下の形式で、追加のコメントは含めずに出力してください。\n\n### 一般的な説明\n(説明)\n\n### PDFにおける関連性\n(説明)\n\n---\n\n**選択されたテキスト:**\n{selectedText}");
pref("__prefsPrefix__.geminiModelList", "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.5-pro,gemini-3-pro-preview");
pref("__prefsPrefix__.geminiSelectedModel", "gemini-2.5-flash-lite");
pref("__prefsPrefix__.geminiUseGoogleSearch", false);