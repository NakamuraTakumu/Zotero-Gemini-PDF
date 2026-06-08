import { StoredMessage } from "@langchain/core/messages";
import { ProviderId } from "../../types/chat";
import { getPref } from "../../utils/prefs";
import {
  PREF_CONTEXT_WINDOW_SIZE,
  PREF_TITLE_GENERATION_MODEL,
  PREF_TITLE_GENERATION_PROMPT,
  PREF_TITLE_GENERATION_PROVIDER,
} from "../../utils/constants";
import { getProviderConfig, parseModelList } from "../../utils/providerConfig";
import { sendMessageToLlm } from "../llm/chat";
import { toStoredMessageView } from "../llm/langChainMessages";
import { getTitleGenerationProvider, isProviderId } from "../llm/provider";

export class TitleGenerationService {
  async generateInitialTitle(
    history: StoredMessage[],
  ): Promise<string | undefined> {
    if (history.length < 2) {
      return undefined;
    }

    const userPrompt = this.getDisplayText(history[0]);
    const modelResponse = this.getDisplayText(history[1]);
    const titlePrompt = this.buildBasePrompt(userPrompt, modelResponse);
    return this.requestTitle(titlePrompt);
  }

  async regenerateTitleFromTopHistory(
    history: StoredMessage[],
  ): Promise<string | undefined> {
    if (history.length === 0) {
      return undefined;
    }

    const historyLimit = (getPref(PREF_CONTEXT_WINDOW_SIZE) as number) || 32;
    const historyForTitle =
      historyLimit > 0 ? history.slice(0, historyLimit) : [...history];
    const views = historyForTitle.map((message) =>
      toStoredMessageView(message),
    );
    const firstUserMessage = views.find((m) => m.role === "user");
    const firstModelMessage = views.find((m) => m.role === "assistant");
    const userPrompt = firstUserMessage?.displayText || "";
    const modelResponse = firstModelMessage
      ? firstModelMessage.displayText
      : "";
    const basePrompt = this.buildBasePrompt(userPrompt, modelResponse);

    const historyTranscript = views
      .map((message, index) => {
        const roleLabel = message.role === "user" ? "User" : "Assistant";
        const text = message.displayText;
        return `${index + 1}. ${roleLabel}: ${text}`;
      })
      .join("\n");

    const titlePrompt =
      `${basePrompt}\n\n` +
      `Use the following chat history (oldest first, first ${historyForTitle.length} messages) as primary context for title regeneration:\n` +
      `${historyTranscript}`;
    return this.requestTitle(titlePrompt);
  }

  private getDisplayText(message: StoredMessage): string {
    return toStoredMessageView(message).displayText;
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
      `[Ask My Paper] Title generation request: provider=${providerForTitle}, model=${modelForTitle}, webSearch=false, reasoning=off`,
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
