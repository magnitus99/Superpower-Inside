import { join } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { cargoPrefix, prependCargoBin } from './rust-tool-versions.mjs';
import { root, run } from './script-process.mjs';

prependCargoBin();
process.env.RUSTUP_AUTO_INSTALL = '0';
process.env.CARGO_TARGET_DIR ||= join(root, ARTIFACT_PATHS.rust);
console.log('RAG core benchmark (release, median ns)');
run('rustup', [...cargoPrefix, 'test', '--release', '--workspace', '--frozen', 'bench_rag_core_runtime_medians', '--', '--ignored', '--nocapture']);
