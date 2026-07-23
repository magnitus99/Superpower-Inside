import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(__dirname, '../..');
const packageJsonPath = resolve(repositoryRoot, 'package.json');
const runtimeRoots = [
  'src/rag',
  'src/graph',
  'src/chat/context.ts',
  'src/chat/context-budget.ts',
  'src/chat/context-expansion.ts',
  'src/chat/mention-parser.ts',
  'src/chat/source-validation.ts',
  'src/chat/assistant-response-classifier.ts',
  'src/chat/mcp-tool-execution.ts',
  'src/chat/persistence.ts',
  'src/utils/vault.ts',
];
const contractFiles = ['AGENTS.md', 'docs/README_FOR_DEV.md'];

function listTypeScriptFiles(path: string): string[] {
  const absolutePath = resolve(repositoryRoot, path);
  const stats = statSync(absolutePath);
  if (stats.isFile()) {
    return absolutePath.endsWith('.ts') && !absolutePath.endsWith('.test.ts') ? [absolutePath] : [];
  }

  return readdirSync(absolutePath).flatMap((entry) => {
    const child = join(absolutePath, entry);
    const childStats = statSync(child);
    if (childStats.isDirectory()) return listTypeScriptFiles(relative(repositoryRoot, child));
    return child.endsWith('.ts') && !child.endsWith('.test.ts') ? [child] : [];
  });
}

function findOffenders(files: readonly string[], patterns: readonly RegExp[]): string[] {
  return files.flatMap((file) => {
    const absolutePath = resolve(repositoryRoot, file);
    return readFileSync(absolutePath, 'utf8')
      .split('\n')
      .map((line, index) => ({ line, index: index + 1 }))
      .filter(({ line }) => patterns.some((pattern) => pattern.test(line)))
      .map(({ line, index }) => `${file}:${index}: ${line.trim()}`);
  });
}

function readPackageScripts(): Record<string, string> {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return packageJson.scripts ?? {};
}

