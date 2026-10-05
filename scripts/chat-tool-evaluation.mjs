import path from 'node:path';

// 평가는 모델을 고르지 않습니다. 볼트에 저장된 활성 선택만 사용합니다.
export function createEvaluationProvider(runtime, settings) {
  if (!settings) return undefined;
  const parts = settings.chat.defaultModel.split(':');
  const model = parts.slice(2).join(':');
  const profile = settings.providerProfiles.find(
    (item) => parts[0] === 'profile' && item.id === parts[1],
  );
  if (!profile?.enabled || !profile.models.some((item) => item.id === model)) {
    throw new Error(
      '설정의 선택 모델을 사용할 수 없습니다. 평가를 위해 다른 모델을 선택하지 않습니다.',
    );
  }
  return runtime.createProviderForStrategy(
    profile.strategy,
    { ...profile, models: profile.models.map((item) => item.id) },
    model,
    profile.id,
  );
}

export function syntheticVault(runtime, test) {
  const files = test.files.map((item) =>
    Object.assign(Object.create(runtime.TFile.prototype), {
      path: item.path,
      name: path.basename(item.path),
      basename: path.basename(item.path, '.md'),
      extension: path.extname(item.path).slice(1),
      content: `${item.prefix ?? ''}${(item.repeat ?? '').repeat(item.repeatCount ?? 0)}${item.text}`,
      metadata: item.metadata ?? null,
      unreadable: item.unreadable ?? false,
      stat: { ctime: 1, mtime: item.modifiedAt ?? 2, size: 100 },
    }),
  );
  const folders = [
    ...new Set(files.map((file) => path.posix.dirname(file.path)).filter((value) => value !== '.')),
  ].map((value) =>
    Object.assign(Object.create(runtime.TFolder.prototype), {
      path: value,
      name: path.basename(value),
    }),
  );
  const find = (value) => files.find((file) => file.path === value);
  return {
    files,
    app: {
      vault: {
        getFiles: () => files,
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (value) =>
          find(value) ?? folders.find((folder) => folder.path === value) ?? null,
        cachedRead: async (file) => {
          if (file.unreadable) throw new Error('평가용 읽기 실패');
          return file.content;
        },
      },
      metadataCache: {
        resolvedLinks: {},
        getFileCache: (file) => file.metadata,
        getFirstLinkpathDest: (value, source) =>
          find(value) ??
          find(`${value}.md`) ??
          find(`${path.posix.dirname(source)}/${value}.md`) ??
          null,
      },
    },
  };
}

function createNative(runtime, vault) {
  return new runtime.NativeVaultToolRuntime(
    new runtime.ObsidianNativeVaultToolPort(
      vault.app,
      vault.scope ?? {
        listCandidateFiles: async () => vault.files,
        isCandidateFile: async (file) => vault.files.includes(file),
        isPathVisible: () => true,
      },
      vault.getQueryEngine ?? (() => null),
    ),
  );
}

// 정답 문서 집합은 모델 출력과 독립된 fixture에서 지정합니다.
export async function evaluateRetrieval(runtime, test, vault) {
  const native = createNative(runtime, vault);
  const results = [];
  for (const probe of test.retrieval ?? []) {
    const start = performance.now();
    const execution = await native.execute(
      JSON.stringify(probe.arguments),
      undefined,
      'superpower_inside_search',
    );
    const result = JSON.parse(execution.modelText);
    const paths = result.hits.map((hit) => hit.path);
    const found = probe.relevantPaths.filter((value) => paths.includes(value));
    results.push({
      query: probe.arguments.query,
      k: probe.arguments.limit ?? 8,
      relevantPaths: probe.relevantPaths,
      returnedPaths: paths,
      hitAtK: found.length > 0,
      recallAtK: found.length / probe.relevantPaths.length,
      elapsedMs: Math.round(performance.now() - start),
      scannedFiles: result.scannedFiles,
      unreadableFiles: result.unreadableFiles,
      totalHits: result.totalHits,
      truncated: result.truncated,
    });
  }
  return results;
}

