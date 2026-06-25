import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  compareLexiconLevels,
  resolveLexiconLevelsSupported,
} from './lexicon_conventions.mjs';

export function buildLexiconDistribution({
  packsRoot,
  outDir,
  generatedAt = new Date().toISOString(),
}) {
  const resolvedPacksRoot = path.resolve(packsRoot);
  const resolvedOutDir = path.resolve(outDir);
  const generatedAtIso = normalizeIsoTimestamp(generatedAt);

  fs.rmSync(resolvedOutDir, { recursive: true, force: true });
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  const runtimePacks = discoverRuntimePacks(resolvedPacksRoot);
  const chunksByLanguage = new Map();

  for (const runtimePack of runtimePacks) {
    const languageCode = runtimePack.languageCode;
    const chunkDir = path.join(
      resolvedOutDir,
      'chunks',
      languageCode,
      runtimePack.packId,
    );
    fs.mkdirSync(chunkDir, { recursive: true });

    const chunkContentPath = path.join(chunkDir, runtimePack.contentFileName);
    fs.copyFileSync(runtimePack.contentFilePath, chunkContentPath);

    const payloadPath = toPosixRelative(resolvedOutDir, chunkContentPath);
    const contentHash = sha256ForFile(chunkContentPath);
    const chunkManifestPath = path.join(chunkDir, 'manifest.json');
    const chunkManifest = {
      ...runtimePack.manifest,
      contract_version: '0.1.0',
      chunk_id: runtimePack.packId,
      language_code: languageCode,
      payload_path: payloadPath,
      content_version: runtimePack.version,
      content_hash: contentHash,
      gloss_languages: runtimePack.glossLanguages,
      levels_supported: runtimePack.levelsSupported,
      domains: runtimePack.domains,
      relation_chunk_ids: runtimePack.relationChunkIds,
      updated_at: runtimePack.updatedAt ?? generatedAtIso,
    };
    writeJson(chunkManifestPath, chunkManifest);

    const chunkPointer = {
      contract_version: '0.1.0',
      chunk_id: runtimePack.packId,
      manifest_path: toPosixRelative(resolvedOutDir, chunkManifestPath),
      content_version: runtimePack.version,
      content_hash: contentHash,
      levels_supported: runtimePack.levelsSupported,
      domains: runtimePack.domains,
      updated_at: runtimePack.updatedAt ?? generatedAtIso,
    };

    const chunks = chunksByLanguage.get(languageCode) ?? [];
    chunks.push(chunkPointer);
    chunksByLanguage.set(languageCode, chunks);
  }

  const indexesDir = path.join(resolvedOutDir, 'indexes');
  fs.mkdirSync(indexesDir, { recursive: true });

  const languageIndexes = [];
  for (const languageCode of [...chunksByLanguage.keys()].sort()) {
    const chunks = chunksByLanguage.get(languageCode) ?? [];
    chunks.sort(compareChunkPointers);
    const indexPath = path.join(indexesDir, `${languageCode}.json`);
    const indexJson = {
      contract_version: '0.1.0',
      language_code: languageCode,
      generated_at: generatedAtIso,
      namespaces: [],
      chunks,
    };
    writeJson(indexPath, indexJson);

    languageIndexes.push({
      contract_version: '0.1.0',
      language_code: languageCode,
      path: toPosixRelative(resolvedOutDir, indexPath),
      content_version: dateVersionFromIso(generatedAtIso),
      content_hash: sha256ForFile(indexPath),
      updated_at: generatedAtIso,
    });
  }

  const rootManifestPath = path.join(resolvedOutDir, 'root_manifest.json');
  writeJson(rootManifestPath, {
    contract_version: '0.1.0',
    generated_at: generatedAtIso,
    language_indexes: languageIndexes,
  });

  return {
    outDir: resolvedOutDir,
    generatedAt: generatedAtIso,
    runtimePackCount: runtimePacks.length,
    languageCount: languageIndexes.length,
    rootManifestPath,
  };
}

function discoverRuntimePacks(packsRoot) {
  const entries = fs.readdirSync(packsRoot, { withFileTypes: true });
  const runtimePacks = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directoryPath = path.join(packsRoot, entry.name);
    const manifestPath = path.join(directoryPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const manifest = readJson(manifestPath);
    if ((manifest.pack_role ?? '').toString().trim().toLowerCase() == 'source') {
      continue;
    }

    const packId = normalizeNonEmptyString(manifest.pack_id);
    if (packId == null) {
      continue;
    }
    const targetLangs = normalizeLanguageCodes(
      manifest.languages_target_supported,
    );
    if (targetLangs.length != 1) {
      throw new Error(
        `Runtime pack "${packId}" must declare exactly one target language.`,
      );
    }
    const contentFileName =
      normalizeNonEmptyString(manifest.content_file) ?? 'content.json';
    const contentFilePath = path.join(directoryPath, contentFileName);
    if (!fs.existsSync(contentFilePath)) {
      throw new Error(`Content file not found for "${packId}": ${contentFilePath}`);
    }

    runtimePacks.push({
      packId,
      version: normalizeNonEmptyString(manifest.version) ?? '0.0.0',
      languageCode: targetLangs[0],
      manifest,
      contentFileName,
      contentFilePath,
      glossLanguages: normalizeLanguageCodes(
        manifest.gloss_languages_supported,
      ),
      levelsSupported: resolveSupportedLevels(manifest),
      domains: normalizeStringList(manifest.domains),
      relationChunkIds: normalizeStringList(manifest.relation_chunk_ids),
      updatedAt: normalizeIsoTimestamp(manifest.generated_at),
    });
  }

  runtimePacks.sort(compareRuntimePacks);
  return runtimePacks;
}

function resolveSupportedLevels(manifest) {
  return resolveLexiconLevelsSupported({
    levelsSupported: manifest.levels_supported,
    packLevel: manifest.pack_level,
    packId: manifest.pack_id,
  });
}

function compareRuntimePacks(a, b) {
  const languageDiff = a.languageCode.localeCompare(b.languageCode);
  if (languageDiff !== 0) {
    return languageDiff;
  }
  const levelDiff = compareLexiconLevels(
    a.levelsSupported[0] ?? '',
    b.levelsSupported[0] ?? '',
  );
  if (levelDiff !== 0) {
    return levelDiff;
  }
  return a.packId.localeCompare(b.packId);
}

function compareChunkPointers(a, b) {
  const levelDiff = compareLexiconLevels(
    a.levels_supported[0] ?? '',
    b.levels_supported[0] ?? '',
  );
  if (levelDiff !== 0) {
    return levelDiff;
  }
  return a.chunk_id.localeCompare(b.chunk_id);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256ForFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest('hex')}`;
}

function toPosixRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function normalizeNonEmptyString(value) {
  const normalized = value?.toString().trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .map((entry) => entry?.toString().trim() ?? '')
      .filter((entry) => entry.length > 0),
  )];
}

function normalizeLanguageCodes(value) {
  return normalizeStringList(value).map((entry) => entry.toLowerCase());
}

function normalizeIsoTimestamp(value) {
  const normalized = value?.toString().trim() ?? '';
  if (normalized.length === 0) {
    return new Date().toISOString();
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed.toISOString();
}

function dateVersionFromIso(iso) {
  const [datePart] = iso.split('T');
  return datePart.replaceAll('-', '.');
}
