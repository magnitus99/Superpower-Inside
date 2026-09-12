import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const hangul = /[\u3131-\u318E\uAC00-\uD7A3]/;
const skipDirs = new Set(['.git', '.test-vault', 'dist', 'node_modules']);
const allowedKoreanFiles = new Set([path.join(root, 'src/i18n.ts')]);
const localizedFactoryNames = new Set(['createDefaultPromptEntry']);

function collectTypeScriptFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const current = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTypeScriptFiles(current, files);
      continue;
    }
    if (current.endsWith('.ts') && !current.endsWith('.d.ts') && !current.endsWith('.test.ts')) {
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
  const topLevelDeclarations = new Set(
    sourceFile.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => Array.from(statement.declarationList.declarations)),
  );

  function containsLocaleSensitiveCall(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 't' || localizedFactoryNames.has(node.expression.text))
    ) {
      return true;
    }
    return ts.forEachChild(node, containsLocaleSensitiveCall) === true;
  }

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
    if (
      ts.isVariableDeclaration(node) &&
      topLevelDeclarations.has(node) &&
      node.initializer &&
      containsLocaleSensitiveCall(node.initializer)
    ) {
      violations.push(
        `${path.relative(root, file)}:${lineAndColumn(sourceFile, node.getStart(sourceFile))} module-level localization freezes the language at import time`,
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

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function translationEntries(initializer, objectName) {
  const object = unwrapExpression(initializer);
  if (!object || !ts.isObjectLiteralExpression(object)) {
    violations.push(`src/i18n.ts: ${objectName} translation value is not an object literal`);
    return new Map();
  }
  const entries = new Map();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    const key =
      ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
        ? name.text
        : undefined;
    if (!key) continue;
    entries.set(key, property.initializer.getText(i18nSource));
  }
  return entries;
}

function placeholders(text) {
  return new Set(Array.from(text.matchAll(/\{([A-Za-z0-9_]+)\}/g), (match) => match[1]));
}

function sameSet(left, right) {
  return left.size === right.size && Array.from(left).every((value) => right.has(value));
}

const koreanInitializer = findConstInitializer('ko');
if (!koreanInitializer) {
  violations.push('src/i18n.ts: missing ko translation object');
} else if (englishInitializer) {
  const koreanEntries = translationEntries(koreanInitializer, 'ko');
  const englishEntries = translationEntries(englishInitializer, 'en');
  const allKeys = new Set([...koreanEntries.keys(), ...englishEntries.keys()]);
  for (const key of allKeys) {
    if (!koreanEntries.has(key) || !englishEntries.has(key)) {
      violations.push(`src/i18n.ts: translation key parity mismatch for ${key}`);
      continue;
    }
    const koreanPlaceholders = placeholders(koreanEntries.get(key));
    const englishPlaceholders = placeholders(englishEntries.get(key));
    if (!sameSet(koreanPlaceholders, englishPlaceholders)) {
      violations.push(
        `src/i18n.ts: placeholder mismatch for ${key} (ko: ${[...koreanPlaceholders].join(', ') || 'none'}; en: ${[...englishPlaceholders].join(', ') || 'none'})`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    'i18n guard failed. User-facing Korean text must live in src/i18n.ts with English translations.',
  );
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('i18n guard passed.');