// 화면 루프와 같은 실행·전사·정책·근거 계약을 사용하되 DOM만 제외합니다.
export async function evaluateToolLoop(runtime, provider, test, vault, protocol = 'native') {
  const start = performance.now();
  const native = createNative(runtime, vault);
  const definitions = runtime.createNativeVaultToolDefinitions();
  let messages = [
    {
      role: 'system',
      content: [
        test.systemPrompt ?? '한국어로 모든 하위 질문에 답하고 확인한 원문 경로와 행을 인용하세요.',
        protocol === 'native'
          ? runtime.createToolEvidencePrompt(definitions)
          : runtime.createCompatibilityToolPrompt(definitions),
      ].join('\n\n'),
    },
    ...(test.history ?? []),
    { role: 'user', content: test.question },
  ];
  let history = [],
    answer = '',
    providerCalls = 0,
    modelRequests = 0,
    requiredMisses = 0;
  let terminal = 'round-limit';
  const maxRounds = provider?.capability.maxToolRounds ?? 10;
  for (let round = 0; round <= maxRounds; round += 1) {
    const plan = runtime.planAgenticToolTurn({
      question: test.question,
      contextAttachments: [],
      explicitToolServerCount: 0,
      toolDefinitions: definitions,
      toolCalls: history,
      phase: round === 0 ? 'initial' : 'after-tools',
      round,
      maxRounds,
    });
    if (!plan) throw new Error('평가 정책 초기화 실패');
    const selected = runtime.selectAgenticToolDefinitions(definitions, plan.requiredToolNames);
    const checkpoint =
      protocol === 'compatibility'
        ? [runtime.createCompatibilityToolPrompt(selected), plan.checkpoint]
            .filter(Boolean)
            .join('\n\n')
        : plan.checkpoint;
    const requestMessages = runtime.appendAgenticCheckpoint(messages, checkpoint ?? '');
    let content = '',
      reasoning = '',
      calls = [];
    modelRequests += 1;
    if (provider) {
      providerCalls += 1;
      const deltas = new Map();
      await provider.streamChat(
        runtime.prepareProviderRequest(
          requestMessages,
          protocol === 'native' ? selected : undefined,
        ).messages,
        (chunk) => {
          content += chunk.content ?? '';
          reasoning += chunk.reasoning ?? '';
          for (const delta of chunk.toolCalls ?? []) {
            const previous = deltas.get(delta.index) ?? {
              id: '',
              name: '',
              arguments: '',
              status: 'running',
            };
            if (delta.id) previous.id = delta.id;
            previous.id ||= `eval-${round}-${delta.index}`;
            if (delta.function?.name) previous.name = delta.function.name;
            previous.arguments += delta.function?.arguments ?? '';
            deltas.set(delta.index, previous);
          }
        },
        0.7,
        protocol === 'native' ? selected : undefined,
        { toolChoice: protocol === 'native' ? plan.toolChoice : undefined },
      );
      calls = [...deltas.values()];
    } else {
      const scripted = test.toolRounds[round];
      if (scripted) {
        calls = scripted.map((call, index) => ({
          id: `eval-${round}-${index}`,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
          status: 'running',
        }));
        if (protocol === 'compatibility') {
          content = calls
            .map(
              (call) =>
                `<tool_call>${JSON.stringify({ name: call.name, arguments: JSON.parse(call.arguments) })}</tool_call>`,
            )
            .join('\n');
          calls = [];
        }
      } else content = test.offlineAnswer;
    }
    const parsed = runtime.parseCompatibilityToolTurn(
      content,
      reasoning,
      (channel, index) => `eval-${round}-${channel}-${index}`,
    );
    content = parsed.visibleContent;
    reasoning = parsed.visibleReasoning;
    calls = [...calls, ...parsed.toolCalls].slice(0, 8);
    if (plan.toolChoice === 'none' && calls.length > 0) {
      terminal = 'tool-after-closure';
      break;
    }
    if (calls.length === 0) {
      if (plan.toolChoice === 'required' && requiredMisses === 0 && round < maxRounds) {
        requiredMisses += 1;
        messages = [
          ...requestMessages,
          {
            role: 'user',
            content: '필요한 도구 호출이 누락되었습니다. 먼저 요구된 도구를 실행하세요.',
          },
        ];
        continue;
      }
      answer = content;
      terminal = plan.toolChoice === 'required' ? 'required-tool-missing' : 'answer';
      break;
    }
    if (round === maxRounds) break;
    const prepared = await runtime.prepareAssistantToolCalls({
      toolCalls: runtime.markRepeatedToolCalls(history, calls),
      nativeTool: native,
      registry: null,
      preferredServerNames: [],
      mcpMode: 'always-auto',
    });
    const executed = await runtime.executeAssistantToolCalls({
      toolCalls: prepared,
      nativeTool: native,
      registry: null,
      preferredServerNames: [],
    });
    history = [...history, ...executed];
    messages = runtime.appendAssistantToolRound(
      requestMessages,
      content,
      executed,
      protocol,
      reasoning,
    );
  }
  const contract = runtime.enforceNativeToolAnswerContract(answer, history);
  const citations = runtime.collectToolCitations([], history);
  const reads = history
    .filter((call) => call.status === 'success')
    .flatMap((call) => {
      try {
        const result = JSON.parse(call.normalizedResult);
        return result.action === 'read' ? [result] : [];
      } catch {
        return [];
      }
    });
  const readPaths = [...new Set(reads.map((read) => read.path))];
  const expectedPaths = test.relevantPaths ?? [];
  const factMatches = test.expectedFacts.filter((fact) => answer.includes(fact));
  const forbidden = test.forbiddenClaims.filter((fact) => answer.includes(fact));
  return {
    id: test.id,
    workflow: 'tool-loop',
    protocol,
    contractPassed:
      terminal === 'answer' &&
      contract.content === answer &&
      contract.violationCodes.length === 0 &&
      expectedPaths.every((value) => readPaths.includes(value)) &&
      forbidden.length === 0 &&
      (!provider ? factMatches.length === test.expectedFacts.length : true),
    terminal,
    elapsedMs: Math.round(performance.now() - start),
    providerCalls,
    modelRequests,
    toolCalls: history.length,
    requiredMisses,
    answer,
    displayedAnswer: contract.content,
    semanticQualityAssessed: false,
    referenceFactMatches: factMatches,
    forbiddenClaimMatches: forbidden,
    keywordCoverage: test.expectedFacts.length
      ? factMatches.length / test.expectedFacts.length
      : null,
    readPaths,
    sourceReadCoverage: expectedPaths.length
      ? expectedPaths.filter((value) => readPaths.includes(value)).length / expectedPaths.length
      : null,
    verifiedSources: citations.filter((citation) => citation.status === 'verified').length,
    citedSourceIds: citations
      .filter((citation) => answer.includes(citation.id))
      .map((citation) => citation.id),
    violations: contract.violationCodes,
    trace: history.map((call) => ({
      name: call.name,
      arguments: call.arguments,
      status: call.status,
      result: call.normalizedResult ?? call.result,
      citations: call.citations,
    })),
  };
}

