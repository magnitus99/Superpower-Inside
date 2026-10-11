import type { App } from 'obsidian';
import type { TernlightWorkerResponse } from './ternlight-runtime';

type Listener = (status: TernlightWorkerResponse | undefined) => void;
const states = new WeakMap<App, Map<object, TernlightWorkerResponse>>();
const listeners = new WeakMap<App, Set<Listener>>();

export function updateEmbeddingGemmaStatus(
  app: App,
  owner: object,
  status?: TernlightWorkerResponse,
): void {
  let active = states.get(app);
  if (!active) states.set(app, (active = new Map<object, TernlightWorkerResponse>()));
  if (status) active.set(owner, status);
  else active.delete(owner);
  for (const listener of listeners.get(app) ?? []) listener(currentStatus(app));
}

function currentStatus(app: App): TernlightWorkerResponse | undefined {
  return Array.from(states.get(app)?.values() ?? []).find(
    (status) => status.backend === 'wasm' && status.gpuAvailable === true,
  );
}

export function subscribeEmbeddingGemmaStatus(app: App, listener: Listener): () => void {
  let subscribers = listeners.get(app);
  if (!subscribers) listeners.set(app, (subscribers = new Set()));
  subscribers.add(listener);
  listener(currentStatus(app));
  return () => subscribers.delete(listener);
}
