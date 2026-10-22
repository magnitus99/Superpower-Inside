/**
 * 번들 빌드 단계에서 esbuild `define`이 주입하는 값을 읽습니다.
 *
 * - 개발 빌드(`npm run dev`)와 소스 직접 실행(Vitest)은 `true`
 * - 프로덕션 빌드(`npm run build`)는 `false`
 *
 * 주입이 없으면 개발 환경으로 간주합니다. 배포 번들에서는 항상 `false`이므로
 * 사용자가 설정에서 켜 두었더라도 채팅 파일에 추적 정보가 기록되지 않습니다.
 */
declare const __SUPERPOWER_DEBUG_TRACE__: boolean | undefined;

/** 현재 번들에서 채팅 추적 기록을 켤 수 있는지 나타냅니다. */
export const DEBUG_TRACE_BUILD_ENABLED: boolean =
  typeof __SUPERPOWER_DEBUG_TRACE__ === 'undefined' ? true : __SUPERPOWER_DEBUG_TRACE__;
