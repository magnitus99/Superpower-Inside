import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const hangul = /[\u3131-\u318E\uAC00-\uD7A3]/;
const skipDirs = new Set(['.git', '.sisyphus', '.test-vault', 'dist', 'node_modules']);
const allowedKoreanFiles = new Set([path.join(root, 'src/i18n.ts')]);

function collectTypeScriptFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const current = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTypeScriptFiles(current, files);
      continue;
    }
    if (
      current.endsWith('.ts') &&
      !current.endsWith('.d.ts') &&
      !current.endsWith('.test.ts')
    ) {
      files.push(current);
    }
  }
  return files;
}

function lineAndColumn(sourceFile, position) {
  const pos = sourceFile.getLineAndCharacterOfPosition(position);
  return `${pos.line + 1}:${pos.character + 1}`;
}

const violations = [];

for (const file of collectTypeScriptFiles(root)) {
  if (allowedKoreanFiles.has(file)) continue;
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);

  function visit(node) {
    const isTextLiteral =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node);
    if (isTextLiteral && hangul.test(node.getText(sourceFile))) {
      violations.push(
        `${path.relative(root, file)}:${lineAndColumn(sourceFile, node.getStart(sourceFile))}`,
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

const i18nPath = path.join(root, 'src/i18n.ts');
const i18nText = fs.readFileSync(i18nPath, 'utf8');
const i18nSource = ts.createSourceFile(i18nPath, i18nText, ts.ScriptTarget.Latest, true);

function findConstInitializer(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(i18nSource);
  return found;
}

const englishInitializer = findConstInitializer('en');
if (!englishInitializer) {
  violations.push('src/i18n.ts: missing en translation object');
} else if (hangul.test(englishInitializer.getText(i18nSource))) {
  violations.push('src/i18n.ts: en translation object contains Korean text');
}

if (violations.length > 0) {
  console.error('i18n guard failed. User-facing Korean text must live in src/i18n.ts with English translations.');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('i18n guard passed.');