describe('Rust wrapper boundary', () => {
  it('npm build와 dev는 Rust/WASM build를 먼저 실행한다', () => {
    const scripts = readPackageScripts();

    expect(scripts['wasm:build']).toBe(
      'node scripts/run-fish.mjs scripts/build-rag-wasm.fish && node scripts/build-graph-worker.mjs && node scripts/build-bm25-worker.mjs && node scripts/build-vector-search-worker.mjs && node scripts/build-ternlight-worker.mjs',
    );
    expect(scripts.build?.startsWith('npm run wasm:build && ')).toBe(true);
    expect(scripts.dev?.startsWith('npm run wasm:build && ')).toBe(true);
  });

  it('런타임 RAG/GraphRAG 소스에 TypeScript 계산 fallback helper를 두지 않는다', () => {
    const runtimeFiles = runtimeRoots
      .flatMap(listTypeScriptFiles)
      .map((file) => relative(repositoryRoot, file));

    expect(
      findOffenders(runtimeFiles, [
        /\b\w+WithTypeScript\b/,
        /const\s+(missingSources|fallbackEntries)\b/u,
        /const\s+seen\s*=\s*new Set\(this\.entries\.map/u,
        /this\.entries\s*=\s*this\.entries\.filter\(\(entry\)\s*=>\s*entry\.metadata\.filePath\s*!==\s*filePath\)/u,
        /const\s+uniqueFiles\s*=\s*new Set\(this\.entries\.map/u,
        /const\s+allowed\s*=\s*new Set\(filePaths\)/u,
        /const\s+byId\s*=\s*new Map\(this\.entries\.map/u,
        /Object\.entries\(this\.data\.docSources\)/u,
        /Object\.values\(this\.data\.docLengths\)\.reduce/u,
        /for\s*\(const\s+term\s+of\s+Object\.keys\(this\.data\.inverted\)\)/u,
        /new Set\(tokenize\(query\)\)/u,
        /new Map\(fileIndexRecords\.map/u,
        /fileIndexRecords\.reduce\(\(total,\s*record\)\s*=>\s*total\s*\+\s*record\.vectorCount/u,
        /\b(healthyDocuments|missingDocuments|staleDocuments|unknownDocuments)\+\+/u,
        /function\s+getFileIndexState\b/u,
        /function\s+statusSortOrder\b/u,
        /const\s+filesByPath\s*=\s*new Map\(files\.map/u,
        /const\s+updatePaths\s*=\s*new Set\(status\.updateRequiredDocuments\.map/u,
        /const\s+cacheByEntryId\s*=\s*new Map\(cacheRecords\.map/u,
        /const\s+vectorFilePaths\s*=\s*new Set\(fileIndexRecords\.map/u,
        /const\s+staleFiles\s*=\s*new Set<string>\(\)/u,
        /const\s+relevantEntryIds\s*=\s*\[/u,
        /const\s+entriesById\s*=\s*new Map\(entries\.map/u,
        /const\s+freshCacheCountByFilePath\s*=\s*new Map<string,\s*number>\(\)/u,
        /function\s+countUnique\b/u,
        /function\s+getFilePathForMissingEntry\b/u,
        /aliases:\s*\[\.\.\.new Set\(\[\.\.\.existing\.aliases,\s*\.\.\.next\.aliases\]\)\]/u,
        /evidenceIds:\s*\[\.\.\.new Set\(\[\.\.\.existing\.evidenceIds,\s*\.\.\.next\.evidenceIds\]\)\]/u,
        /Math\.max\(existing\.confidence,\s*next\.confidence\)/u,
        /cached\?\.contentHash\s*===\s*input\.contentHash/u,
        /cached\.extractionModelKey\s*===\s*input\.extractionModelKey/u,
        /cached\.ontologySchemaId\s*===\s*input\.ontologySchemaId/u,
        /cached\.ontologyVersion\s*===\s*input\.ontologyVersion/u,
        /const\s+pathSet\s*=\s*new Set\(filePaths\)/u,
        /const\s+idSet\s*=\s*new Set\(entryIds\)/u,
        /const\s+removedEvidenceIds\s*=\s*new Set/u,
        /const\s+deletedEntityIdSet\s*=\s*new Set/u,
        /const\s+deletedRelationIdSet\s*=\s*new Set/u,
        /evidence\.filter\(\(e\)\s*=>\s*pathSet\.has\(e\.filePath\)\)/u,
        /facts\.filter\(\(f\)\s*=>\s*pathSet\.has\(f\.filePath\)\)/u,
        /cache\.filter\(\(c\)\s*=>\s*idSet\.has\(c\.entryId\)\)/u,
        /claim\.entityIds\.filter\(\(id\)\s*=>\s*!deletedEntityIdSet\.has\(id\)\)/u,
        /claim\.relationIds\.filter\(\(id\)\s*=>\s*!deletedRelationIdSet\.has\(id\)\)/u,
        /function\s+withoutRemovedEvidence\b/u,
        /const\s+evidenceById\s*=\s*new Map/u,
        /const\s+paths\s*=\s*\[\.\.\.new Set\(evidenceRecords\.map/u,
        /const\s+entriesById\s*=\s*new Map\(/u,
        /const\s+entryIndexById\s*=\s*new Map<string,\s*number>\(\)/u,
        /function\s+getOrCreateEntryIndex\b/u,
        /function\s+getOrCreateIndex\b/u,
        /function\s+pushEvidenceIndices\b/u,
        /function\s+clampScore\b/u,
        /function\s+getOrCreateNumericKey\b/u,
        /function\s+detectCommunitiesWithRust\b/u,
        /function\s+extractUniqueEntityIds\b/u,
        /const\s+compatibleEntities\s*=\s*entities\.filter/u,
        /let\s+bestMatch\b/u,
        /const\s+sourceAnalysis\s*=\s*analyzeRetrievalSources/u,
        /const\s+combinedBase\s*=/u,
        /const\s+rrfScore\s*=\s*calculateRrfScore/u,
        /const\s+combined\s*=\s*calculateHybridScore/u,
        /function\s+buildRerankMessages\b/u,
        /function\s+truncateForRerank\b/u,
        /const\s+mentionedNames\s*=\s*new Set/u,
        /const\s+matchedEntities\s*=\s*entities\.filter/u,
        /const\s+matchedRelations\s*=\s*relations\.filter/u,
        /const\s+entityById\s*=\s*new Map/u,
        /const\s+entityIds\s*=\s*\(claim\.entityNames/u,
        /entitiesByName\.get\(normalizeName\(name\)\)\?\.id/u,
        /const\s+source\s*=\s*entitiesByName\.get\(normalizeName\(relation\.source\)\)/u,
        /const\s+target\s*=\s*entitiesByName\.get\(normalizeName\(relation\.target\)\)/u,
        /function\s+isKnownEntityType\b/u,
        /function\s+isKnownClaimType\b/u,
        /schema\.entityTypes\.some/u,
        /schema\.claimTypes\.some/u,
        /const\s+entityIds\s*=\s*\[\.\.\.new Set\(entities\.map/u,
        /const\s+entityIndexById\s*=\s*new Map\(entityIds\.map/u,
        /const\s+groupedEntities\s*=\s*new Map/u,
        /const\s+communityRelations\s*=\s*new Map/u,
        /const\s+communityClaims\s*=\s*new Map/u,
        /toLowerCase\(\)\.endsWith\('\.md'\)/u,
        /references\.some\(\(reference\)\s*=>\s*reference\.file\.path\s*===\s*file\.path\)/u,
        /\.find\(\(file\)\s*=>\s*file\.basename\s*===\s*plan\.fallbackBasename\)/u,
        /file\.path\.startsWith\(`\$\{path\}\/`\)/u,
        /file\.path\.startsWith\(folder \+ '\/'\)/u,
        /\.filter\(\(citation\)\s*=>\s*citation\.status\s*===\s*'verified'\)/u,
        /function\s+collectExistingAliases\b/u,
        /block\.text\.length\s*>\s*remainingChars/u,
        /block\.text\.slice\(0,\s*remainingChars\)/u,
        /remainingChars\s*-=\s*text\.length/u,
        /mentions\.filter\(\(item\)\s*=>\s*item\.type\s*===/u,
        /mentions\.some\(\(mention\)\s*=>\s*mention\.type\s*===/u,
        /mention\.type\s*===\s*'file'\s*\|\|\s*mention\.type\s*===\s*'folder'/u,
        /entities\.find\(\(entity\)\s*=>\s*entity\.id\s*===\s*rel\.sourceEntityId/u,
        /entities\.find\(\(entity\)\s*=>\s*entity\.id\s*===\s*rel\.targetEntityId/u,
        /matchedRelations\.slice\(0,\s*15\)/u,
        /entity\.description\.slice\(0,\s*200\)/u,
        /rel\.description\.slice\(0,\s*150\)/u,
        /preferredServerNames\.filter/u,
        /!preferred\.includes\(serverName\)/u,
        /tools\.some\(\(tool\)\s*=>\s*tool\.name\s*===\s*toolName\)/u,
        /const\s+TEXT_EXTENSIONS\s*=\s*new Set/u,
        /const\s+SENSITIVE_FILE_NAMES\s*=\s*new Set/u,
        /function\s+isSensitiveFile\b/u,
        /function\s+isKnownTextFileName\b/u,
        /function\s+canReadAsText\b/u,
        /function\s+isProbablyText\b/u,
        /file\.stat\.size\s*===\s*0/u,
        /candidateFilePaths\.slice\(0,\s*this\.maxFilesPerRun\)/u,
        /filterGraphRagMarkdownFilePaths\(\[\.\.\.this\.failedFilePaths\]\)\.sort\(\)/u,
        /filterGraphRagMarkdownFilePaths\(\[\.\.\.options\.staleFilePaths\]\)\.sort\(\)/u,
        /filterProcessableGraphRagFilePaths\([^)]*\)\.sort\(\)/u,
        /const\s+unsupportedFilePaths\s*=\s*new Set/u,
        /unsupportedFilePaths\.add\(record\.filePath\)/u,
        /relations\.filter\(\(relation\)\s*=>\s*relation\.ontologySchemaId\s*===\s*this\.ontologySchema\.id\)/u,
        /communities\)\.filter\(\s*\(community\)\s*=>\s*community\.ontologySchemaId\s*===\s*this\.ontologySchema\.id/u,
        /\(community\)\s*=>\s*community\.ontologySchemaId\s*===\s*this\.ontologySchema\.id/u,
        /community\.ontologySchemaId\s*===\s*ontologySchemaId/u,
        /items\.findIndex\(\(candidate\)\s*=>\s*candidate\.entry\.id\s*===\s*item\.entry\.id\)/u,
        /this\.queryMode\s*===\s*'local'/u,
        /this\.queryMode\s*===\s*'hybrid'/u,
        /autoPlan\.queryMode\s*===/u,
        /autoPlan\.evidenceFirst/u,
        /fallback selection loop/iu,
        /function\s+(isSafeMention|extractEntityHints|isQuestionKeyword|createInitialCentroids|resolveClusterCount|cosineSimilarity|getHeadingRanges|isLineInRange|mergeEvidenceScores|createFileIndexRecordsFromEntries|createFileIndexRecord|toSortedFileTypeCounts|getExtensionLabel|extractSourceReferences|pathAliases|addWarning|detectQuestion|extractChoices|extractPrompt|extractLastQuestionBlock|isFollowUpSuggestion|isStructuredAnswer|parseMarkdownMessages|parseMessageMeta|extractNamedBlock|decodeTextBlock|extractPreview|countMarkdownMessages|parseInteger|deriveTitle|deriveSummary|createCitation|createPreview|isGraphVirtualSource|verifyGraphQueryResult)\b/u,
        /\b(addLinkedFilePaths|getHeadingNeighborEntries|parseRerankResponse|applyRerankOrder|parsePlannerResponse|parseJsonObject|createPathCandidates|normalizeVaultPath|ensureMarkdownExtension|stripMarkdownExtension|extractSourceReferences|pathAliases|detectQuestion|extractChoices|extractPrompt|extractLastQuestionBlock|parseMarkdownMessages|parseMessageMeta|extractNamedBlock|decodeTextBlock|extractPreview|countMarkdownMessages|parseInteger|deriveTitle|deriveSummary|createCitation|createPreview|isGraphVirtualSource|verifyGraphQueryResult)\b/u,
        /claim\.evidenceIds\.map/u,
      ]),
    ).toEqual([]);

    expect(findOffenders(['src/graph/query-engine.ts'], [/function\s+mergeCandidates\b/u])).toEqual(
      [],
    );

    expect(
      findOffenders(
        ['src/graph/status.ts'],
        [
          /function\s+getTotalCandidateFiles\b/u,
          /function\s+getFileIndexRecords\b/u,
          /function\s+filterProcessableGraphRagEntries\b/u,
          /filterProcessableGraphRagFilePaths\(/u,
          /entries\.filter\(\(entry\)\s*=>/u,
        ],
      ),
    ).toEqual([]);
  });

  it('계약 문서는 Rust/WASM 단독 계산 코어를 기준으로 설명한다', () => {
    expect(
      findOffenders(contractFiles, [
        /TS fallback/iu,
        /TypeScript fallback/iu,
        /기존 TypeScript.*fallback/iu,
        /초기화.*fallback/iu,
        /wire-format.*fallback/iu,
        /fallback.*계산/iu,
        /fallback selection loop/iu,
      ]),
    ).toEqual([]);
  });
});
