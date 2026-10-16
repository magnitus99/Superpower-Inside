// 이 함수는 CLI를 통해 앱 안에서 실행됩니다. 사용자 문서·설정은 읽지 않습니다.
export async function captureReference() {
  // CLI의 Node require에는 플러그인 API가 없습니다. 앱의 로더에 메모리 전용
  // 모듈을 전달해 같은 API를 받고, 실제 플러그인 등록·파일 읽기는 하지 않습니다.
  const fixtureApp = Object.create(app);
  Object.defineProperty(fixtureApp, 'vault', {
    value: {
      adapter: {
        read: async () =>
          "module.exports=class extends require('obsidian').Plugin{constructor(...args){super(...args);this.api=require('obsidian')}load(){}loadCSS(){}}",
      },
    },
  });
  const loader = {
    app: fixtureApp,
    isEnabled: () => true,
    plugins: {},
    manifests: { 'preview-reference': { id: 'preview-reference', dir: 'preview-reference' } },
  };
  const plugin = await app.plugins.loadPlugin.call(loader, 'preview-reference');
  const api = plugin?.api;
  if (!api?.MarkdownRenderer || !api?.Modal)
    throw Error('앱 API 캡처 로더와 현재 버전이 호환되지 않습니다.');
  const sheet = Array.from(document.styleSheets).find((item) => item.href?.endsWith('/app.css'));
  if (!sheet) throw Error('공식 app.css를 찾을 수 없습니다.');
  const css = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
  const icons = {};
  for (const name of api.getIconIds()) {
    const svg = api.getIcon(name);
    if (svg) icons[name] = svg.outerHTML;
  }
  const markdown = {
    ko: '## 검수용 답변\n\n**주제별 정리**와 *날짜별 기록*을 함께 사용할 수 있습니다.\n\n- 관련 생각을 모읍니다.\n- 시간에 따른 변화를 살핍니다.\n\n> 확인한 자료의 범위에 한정한 설명입니다.\n\n| 방식 | 목적 |\n| --- | --- |\n| 주제 | 비교와 연결 |\n| 날짜 | 순서와 변화 |\n\n```javascript\nconst example = "synthetic";\n```\n\n[공개 링크](https://example.com)와 `inline code`를 확인합니다.',
    en: '## Preview answer\n\n**Topic notes** and *daily records* can work together.\n\n- Group related ideas.\n- Follow changes over time.\n\n> This explanation is limited to the available sources.\n\n| Method | Purpose |\n| --- | --- |\n| Topic | Compare and connect |\n| Date | Sequence and change |\n\n```javascript\nconst example = "synthetic";\n```\n\nCheck a [public link](https://example.com) and `inline code`.',
  };
  const rendered = {};
  const component = new api.Component();
  component.load();
  try {
    for (const [language, text] of Object.entries(markdown)) {
      const container = document.createElement('div');
      await api.MarkdownRenderer.render(app, text, container, '', component);
      rendered[language] = container.outerHTML;
    }
  } finally {
    component.unload();
  }
  const modal = new api.Modal(app);
  // 기본 테마만 적용한 격리 문서에서 제어의 계산값을 측정합니다.
  const frame = document.createElement('iframe');
  frame.hidden = true;
  document.body.appendChild(frame);
  const measurements = {};
  try {
    const doc = frame.contentDocument;
    const base = doc.createElement('base');
    base.href = document.baseURI;
    doc.head.appendChild(base);
    const style = doc.createElement('style');
    style.textContent = css;
    doc.head.appendChild(style);
    const button = doc.createElement('button');
    button.textContent = '검수';
    doc.body.appendChild(button);
    for (const theme of ['theme-light', 'theme-dark']) {
      doc.body.className = `mod-macos ${theme}`;
      const computed = frame.contentWindow.getComputedStyle(button);
      measurements[theme] = Object.fromEntries(
        ['font-family', 'font-size', 'height', 'border-radius', 'color', 'background-color'].map(
          (property) => [property, computed.getPropertyValue(property)],
        ),
      );
    }
  } finally {
    frame.remove();
  }
  return JSON.stringify({
    version: api.apiVersion,
    css,
    icons,
    markdown,
    rendered,
    modal: modal.containerEl.outerHTML,
    measurements,
  });
}
