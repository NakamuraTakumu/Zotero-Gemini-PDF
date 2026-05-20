import { ChatMessage, ProviderId } from "../../types/chat";
import { getPref } from "../../utils/prefs";
import { stripThoughtsFromText } from "../../utils/thoughts";
import {
  PREF_CONTEXT_WINDOW_SIZE,
  PREF_TITLE_GENERATION_MODEL,
  PREF_TITLE_GENERATION_PROMPT,
  PREF_TITLE_GENERATION_PROVIDER,
} from "../../utils/constants";
import { getProviderConfig, parseModelList } from "../../utils/providerConfig";
import { sendMessageToLlm } from "../llm/chat";
import { getTitleGenerationProvider, isProviderId } from "../llm/provider";

export class TitleGenerationService {
  async generateInitialTitle(
    history: ChatMessage[],
  ): Promise<string | undefined> {
    if (history.length < 2) {
      return undefined;
    }

    const userPrompt = history[0].parts[0].text;
    const firstModelMessage = history[1];
    const modelResponse = this.getDisplayText(firstModelMessage);
    const titlePrompt = this.buildBasePrompt(userPrompt, modelResponse);
    return this.requestTitle(titlePrompt);
  }

  async regenerateTitleFromTopHistory(
    history: ChatMessage[],
  ): Promise<string | undefined> {
    if (history.length === 0) {
      return undefined;
    }

    const historyLimit = (getPref(PREF_CONTEXT_WINDOW_SIZE) as number) || 32;
    const historyForTitle =
      historyLimit > 0 ? history.slice(0, historyLimit) : [...history];
    const firstUserMessage = historyForTitle.find((m) => m.role === "user");
    const firstModelMessage = historyForTitle.find((m) => m.role === "model");
    const userPrompt = firstUserMessage?.parts?.[0]?.text || "";
    const modelResponse = firstModelMessage
      ? this.getDisplayText(firstModelMessage)
      : "";
    const basePrompt = this.buildBasePrompt(userPrompt, modelResponse);

    const historyTranscript = historyForTitle
      .map((message, index) => {
        const roleLabel = message.role === "user" ? "User" : "Assistant";
        const text = this.getDisplayText(message);
        return `${index + 1}. ${roleLabel}: ${text}`;
      })
      .join("\n");

    const titlePrompt =
      `${basePrompt}\n\n` +
      `Use the following chat history (oldest first, first ${historyForTitle.length} messages) as primary context for title regeneration:\n` +
      `${historyTranscript}`;
    return this.requestTitle(titlePrompt);
  }

  private getDisplayText(message: ChatMessage): string {
    const rawText = message.parts?.[0]?.text || "";
    return message.role === "model"
      ? stripThoughtsFromText(rawText, message.thoughts)
      : rawText;
  }

  private buildBasePrompt(userPrompt: string, modelResponse: string): string {
    const promptTemplate = getPref(PREF_TITLE_GENERATION_PROMPT) as string;
    return promptTemplate
      .replace("{userPrompt}", userPrompt)
      .replace("{modelResponse}", modelResponse);
  }

  private async requestTitle(titlePrompt: string): Promise<string | undefined> {
    const providerForTitle = getTitleGenerationProvider();
    const modelForTitle = this.getTitleGenerationModel(providerForTitle);
    Zotero.log(
      `[Gemini PDF] Title generation request: provider=${providerForTitle}, model=${modelForTitle}, webSearch=false, reasoning=off`,
    );
    const { responseText } = await sendMessageToLlm([], titlePrompt, {
      provider: providerForTitle,
      modelName: modelForTitle,
      policy: { useWebSearch: false, reasoningMode: "off" },
    });
    return responseText ? this.cleanTitle(responseText) : undefined;
  }

  private getTitleGenerationModel(provider: ProviderId): string {
    const config = getProviderConfig(provider);
    const titleProviderPref = getPref(PREF_TITLE_GENERATION_PROVIDER);
    const configuredModel =
      ((getPref(PREF_TITLE_GENERATION_MODEL) as string) || "").trim() ||
      undefined;

    if (
      isProviderId(titleProviderPref) &&
      titleProviderPref === provider &&
      configuredModel &&
      parseModelList(config.currentModelList).includes(configuredModel)
    ) {
      return configuredModel;
    }

    return config.defaultTitleModel;
  }

  private cleanTitle(title: string): string {
    return title
      .trim()
      .replace(/^「|」$/g, "")
      .replace(/\.$/, "");
  }
}
