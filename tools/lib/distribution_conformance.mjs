import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Conformance validator for a built Lexicon distribution (CONTRACT.md).
 *
 * This is the producer half of the contract guard: Lexicon CI asserts its
 * builder output (and the committed golden fixture) match the contract, so the
 * shape consumers code against cannot silently drift. It walks root_manifest ->
 * language indexes -> chunk manifests -> payloads, checking required fields,
 * cross-references (every referenced path resolves), id/language consistency,
 * the single supported contract_version, and that every declared content_hash
 * matches the file it points at.
 *
 * Returns a list of human-readable error strings; empty means conformant.
 */
export const CONTRACT_VERSION = '0.1.0';

function sha256ForFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest('hex')}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function validateDistribution(distDir) {
  const root = path.resolve(distDir);
  const errors = [];
  const add = (message) => errors.push(message);

  const rootManifestPath = path.join(root, 'root_manifest.json');
  if (!fs.existsSync(rootManifestPath)) {
    add(`missing root_manifest.json at ${rootManifestPath}`);
    return errors;
  }

  let rootManifest;
  try {
    rootManifest = readJson(rootManifestPath);
  } catch (error) {
    add(`root_manifest.json is not valid JSON: ${error.message}`);
    return errors;
  }

  if (rootManifest.contract_version !== CONTRACT_VERSION) {
    add(
      `root_manifest.json contract_version "${rootManifest.contract_version}" ` +
        `!= supported "${CONTRACT_VERSION}"`,
    );
  }
  if (!isNonEmptyString(rootManifest.generated_at)) {
    add('root_manifest.json missing generated_at');
  }
  if (!Array.isArray(rootManifest.language_indexes) || rootManifest.language_indexes.length === 0) {
    add('root_manifest.json language_indexes must be a non-empty array');
    return errors;
  }

  for (const entry of rootManifest.language_indexes) {
    const lang = entry.language_code;
    const where = `language_index[${lang}]`;
    if (entry.contract_version !== CONTRACT_VERSION) {
      add(`${where} contract_version "${entry.contract_version}" != "${CONTRACT_VERSION}"`);
    }
    if (!isNonEmptyString(lang)) {
      add(`${where} missing language_code`);
    }
    if (!isNonEmptyString(entry.path)) {
      add(`${where} missing path`);
      continue;
    }
    const indexPath = path.join(root, entry.path);
    if (!fs.existsSync(indexPath)) {
      add(`${where} path does not resolve: ${entry.path}`);
      continue;
    }
    if (entry.content_hash !== sha256ForFile(indexPath)) {
      add(`${where} content_hash does not match ${entry.path}`);
    }

    validateLanguageIndex(root, indexPath, lang, add);
  }

  return errors;
}

function validateLanguageIndex(root, indexPath, expectedLang, add) {
  let index;
  try {
    index = readJson(indexPath);
  } catch (error) {
    add(`index ${path.basename(indexPath)} is not valid JSON: ${error.message}`);
    return;
  }
  const where = `index[${expectedLang}]`;
  if (index.contract_version !== CONTRACT_VERSION) {
    add(`${where} contract_version "${index.contract_version}" != "${CONTRACT_VERSION}"`);
  }
  if (index.language_code !== expectedLang) {
    add(`${where} language_code "${index.language_code}" != root "${expectedLang}"`);
  }
  if (!isNonEmptyString(index.generated_at)) {
    add(`${where} missing generated_at`);
  }
  if (!Array.isArray(index.chunks) || index.chunks.length === 0) {
    add(`${where} chunks must be a non-empty array`);
    return;
  }

  for (const pointer of index.chunks) {
    const chunkId = pointer.chunk_id;
    const cwhere = `${where} chunk[${chunkId}]`;
    if (pointer.contract_version !== CONTRACT_VERSION) {
      add(`${cwhere} contract_version "${pointer.contract_version}" != "${CONTRACT_VERSION}"`);
    }
    if (!isNonEmptyString(chunkId)) {
      add(`${cwhere} missing chunk_id`);
    }
    if (!isStringArray(pointer.levels_supported)) {
      add(`${cwhere} levels_supported must be a string array`);
    }
    if (!isNonEmptyString(pointer.manifest_path)) {
      add(`${cwhere} missing manifest_path`);
      continue;
    }
    const manifestPath = path.join(root, pointer.manifest_path);
    if (!fs.existsSync(manifestPath)) {
      add(`${cwhere} manifest_path does not resolve: ${pointer.manifest_path}`);
      continue;
    }
    validateChunkManifest(root, manifestPath, expectedLang, pointer, add);
  }
}

function validateChunkManifest(root, manifestPath, expectedLang, pointer, add) {
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    add(`chunk manifest ${path.basename(manifestPath)} is not valid JSON: ${error.message}`);
    return;
  }
  const where = `chunk_manifest[${manifest.chunk_id}]`;
  if (manifest.contract_version !== CONTRACT_VERSION) {
    add(`${where} contract_version "${manifest.contract_version}" != "${CONTRACT_VERSION}"`);
  }
  if (manifest.chunk_id !== pointer.chunk_id) {
    add(`${where} chunk_id "${manifest.chunk_id}" != index pointer "${pointer.chunk_id}"`);
  }
  if (manifest.language_code !== expectedLang) {
    add(`${where} language_code "${manifest.language_code}" != "${expectedLang}"`);
  }
  for (const field of ['pack_id', 'version', 'content_version', 'content_hash']) {
    if (!isNonEmptyString(manifest[field])) {
      add(`${where} missing ${field}`);
    }
  }
  if (!isStringArray(manifest.gloss_languages)) {
    add(`${where} gloss_languages must be a string array`);
  }
  if (manifest.content_hash !== pointer.content_hash) {
    add(`${where} content_hash != index pointer content_hash`);
  }
  if (!isNonEmptyString(manifest.payload_path)) {
    add(`${where} missing payload_path`);
    return;
  }
  const payloadPath = path.join(root, manifest.payload_path);
  if (!fs.existsSync(payloadPath)) {
    add(`${where} payload_path does not resolve: ${manifest.payload_path}`);
    return;
  }
  if (manifest.content_hash !== sha256ForFile(payloadPath)) {
    add(`${where} content_hash does not match payload ${manifest.payload_path}`);
  }
}
