import {
  buildProviderModelRef,
  getCustomOpenAIProviderDisplayName,
  getProviderProfileDisplayName,
  parseProviderModelRef,
  PROVIDER_LABELS,
  resolveChatModelPlan,
  resolveProviderModelRef,
  resolveUsableProviderModelRef,
  type SuperpowerInsideSettings,
} from '../settings';
import {
  createCustomOpenAIProvider,
  createProvider,
  createProviderForStrategy,
  type LLMProvider,
} from './providers';

export interface ResolvedChatProvider {
  provider: LLMProvider;
  providerKey: string;
  providerLabel: string;
  model: string;
}

/** Rust가 사용 가능하다고 판정한 모델만 실제 provider transport로 연결한다. */
export function createChatProviderForModel(
  settings: SuperpowerInsideSettings,
  modelRef: string,
): ResolvedChatProvider | null {
  const normalizedModelRef = modelRef.trim();
  const compatibleProfileRef = resolveProviderModelRef(settings, normalizedModelRef, 'general');
  const plannedModelRef = compatibleProfileRef
    ? buildProviderModelRef(compatibleProfileRef.profile.id, compatibleProfileRef.modelId)
    : normalizedModelRef;
  const plan = resolveChatModelPlan(settings, plannedModelRef);
  if (!plan.options.some((option) => option.value === plannedModelRef)) return null;

  const resolvedProfile = resolveUsableProviderModelRef(settings, normalizedModelRef, 'general');
  if (resolvedProfile) {
    const { profile, modelId } = resolvedProfile;
    return {
      provider: createProviderForStrategy(
        profile.strategy,
        { ...profile, models: profile.models.map((model) => model.id) },
        modelId,
        profile.id,
      ),
      providerKey: `profile:${profile.id}`,
      providerLabel: getProviderProfileDisplayName(profile),
      model: modelId,
    };
  }

  const parsed = parseProviderModelRef(normalizedModelRef);
  if (parsed.kind === 'legacy-custom-openai') {
    const customProvider = settings.customOpenAIProviders.find(
      (provider) => provider.id === parsed.providerId,
    );
    if (!customProvider) return null;
    return {
      provider: createCustomOpenAIProvider(customProvider, parsed.modelId),
      providerKey: `customOpenAI:${customProvider.id}`,
      providerLabel: getCustomOpenAIProviderDisplayName(customProvider),
      model: parsed.modelId,
    };
  }

  if (parsed.kind === 'legacy') {
    return {
      provider: createProvider(parsed.providerKey, settings[parsed.providerKey], parsed.modelId),
      providerKey: parsed.providerKey,
      providerLabel: PROVIDER_LABELS[parsed.providerKey],
      model: parsed.modelId,
    };
  }

  return null;
}

export function buildStoredChatModelRef(providerKey: string, model: string): string {
  const normalizedProviderKey = providerKey.trim();
  const normalizedModel = model.trim();
  return normalizedProviderKey && normalizedModel
    ? `${normalizedProviderKey}:${normalizedModel}`
    : '';
}
