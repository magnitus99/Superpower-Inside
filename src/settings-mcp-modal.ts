import { App, Modal, Setting } from 'obsidian';
import { t } from './i18n';
import type { MCPServerConfig } from './settings';
import { validateMcpJson } from './utils/mcp-json';

/** 서버 프로세스에 적용하지 않고 부모 편집기의 초안만 수정합니다. */
export class McpServerDraftModal extends Modal {
  constructor(
    app: App,
    private readonly server: MCPServerConfig | null,
    private readonly onDraft: (server: MCPServerConfig) => boolean,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t(this.server ? 'settingsEditServer' : 'settingsAddServer'));
    let name = this.server?.name ?? '';
    let command = this.server?.command ?? '';
    let args = JSON.stringify(this.server?.args ?? [], null, 2);
    let env = JSON.stringify(this.server?.env ?? {}, null, 2);
    const body = this.contentEl;
    const feedback = body.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    new Setting(body).setName(t('settingsServerName')).addText((text) => {
      text.inputEl.required = true;
      text.inputEl.setAttribute('aria-label', t('settingsServerName'));
      text.setValue(name).onChange((value) => {
        name = value;
      });
    });
    new Setting(body).setName(t('settingsServerCommand')).addText((text) => {
      text.inputEl.required = true;
      text.inputEl.setAttribute('aria-label', t('settingsServerCommand'));
      text.setValue(command).onChange((value) => {
        command = value;
      });
    });
    new Setting(body)
      .setClass('superpower-inside-settings-block')
      .setName(t('settingsServerArgs'))
      .setDesc(t('settingsServerArgsDetail'))
      .addTextArea((text) => {
        text.inputEl.setAttribute('aria-label', t('settingsServerArgs'));
        text.inputEl.rows = 3;
        text.setValue(args).onChange((value) => {
          args = value;
        });
      });
    new Setting(body)
      .setClass('superpower-inside-settings-block')
      .setName(t('settingsServerEnv'))
      .setDesc(t('settingsServerEnvDetail'))
      .addTextArea((text) => {
        text.inputEl.setAttribute('aria-label', t('settingsServerEnv'));
        text.inputEl.rows = 3;
        text.inputEl.spellcheck = false;
        text.setValue(env).onChange((value) => {
          env = value;
        });
      });
    new Setting(body)
      .addButton((button) => button.setButtonText(t('cancel')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t('settingsKeepDraft'))
          .setCta()
          .onClick(() => {
            const payload = `{"mcpServers":{${JSON.stringify(name.trim())}:{"command":${JSON.stringify(command.trim())},"args":${args},"env":${env}}}}`;
            const result = validateMcpJson(payload);
            if (!result.valid) {
              feedback.setText(t('mcpJsonLintError', { error: result.error ?? '' }));
              return;
            }
            const data = result.data as {
              mcpServers: Record<string, Omit<MCPServerConfig, 'name'>>;
            };
            const [serverName, config] = Object.entries(data.mcpServers)[0];
            if (!this.onDraft({ name: serverName, ...config })) {
              feedback.setText(t('settingsServerNameExists'));
              return;
            }
            this.close();
          }),
      );
  }
}
