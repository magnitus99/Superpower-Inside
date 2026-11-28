/** 현재 본문에서 LF 기준 1-based 행을 읽는다. 긴 파일을 행 문자열 배열로 복제하지 않는다. */
export class CurrentSourceWindows {
  private readonly checkpoints = [0];
  private lastLine = 1;
  private lastOffset = 0;
  constructor(private readonly text: string) {}

  private offset(line: number): number | undefined {
    if (!Number.isSafeInteger(line) || line < 1) return undefined;
    const block = Math.min(Math.floor((line - 1) / 512), this.checkpoints.length - 1);
    const checkpoint = block * 512 + 1;
    const cached = checkpoint <= this.lastLine && this.lastLine <= line;
    let offset = cached ? this.lastOffset : this.checkpoints[block];
    for (let row = cached ? this.lastLine : checkpoint; row < line; row++) {
      const lf = this.text.indexOf('\n', offset);
      if (lf < 0) return undefined;
      offset = lf + 1;
      if (row === this.checkpoints.length * 512) this.checkpoints.push(offset);
    }
    this.lastLine = line;
    this.lastOffset = offset;
    return offset;
  }

  rows(start: number, end: number, maxUnits: number): string | null | undefined {
    const from = this.offset(start);
    if (from === undefined || end < start) return undefined;
    const until = this.offset(end + 1) ?? this.text.length;
    return until - from > maxUnits ? null : this.text.slice(from, until);
  }

  /** 원문 전체의 유일한 완전 일치만 주소 힌트로 넘긴다. 겹친 두 번째 출현도 모호하다. */
  uniqueWindow(quote: string): { text: string; startLine: number } | 'quote-missing' | 'position-mismatch' {
    const pos = quote ? this.text.indexOf(quote) : -1;
    if (pos < 0) return 'quote-missing';
    if (this.text.indexOf(quote, pos + 1) >= 0) return 'position-mismatch';
    let line = 1;
    let offset = 0;
    while (offset < pos) {
      const next = this.text.indexOf('\n', offset);
      if (next < 0 || next >= pos) break;
      offset = next + 1;
      if (line === this.checkpoints.length * 512) this.checkpoints.push(offset);
      line++;
    }
    return { text: this.text.slice(pos, pos + quote.length), startLine: line };
  }
}
