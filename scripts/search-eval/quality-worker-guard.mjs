// 신뢰한 평가 번들의 source와 설치 PDF digest만 로컬 Worker 실행 자격을 줍니다.
export function createQualityWorkerBindings(host, readPolicy, digest, blocked) {
  if (typeof host.Worker !== 'function' || typeof host.Blob !== 'function' ||
      typeof host.URL?.createObjectURL !== 'function' || typeof host.URL?.revokeObjectURL !== 'function') return {};
  const approvedBlobs = new WeakSet();
  const approvedUrls = new Set();
  const Blob = new Proxy(host.Blob, {
    construct(target, args, newTarget) {
      const blob = Reflect.construct(target, args, newTarget === Blob ? target : newTarget);
      const parts = args[0];
      if (Array.isArray(parts) && parts.length === 1) {
        const part = parts[0];
        const policy = readPolicy();
        if (typeof part === 'string' && part.length > 0 && part === policy?.source) approvedBlobs.add(blob);
        else if (Object.prototype.toString.call(part) === '[object ArrayBuffer]' &&
                 part.byteLength === policy?.pdf?.size && /^[a-f0-9]{64}$/.test(policy?.pdf?.sha256 ?? '') &&
                 digest(new Uint8Array(part)) === policy.pdf.sha256) approvedBlobs.add(blob);
      }
      return blob;
    },
  });
  const URL = new Proxy(host.URL, {
    get(target, key, receiver) {
      if (key === 'createObjectURL') return (blob) => {
        const url = target.createObjectURL(blob);
        if (approvedBlobs.has(blob)) approvedUrls.add(url);
        return url;
      };
      if (key === 'revokeObjectURL') return (url) => {
        approvedUrls.delete(url);
        return target.revokeObjectURL(url);
      };
      return Reflect.get(target, key, receiver);
    },
  });
  const Worker = new Proxy(host.Worker, {
    construct(target, args, newTarget) {
      if (typeof args[0] !== 'string' || !approvedUrls.has(args[0])) return blocked();
      return Reflect.construct(target, args, newTarget === Worker ? target : newTarget);
    },
  });
  return { Blob, URL, Worker };
}
