type TestWindow = typeof globalThis &
  Pick<Window, 'clearInterval' | 'clearTimeout' | 'setInterval' | 'setTimeout'>;

const testGlobal = globalThis as typeof globalThis & { window?: TestWindow };

if (!testGlobal.window) {
  Object.defineProperty(testGlobal, 'window', {
    configurable: true,
    value: testGlobal,
  });
}
