import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('생성물 저장 경계', () => {
  it('새 운영 코드가 Dexie 생성과 상속으로 자동 추적 계층을 우회하지 않는다', () => {
    const paths = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', 'src/', 'main.ts'],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n');
    const bypasses: string[] = [];
    for (const path of paths) {
      if (
        !path.endsWith('.ts') ||
        path.endsWith('.test.ts') ||
        path.endsWith('.d.ts') ||
        path === 'src/storage/generated-artifacts.ts'
      )
        continue;
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const aliases = new Set<string>();
      for (const statement of source.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.moduleSpecifier.text !== 'dexie'
        )
          continue;
        const clause = statement.importClause;
        if (clause?.name) aliases.add(clause.name.text);
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            if ((binding.propertyName ?? binding.name).text === 'Dexie')
              aliases.add(binding.name.text);
          }
        }
      }
      const visit = (node: ts.Node): void => {
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          aliases.has(node.expression.text)
        )
          bypasses.push(path);
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
          for (const clause of node.heritageClauses ?? []) {
            if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
            for (const type of clause.types) {
              if (ts.isIdentifier(type.expression) && aliases.has(type.expression.text))
                bypasses.push(path);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(bypasses).toEqual([]);
  });
});
