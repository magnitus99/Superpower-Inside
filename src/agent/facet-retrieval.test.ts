import { expect, it } from 'vitest';
import { parseFacetRetrieval, roundRobinPaths } from './facet-retrieval';
import { coversFacet } from './current-facet-search';

it('separates two verbatim subjects from request clauses and search-only context', () => {
  const question = '냉각 시간을 설명하세요. 구리와 수정의 구조를 비교하세요.';
  const sides = [{ anchor: '구리', identity: 'copper', query: 'copper lattice' }, { anchor: '수정', identity: 'quartz', query: 'quartz lattice' }];
  const parse = (value: unknown) => parseFacetRetrieval(question, JSON.stringify({ subjects: value }));
  expect(parse(sides)?.map(s => s.terms)).toEqual([['copper'], ['quartz']]);
  expect(parse([sides[0], { ...sides[1], anchor: 'unmentioned' }])).toBeNull();
  expect(parse([sides[0], { ...sides[1], identity: 'copper' }])).toBeNull();
  expect(roundRobinPaths([['a', 'b', 'c', 'd'], ['a', 'e', 'f']], 4)).toEqual(['a', 'e', 'b', 'f']);
});
it.each([
  ['Compare Bronze and quartz.', 'Bronze', 'bronze', 'quartz'],
  ['구리와 수정을 비교하세요.', '구리', '구리와', '수정'],
])('rejects two anchors on the same question span in %s', (question, first, duplicate, distinct) => {
  const parse = (second: string) => parseFacetRetrieval(question, JSON.stringify({ subjects: [
    { anchor: first, identity: 'metal', query: 'metal structure' },
    { anchor: second, identity: 'quartz', query: 'quartz structure' },
  ] }));
  expect(parse(distinct)?.map(s => s.anchor)).toEqual([first, distinct]);
  expect(parse(duplicate)).toBeNull();
});

it.each([
  ['ＱＵＡＲＴＺ', 'silicate'],
  ['metal', 'ＣＯＰＰＥＲ'],
  ['ＱＵＡＲＴＺ', 'ＣＯＰＰＥＲ'],
  ['clear quartz', 'copper alloy'],
])('rejects translated identities overlapping the opposite original anchor (%s / %s)', (left, right) => {
  const parse = (a: string, b: string) => parseFacetRetrieval('Compare Copper and Quartz.', JSON.stringify({ subjects: [
    { anchor: 'Copper', identity: a, query: 'thermal properties' },
    { anchor: 'Quartz', identity: b, query: 'thermal properties' },
  ] }));
  expect(parse(left, right)).toBeNull();
  expect(parse('metal mineral', 'silicate mineral')).not.toBeNull();
});

it('checks a one-letter original anchor for collisions without using it as a search identity', () => {
  const parse = (identity: string) => parseFacetRetrieval('Compare the C language and Rust.', JSON.stringify({ subjects: [
    { anchor: 'C', identity: 'ANSI C', query: 'type system' },
    { anchor: 'Rust', identity, query: 'type system' },
  ] }));
  expect(parse('C language')).toBeNull();
  expect(parse('Rust language')?.[0]).toMatchObject({ discoveryQuery: '"ansi c"', identities: [['ansi', 'c']] });
});

it('does not treat a Korean index ngram as a whole subject word', () => {
  expect(coversFacet('기상천외', { id: 'subject-0', kind: 'subject', queryIndex: 1, query: '기상', terms: ['기상'] })).toBe(false);
});

it('forms identity + contextual query locally instead of requiring the planner to repeat its identity', () => {
  expect(parseFacetRetrieval('Compare copper and quartz', JSON.stringify({ subjects: [
    { anchor: 'copper', identity: 'copper', query: 'ductile structure' }, { anchor: 'quartz', identity: 'quartz', query: 'lattice structure' },
  ] }))?.map(s=>s.query)).toEqual(['copper ductile structure', 'quartz lattice structure']);
});

it('ranks complete alternative subject expressions, never instruction/context terms as proof', () => {
  const sides = [{ anchor: '구리 광물', identity:'copper mineral', query:'density limits' },{ anchor:'수정 원석', identity:'quartz crystal',query:'density limits'}];
  const r = parseFacetRetrieval('구리 광물과 수정 원석의 밀도를 비교하세요.',JSON.stringify({subjects:sides}));
  expect(r?.[0]).toMatchObject({ discoveryQuery:'"copper mineral" "구리 광물"', identities:[['copper','mineral'],['구리','광물']] });
  const f = { id:'subject-0',kind:'subject' as const,queryIndex:1,query:'copper mineral',terms:['copper','mineral'],identities:r?.[0].identities };
  expect(coversFacet('구리 광물은 무겁다.',f)).toBe(true);
  expect(coversFacet('구리판 광물학은 무겁다.',f)).toBe(false);
  expect(coversFacet('density limits only',f)).toBe(false);
});
