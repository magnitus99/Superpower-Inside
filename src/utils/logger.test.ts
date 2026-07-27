import { describe, expect, it, vi } from 'vitest';

import {
  AppLogger,
  LOG_LEVEL_COLORS,
  createLogger,
  getLogLevelPriority,
  redactLogValue,
  type LoggerChangeEvent,
} from './logger';

describe('AppLogger', () => {
  it('로그 레벨 우선순위와 색상 토큰을 제공한다', () => {
    expect(getLogLevelPriority('trace')).toBeLessThan(getLogLevelPriority('debug'));
    expect(getLogLevelPriority('debug')).toBeLessThan(getLogLevelPriority('info'));
    expect(getLogLevelPriority('warn')).toBeLessThan(getLogLevelPriority('error'));
    expect(getLogLevelPriority('fatal')).toBeGreaterThan(getLogLevelPriority('error'));
    expect(LOG_LEVEL_COLORS.error).toBe('var(--text-error)');
    expect(LOG_LEVEL_COLORS.warn).toBe('var(--text-warning)');
  });

  it('최소 로그 레벨보다 낮은 항목은 저장하지 않는다', () => {
    const logger = new AppLogger({ minLevel: 'warn', maxEntries: 100, mirrorToConsole: false });

    logger.debug('debug 항목');
    logger.info('info 항목');
    logger.warn('warn 항목');

    expect(logger.getEntries().map((entry) => entry.level)).toEqual(['warn']);
  });

  it('최대 항목 수를 넘으면 오래된 로그를 제거한다', () => {
    const logger = new AppLogger({ minLevel: 'trace', maxEntries: 2, mirrorToConsole: false });

    logger.info('first');
    logger.info('second');
    logger.info('third');

    expect(logger.getEntries().map((entry) => entry.message)).toEqual(['second', 'third']);
  });

  it('구독자는 신규 로그와 clear 이벤트를 받는다', () => {
    const logger = new AppLogger({ minLevel: 'trace', maxEntries: 100, mirrorToConsole: false });
    const onChange = vi.fn();

    const unsubscribe = logger.subscribe(onChange);
    logger.error('실패', { source: 'test' });
    logger.clear();
    unsubscribe();
    logger.error('구독 해제 이후');

    const firstEvent = onChange.mock.calls[0]?.[0] as LoggerChangeEvent | undefined;
    const secondEvent = onChange.mock.calls[1]?.[0] as LoggerChangeEvent | undefined;
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(firstEvent?.type).toBe('entry');
    expect(secondEvent?.type).toBe('clear');
  });

  it('민감한 키 이름과 토큰 형태 값을 마스킹한다', () => {
    expect(
      redactLogValue({
        apiKey: 'sk-secret',
        headers: { Authorization: 'Bearer token-value' },
        nested: { githubToken: 'ghp_1234567890abcdef' },
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      headers: { Authorization: '[REDACTED]' },
      nested: { githubToken: '[REDACTED]' },
    });
  });

  it('source별 child logger가 같은 버퍼에 기록한다', () => {
    const logger = createLogger({ minLevel: 'trace', maxEntries: 100, mirrorToConsole: false });
    const child = logger.child('embedding');

    child.info('batch started');

    expect(logger.getEntries()).toContainEqual(
      expect.objectContaining({ source: 'embedding', message: 'batch started' }),
    );
  });
});
