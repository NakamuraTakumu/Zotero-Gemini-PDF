pref("__prefsPrefix__.geminiApiKey", "");
pref("__prefsPrefix__.geminiSystemPrompt", "あなたは優秀なアシスタントです。提供されたコンテキストに基づいて質問に答えてください。回答は必ず日本語で行い、数式にはKatexを使用したマークダウン形式で記述してください。");
pref("__prefsPrefix__.contextWindowSize", 32);
pref("__prefsPrefix__.promptForSelection", "あなたは専門的なリサーチアシスタントです。\nこれから提示するPDFから選択されたテキストについて、以下の2つの観点から簡潔な解説を生成してください。\n\n1.  **一般的な説明**: テキストに含まれる主要な概念について、Google検索などを活用し、その定義や意味、背景を簡潔に客観的に説明してください。\n2.  **PDFにおける文脈**: その概念が、現在読んでいるこのPDF文書において、どのような意味で使われ、どのように重要であるかを簡潔に説明してください。\n\n回答は必ず日本語で行い、以下のマークダウン形式で出力してください。これ以外の形式や追加のコメントは一切含めないでください。\n\n### 一般的な説明\nここに一般的な説明を記述してください。\n\n### PDFにおける関連性\nここにPDFの文脈における関連性の説明を記述してください。\n\n---\n\n**選択されたテキスト:**\n{selectedText}");
pref("__prefsPrefix__.geminiModelList", "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.5-pro,gemini-3-pro-preview");
pref("__prefsPrefix__.geminiSelectedModel", "gemini-2.5-flash-lite");
pref("__prefsPrefix__.geminiUseGoogleSearch", false);