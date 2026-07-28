import { PROVIDERS, PROVIDER_CONFIGS } from "../../utils/providerConfig";

function buildProviderOptionsXhtml(): string {
  return PROVIDERS.map((provider) => {
    const { label } = PROVIDER_CONFIGS[provider];
    return `<html:option value="${provider}">${label}</html:option>`;
  }).join("");
}

export function buildReaderItemPaneBodyXhtml(): string {
  return `<html:div class="chat-container" xmlns:html="http://www.w3.org/1999/xhtml">
      <html:div class="chat-messages" id="chat-messages"></html:div>
      <html:div class="chat-resizer" id="chat-resizer"></html:div>
      <html:div class="chat-session-area">
          <html:label for="chat-session-switcher">Session:</html:label>
          <html:select id="chat-session-switcher" class="chat-session-switcher"></html:select>
          <html:button id="delete-session-button" class="delete-session-button" title="Delete chat" aria-label="Delete chat">×</html:button>
          <html:button id="regenerate-title-button" class="regenerate-title-button" title="Regenerate title" aria-label="Regenerate title">↻</html:button>
      </html:div>
      <html:div class="chat-model-selector-area">
          <html:div class="llm-primary-row">
              <html:span class="llm-field">
                  <html:label for="llm-provider-select">Provider</html:label>
                  <html:select id="llm-provider-select" class="llm-provider-select">
                      ${buildProviderOptionsXhtml()}
                  </html:select>
              </html:span>
              <html:span class="llm-field">
                  <html:label for="llm-model-select">Model</html:label>
                  <html:select id="llm-model-select" class="llm-model-select"></html:select>
              </html:span>
          </html:div>
          <html:div class="llm-option-row">
              <html:span class="llm-option-control">
                  <html:input type="checkbox" id="use-web-search-checkbox" />
                  <html:label for="use-web-search-checkbox" title="Use Web Search">Search</html:label>
              </html:span>
              <html:span class="llm-option-control">
                  <html:label for="reasoning-mode-select">Thinking</html:label>
                  <html:select id="reasoning-mode-select" class="reasoning-mode-select">
                      <html:option value="off">Off</html:option>
                      <html:option value="low">Low</html:option>
                      <html:option value="medium">Medium</html:option>
                      <html:option value="high">High</html:option>
                  </html:select>
              </html:span>
          </html:div>
      </html:div>

      <html:div class="chat-input-area">
          <html:textarea id="chat-input" class="chat-input" placeholder="Type a message..."></html:textarea>
          <html:div class="chat-buttons-container">
              <html:button id="send-button" class="send-button">Send</html:button>
              <html:button id="new-chat-button" class="new-chat-button">New</html:button>
          </html:div>
      </html:div>
  </html:div>`;
}
