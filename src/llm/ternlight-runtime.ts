import { normalizePath, type App } from 'obsidian';

import * as ternlightGlue from '../../node_modules/@ternlight/base/pkg-bundler/tern_engine_bg.js';
import { ensureTernlightModel, TERNLIGHT_MODEL_FILE_NAME } from './ternlight-model';

export interface TernlightRuntimeOptions {
  app: App;
  pluginId: string;
  pluginVersion: string;
}

let initialization: Promise<void> | null = null;
let initializationKey = '';

async function initializeTernlight(options: TernlightRuntimeOptions): Promise<void> {
  const modelPath = normalizePath(
    `${options.app.vault.configDir}/plugins/${options.pluginId}/${TERNLIGHT_MODEL_FILE_NAME}`,
  );
  const wasmBytes = await ensureTernlightModel({
    adapter: options.app.vault.adapter,
    modelPath,
    pluginVersion: options.pluginVersion,
  });
  const imports = {
    './tern_engine_bg.js': ternlightGlue as unknown as WebAssembly.ModuleImports,
  };
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  ternlightGlue.__wbg_set_wasm(instance.exports);
  const start = instance.exports.__wbindgen_start as (() => void) | undefined;
  start?.();
}

export async function getTernlightEmbedder(
  options: TernlightRuntimeOptions,
): Promise<(text: string) => Float32Array> {
  const nextKey = `${options.app.vault.configDir}:${options.pluginId}:${options.pluginVersion}`;
  if (initializationKey !== nextKey) {
    initialization = null;
    initializationKey = nextKey;
  }
  initialization ??= initializeTernlight(options).catch((error: unknown) => {
    initialization = null;
    throw error;
  });
  await initialization;
  return ternlightGlue.embed;
}
