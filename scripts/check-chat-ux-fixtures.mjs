import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(root, 'tests/fixtures/chat-ux');

function readJson(name) {
  return JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertExactIds(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert(
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${label} fixture ids mismatch: expected ${expectedSorted.join(', ')}, got ${actualSorted.join(', ')}`,
  );
}

const providerStreams = readJson('provider-streams.json');
assert(Array.isArray(providerStreams), 'provider-streams.json must be an array');
assertExactIds(
  providerStreams.map((fixture) => fixture.id),
  [
    'openai-sse',
    'openrouter-reasoning',
    'claude-thinking-tool-use',
    'ollama-ndjson',
    'request-url-buffered',
  ],
  'provider stream',
);
for (const fixture of providerStreams) {
  assert(fixture.provider, `provider stream ${fixture.id} must declare provider`);
  assert(fixture.transport, `provider stream ${fixture.id} must declare transport`);
  assert(Array.isArray(fixture.chunks) && fixture.chunks.length > 0, `${fixture.id} needs chunks`);
  assert(fixture.expected && Object.keys(fixture.expected).length > 0, `${fixture.id} needs expected`);
}

const chatTurns = readJson('chat-turns.json');
assert(Array.isArray(chatTurns), 'chat-turns.json must be an array');
assertExactIds(
  chatTurns.map((fixture) => fixture.id),
  [
    'normal-answer',
    'long-markdown',
    'code-fence',
    'tool-approval',
    'tool-failure',
    'source-warnings',
    'cancellation',
    'rate-limit',
    'missing-provider',
  ],
  'chat turn',
);
for (const fixture of chatTurns) {
  assert(fixture.stage, `chat turn ${fixture.id} must declare stage`);
  assert(fixture.providerCapability, `chat turn ${fixture.id} must declare providerCapability`);
  assert(Array.isArray(fixture.messages) && fixture.messages.length > 0, `${fixture.id} needs messages`);
  assert(fixture.expectedDom?.statusLabel, `${fixture.id} needs expectedDom.statusLabel`);
}

const visualA11y = readJson('visual-accessibility.json');
assertExactIds(
  visualA11y.viewports.map((viewport) => viewport.id),
  ['narrow-sidebar', 'medium-split-pane', 'wide-pane'],
  'visual viewport',
);
assert(
  Array.isArray(visualA11y.reducedMotion) &&
    visualA11y.reducedMotion.includes(false) &&
    visualA11y.reducedMotion.includes(true),
  'visual-accessibility.json must cover reduced motion on and off',
);
for (const flow of ['send-with-enter', 'mention-select-with-keyboard', 'tool-approve']) {
  assert(visualA11y.keyboardFlows.includes(flow), `missing keyboard flow: ${flow}`);
}
for (const selector of [
  '.superpower-inside-chat-input',
  '.superpower-inside-chat-readiness',
  '.superpower-inside-chat-message-status',
  '.superpower-inside-chat-citation-card',
  '.superpower-inside-chat-context-budget',
  '.superpower-inside-chat-data-boundary',
]) {
  assert(visualA11y.requiredSelectors.includes(selector), `missing required selector: ${selector}`);
}
for (const token of [
  '--superpower-inside-motion-fast',
  '--superpower-inside-motion-normal',
  '--superpower-inside-motion-slow',
  '--superpower-inside-motion-ease',
  '--superpower-inside-motion-distance',
]) {
  assert(visualA11y.motionTokens.includes(token), `missing motion token: ${token}`);
}
for (const selector of [
  '.superpower-inside-typing-dot',
  '.superpower-inside-tool-running-dots span',
  '.superpower-inside-chat-streaming-cursor::after',
]) {
  assert(
    visualA11y.reducedMotionSelectors.includes(selector),
    `missing reduced motion selector: ${selector}`,
  );
}
assert(
  Array.isArray(visualA11y.overflowSamples) && visualA11y.overflowSamples.length >= 2,
  'visual-accessibility.json needs long text overflow samples',
);

console.log('chat UX fixture gate passed.');