export async function evaluateObsidianVault(runtime, app, settings, tests) {
  runtime.initializeChatGPTOAuth(app);
  const provider = createEvaluationProvider(runtime, settings);
  const files = await runtime.getRagCandidateFiles(app.vault, settings.rag, settings.chat);
  const allowed = new Set(files.map((file) => file.path));
  const plugin = app.plugins.plugins['superpower-inside'];
  const vault = {
    app,
    files,
    scope: {
      listCandidateFiles: async () => files,
      isCandidateFile: async (file) => allowed.has(file.path),
      isPathVisible: (value) =>
        value === '' ||
        files.some((file) => file.path === value || file.path.startsWith(`${value}/`)),
    },
    getQueryEngine: () => plugin?.ragEngine ?? null,
  };
  const results = [];
  for (const test of tests) {
    const retrieval = await evaluateRetrieval(runtime, test, vault);
    for (const protocol of ['native', 'compatibility']) {
      const loop = await evaluateToolLoop(runtime, provider, test, vault, protocol);
      results.push({
        ...loop,
        contractPassed: loop.contractPassed && retrieval.every((probe) => probe.recallAtK === 1),
        retrieval,
      });
    }
  }
  return {
    mode: 'live-obsidian',
    model: settings.chat.defaultModel,
    observedModel: provider.getObservedModel?.(),
    vault: app.vault.getName(),
    candidateFiles: files.length,
    transport: 'node-http-buffered-adapter',
    note: '실제 모델·볼트·인덱스를 사용하며 화면과 requestUrl 전송은 평가 어댑터로 대체합니다. 자동 지표는 검색 정답 문서와 키워드 관측값이며 의미 품질 판정과 구분합니다.',
    current: results,
  };
}
