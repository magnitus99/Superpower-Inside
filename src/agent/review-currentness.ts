import { t } from '../i18n';

/** Only fixed reason/stage codes may enter persisted error details. */
export class ReviewScopeChangedError extends Error {
  constructor(stage: 'send' | 'resume' | 'enumerate', reason: 'readiness' | 'settings' | 'source' | 'currentness', boundary?: 'collected' | 'released') {
    super(`${t('vaultReviewScopeChanged')} [${stage}:${reason}]${boundary ? ` [${boundary}]` : ''}`);
  }
}

export function captureReviewGuard(
  stage: 'send' | 'resume', isActive: () => boolean, isReady: () => boolean, policy: () => string,
) {
  const original = policy();
  const failure = (source?: { isCurrent?: () => boolean } | null) => {
    if (!isActive()) return 'run';
    if (!isReady()) return 'readiness';
    if (policy() !== original) return 'settings';
    if (source?.isCurrent?.() === false) return 'source';
    return null;
  };
  return {
    isCurrent: (source?: { isCurrent?: () => boolean } | null) => failure(source) === null,
    assertCurrent: (source: { isCurrent?: () => boolean } | null, boundary: 'collected' | 'released') => {
      const reason = failure(source);
      if (reason === 'run') throw new DOMException(t('cancelledLabel'), 'AbortError');
      if (reason) throw new ReviewScopeChangedError(stage, reason, boundary);
    },
  };
}
