#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const INDEX_HTML = path.join(ROOT_DIR, 'index.html');

const SAFE_ROOTS = ['src/v2', 'src/compat'];
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.svelte-kit', '.next', '.turbo', '.cache']);
const TEXT_FILE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.html',
  '.htm',
  '.css'
]);
const EXTENSION_FALLBACKS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.css', '.scss', '.sass', '.less', '.html', '.htm'];

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function isSafePath(relativePath) {
  return SAFE_ROOTS.some((safeRoot) => relativePath === safeRoot || relativePath.startsWith(`${safeRoot}/`));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function collectFileMap() {
  const files = new Set();

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const relative = toPosix(path.relative(ROOT_DIR, fullPath));
          files.add(relative);
        }
      })
    );
  }

  if (await pathExists(SRC_DIR)) {
    await walk(SRC_DIR);
  }

  if (await pathExists(INDEX_HTML)) {
    files.add(toPosix(path.relative(ROOT_DIR, INDEX_HTML)));
  }

  return files;
}

function expandReferenceCandidates(candidate) {
  const normalized = candidate.replace(/\\+/g, '/');
  const stripped = normalized.replace(/[?#].*$/, '');
  const ext = path.posix.extname(stripped);
  const results = new Set();

  if (!stripped) {
    return [];
  }

  results.add(stripped);

  if (ext) {
    results.add(stripped);
  } else {
    for (const fallback of EXTENSION_FALLBACKS) {
      results.add(`${stripped}${fallback}`);
    }
    results.add(path.posix.join(stripped, 'index.js'));
    results.add(path.posix.join(stripped, 'index.ts'));
    results.add(path.posix.join(stripped, 'index.tsx'));
    results.add(path.posix.join(stripped, 'index.jsx'));
    results.add(path.posix.join(stripped, 'index.html'));
    results.add(path.posix.join(stripped, 'index.json'));
  }

  return Array.from(results);
}

function extractReferencesFromContent(content, fromDir, fileMap, references) {
  const patterns = [
    /import\s+(?:[^"'`]*?from\s+)?["'`]([^"'`]+)["'`]/g,
    /import\(\s*["'`]([^"'`]+)["'`]/g,
    /fetch\(\s*["'`]([^"'`]+)["'`]/g,
    /x-html\s*=\s*["'`]([^"'`]+)["'`]/g,
    /(?:href|src)\s*=\s*["'`]([^"'`]+)["'`]/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[1];
      if (!raw) continue;
      const normalizedRaw = raw.trim();
      if (!normalizedRaw) continue;
      if (/^(?:https?:|data:|mailto:|tel:|javascript:|about:|#)/i.test(normalizedRaw)) {
        continue;
      }

      const resolvedCandidates = [];
      if (normalizedRaw.startsWith('/')) {
        resolvedCandidates.push(normalizedRaw.replace(/^\//, ''));
      } else if (normalizedRaw.startsWith('.')) {
        const joined = path.posix.normalize(path.posix.join(fromDir, normalizedRaw));
        resolvedCandidates.push(joined);
      } else {
        continue;
      }

      for (const candidate of resolvedCandidates) {
        const expanded = expandReferenceCandidates(candidate);
        for (const possibility of expanded) {
          if (fileMap.has(possibility)) {
            references.add(possibility);
          }
        }
      }
    }
  }
}

async function collectReferences(fileMap) {
  const references = new Set();

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext && !TEXT_FILE_EXTENSIONS.has(ext)) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        let content;
        try {
          content = await fs.readFile(fullPath, 'utf8');
        } catch (error) {
          continue;
        }
        const relativeDir = toPosix(path.relative(ROOT_DIR, path.dirname(fullPath)) || '.');
        extractReferencesFromContent(content, relativeDir === '.' ? '' : relativeDir, fileMap, references);
      }
    }
  }

  await walk(ROOT_DIR);

  return references;
}

(async () => {
  try {
    const fileMap = await collectFileMap();
    const references = await collectReferences(fileMap);
    if (fileMap.has('index.html')) {
      references.add('index.html');
    }

    const orphans = Array.from(fileMap)
      .filter((filePath) => !references.has(filePath) && !isSafePath(filePath))
      .sort();

    const result = { orphans };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
