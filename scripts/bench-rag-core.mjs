import { run } from './script-process.mjs';

console.log('RAG core benchmark (release, median ns)');
run('cargo', ['test', '--release', '--workspace', 'bench_rag_core_runtime_medians', '--', '--ignored', '--nocapture']);
