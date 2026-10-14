import { App, Modal, Setting, SecretComponent } from 'obsidian';
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
    let url = this.server?.url ?? '';
    let transport = this.server?.transport ?? (url ? 'http' : 'stdio');
    let authTokenSecret = this.server?.authTokenSecret ?? '';
    let args = JSON.stringify(this.server?.args ?? [], null, 2);
    let env = JSON.stringify(this.server?.env ?? {}, null, 2);
    const body = this.contentEl;
    body.classList.add('superpower-inside-mcp-draft');
    const feedback = body.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    const localRows: Setting[] = [];
    const remoteRows: Setting[] = [];
    const refreshTransport = (): void => {
      for (const row of localRows)
        row.settingEl.toggleClass('superpower-inside-hidden', transport !== 'stdio');
      for (const row of remoteRows)
        row.settingEl.toggleClass('superpower-inside-hidden', transport === 'stdio');
    };
    new Setting(body).setName(t('settingsServerName')).addText((text) => {
      text.inputEl.required = true;
      text.inputEl.setAttribute('aria-label', t('settingsServerName'));
      text.setValue(name).onChange((value) => {
        name = value;
      });
    });
    new Setting(body).setName(t('settingsServerTransport')).addDropdown((dropdown) => {
      dropdown.selectEl.setAttribute('aria-label', t('settingsServerTransport'));
      dropdown
        .addOptions({ stdio: 'stdio', http: 'Streamable HTTP', sse: 'SSE' })
        .setValue(transport)
        .onChange((value) => {
          transport = value as 'stdio' | 'http' | 'sse';
          feedback.setText('');
          refreshTransport();
        });
    });
    remoteRows.push(
      new Setting(body).setName(t('settingsServerUrl')).addText((text) => {
        text.inputEl.setAttribute('aria-label', t('settingsServerUrl'));
        text.setValue(url).onChange((value) => {
          url = value;
        });
      }),
    );
    const authSetting = new Setting(body)
      .setName(t('settingsServerAuthSecret'))
      .setDesc(t('settingsServerAuthSecretDetail'));
    authSetting.controlEl.setAttribute('role', 'group');
    authSetting.controlEl.setAttribute('aria-label', t('settingsServerAuthSecret'));
    new SecretComponent(this.app, authSetting.controlEl)
      .setValue(authTokenSecret)
      .onChange((value) => {
        authTokenSecret = value;
      });
    remoteRows.push(authSetting);
    localRows.push(
      new Setting(body).setName(t('settingsServerCommand')).addText((text) => {
        text.inputEl.setAttribute('aria-label', t('settingsServerCommand'));
        text.setValue(command).onChange((value) => {
          command = value;
        });
      }),
    );
    localRows.push(
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
        }),
    );
    localRows.push(
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
        }),
    );
    refreshTransport();
    new Setting(body)
      .addButton((button) => button.setButtonText(t('cancel')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t('settingsKeepDraft'))
          .setCta()
          .onClick(() => {
            const configText =
              transport === 'stdio'
                ? `{"command":${JSON.stringify(command.trim())},"args":${args},"env":${env}}`
                : JSON.stringify({
                    url: url.trim(),
                    transport,
                    ...(authTokenSecret.trim() ? { authTokenSecret: authTokenSecret.trim() } : {}),
                  });
            const payload = `{"mcpServers":{${JSON.stringify(name.trim())}:${configText}}}`;
            const result = validateMcpJson(payload);
            if (!result.valid) {
              feedback.setText(t('mcpJsonLintError', { error: result.error ?? '' }));
              return;
            }
            const data = result.data as {
              mcpServers: Record<string, Omit<MCPServerConfig, 'name'>>;
            };
            const [serverName, config] = Object.entries(data.mcpServers)[0];
            if (!this.onDraft({ name: serverName, ...config, command: config.command ?? '' })) {
              feedback.setText(t('settingsServerNameExists'));
              return;
            }
            feedback.setText('');
            this.close();
          }),
      );
  }
}
