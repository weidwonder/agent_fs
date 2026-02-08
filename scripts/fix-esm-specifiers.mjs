import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const rootDirs = process.argv.slice(2);

if (rootDirs.length === 0) {
  console.error('用法: node scripts/fix-esm-specifiers.mjs <dist-dir> [dist-dir...]');
  process.exit(1);
}

const KNOWN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.node']);

function collectJsFiles(dir) {
  const items = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
      continue;
    }
    if (item.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

function resolveRelativeSpecifier(specifier, fromFile) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return null;
  }

  if (KNOWN_EXTENSIONS.has(extname(specifier))) {
    return null;
  }

  const basePath = resolve(fromFile, '..', specifier);

  if (existsSync(`${basePath}.js`) && statSync(`${basePath}.js`).isFile()) {
    return `${specifier}.js`;
  }

  const indexJsPath = join(basePath, 'index.js');
  if (existsSync(indexJsPath) && statSync(indexJsPath).isFile()) {
    const normalized = specifier.endsWith('/') ? specifier.slice(0, -1) : specifier;
    return `${normalized}/index.js`;
  }

  return null;
}

function rewriteFile(filePath) {
  const original = readFileSync(filePath, 'utf-8');
  let changed = false;

  let code = original.replace(
    /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
    (match, prefix, specifier, suffix) => {
      const replacement = resolveRelativeSpecifier(specifier, filePath);
      if (!replacement) return match;
      changed = true;
      return `${prefix}${replacement}${suffix}`;
    }
  );

  code = code.replace(
    /(import\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g,
    (match, prefix, specifier, suffix) => {
      const replacement = resolveRelativeSpecifier(specifier, filePath);
      if (!replacement) return match;
      changed = true;
      return `${prefix}${replacement}${suffix}`;
    }
  );

  if (changed) {
    writeFileSync(filePath, code);
  }

  return changed;
}

let totalChangedFiles = 0;

for (const dir of rootDirs) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    continue;
  }

  const jsFiles = collectJsFiles(dir);
  for (const file of jsFiles) {
    if (rewriteFile(file)) {
      totalChangedFiles += 1;
    }
  }
}

console.log(`已修正 ESM 导入文件数: ${totalChangedFiles}`);
