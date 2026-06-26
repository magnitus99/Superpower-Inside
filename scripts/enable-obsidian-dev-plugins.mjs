#!/usr/bin/env node

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const separator = arg.indexOf("=");
    return separator === -1
      ? [arg, "true"]
      : [arg.slice(0, separator), arg.slice(separator + 1)];
  }),
);

const port = Number(args.get("--port") ?? "9222");
const pluginId = args.get("--plugin") ?? "superpower-inside";
const deadlineMs = Date.now() + Number(args.get("--timeout-ms") ?? "45000");

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid DevTools port: ${String(args.get("--port"))}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return response.json();
}

async function waitForPageTarget() {
  let lastError = null;

  while (Date.now() < deadlineMs) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page =
        targets.find((target) => target.type === "page" && target.url.includes("index.html")) ??
        targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) {
        return page;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(
    `Timed out waiting for Obsidian DevTools page on port ${port}: ${String(
      lastError?.message ?? lastError ?? "no target",
    )}`,
  );
}

async function evaluateInPage(webSocketDebuggerUrl, expression) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(JSON.stringify(message.error)));
    } else {
      resolve(message.result);
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  try {
    await send("Runtime.enable");
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
    }

    return result.result?.value;
  } finally {
    socket.close();
  }
}

const page = await waitForPageTarget();
const status = await evaluateInPage(
  page.webSocketDebuggerUrl,
  `(async () => {
    const pluginId = ${JSON.stringify(pluginId)};
    const requiredPlugins = ["hot-reload", pluginId];
    for (let attempt = 0; attempt < 45; attempt += 1) {
      if (globalThis.app?.plugins && globalThis.app?.vault) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!globalThis.app?.plugins || !globalThis.app?.vault) {
      return { ok: false, reason: "Obsidian app was not ready." };
    }

    localStorage.setItem("enable-plugin-" + app.appId, "true");
    await app.plugins.setEnable(true);
    for (const id of requiredPlugins) {
      await app.plugins.enablePlugin(id);
    }

    return {
      ok: Boolean(app.plugins.plugins[pluginId]),
      vaultName: app.vault.getName(),
      basePath: app.vault.adapter.basePath,
      enabledPlugins: Array.from(app.plugins.enabledPlugins).filter(
        (id) => id === pluginId || id === "hot-reload",
      ),
      loadedPlugins: Object.keys(app.plugins.plugins).filter(
        (id) => id === pluginId || id === "hot-reload",
      ),
      commands: Object.keys(app.commands.commands).filter((id) => id.startsWith(pluginId + ":")),
    };
  })()`,
);

if (!status?.ok) {
  throw new Error(`Failed to load ${pluginId}: ${JSON.stringify(status)}`);
}

console.log(JSON.stringify(status, null, 2));
