import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import { LEXICON_LEVELS } from '../lib/lexicon_conventions.mjs';
import { listMetadataCurationPlugins } from '../lib/language_plugins/build_language_plugin_registry.mjs';

const DEFAULT_PACK_DIR = DEFAULT_SOURCE_PACK_DIR;
const LEVELS = new Set(LEXICON_LEVELS);
const HELP_TEXT = `
Usage:
  pnpm node tools/pipeline/curate_pack_metadata.mjs [options]

Options:
  --pack-dir <dir>         Canonical source pack directory. Default: packs/lexicon_source
  --dry-run                Compute metadata changes without rewriting files
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_PACK_DIR,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') {
      options.packDir = argv[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSearchKey(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00df|\u1e9e/g, 'ss')
    .replace(/Ã¤/g, 'a')
    .replace(/Ã¶/g, 'o')
    .replace(/Ã¼/g, 'u')
    .replace(/ÃŸ/g, 'ss')
    .toLowerCase();
}

function deterministicUuid(seed) {
  const hash = crypto.createHash('sha1').update(seed).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function titleCaseDomain(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'daily') return 'Daily';
  if (normalized === 'social') return 'Social';
  if (normalized === 'travel') return 'Travel';
  return value;
}

function uniqueList(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function uniqueLangCodes(values) {
  return [
    ...new Set(values.map((value) => normalizeKey(value)).filter(Boolean)),
  ].sort();
}

function isSourcePack(manifest) {
  return normalizeKey(manifest?.pack_role) === 'source';
}

function collectContentLanguages(content) {
  return uniqueLangCodes([
    ...((content.lexemes ?? []).map((row) => row.lang)),
    ...((content.lexeme_forms ?? []).map((row) => row.lang)),
    ...((content.concept_definitions ?? []).map((row) => row.lang)),
    ...((content.examples ?? []).flatMap((row) => [
      row.lang,
      row.translation_lang,
    ])),
    ...((content.clusters ?? []).map((row) => row.lang)),
  ]);
}

function makeClusterId(packId, label, type) {
  return deterministicUuid(`cluster:${packId}:${type}:${label.toLowerCase()}`);
}

function buildMetadataCurationHelpers(packId) {
  return {
    normalizeKey,
    normalizeSearchKey,
    normalizeText,
    titleCaseDomain,
    uniqueList,
    makeClusterId(label, type) {
      return makeClusterId(packId, label, type);
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifestPath = path.join(packDir, 'manifest.json');
  const contentPath = path.join(packDir, 'content.json');

  const manifest = readJson(manifestPath);
  const content = readJson(contentPath);
  const packId = manifest.pack_id ?? 'unknown-pack';

  if (isSourcePack(manifest)) {
    const languagesPresent = collectContentLanguages(content);
    manifest.languages_present = languagesPresent;
    delete manifest.study_target_languages;
    delete manifest.study_gloss_languages;
    delete manifest.languages_target_supported;
    delete manifest.gloss_languages_supported;
  }

  const concepts = Array.isArray(content.concepts) ? content.concepts : [];
  const metadataHelpers = buildMetadataCurationHelpers(packId);
  const metadataCurationPlugins = listMetadataCurationPlugins();

  let conceptsWithDomainUpdates = 0;
  let conceptsWithLevelOverrideUpdates = 0;
  let conceptsDefaultedToDaily = 0;
  let unresolvedClusterMembers = 0;
  const metadataCurationPluginSummaries = [];

  if (metadataCurationPlugins.length > 0) {
    const curatedClusters = [];
    const curatedClusterMembers = [];

    for (const plugin of metadataCurationPlugins) {
      const result =
        plugin.curateSourceMetadata?.({
          content,
          packId,
          helpers: metadataHelpers,
          levels: LEVELS,
        }) ?? null;
      if (!result) {
        continue;
      }

      if (Array.isArray(result.clusters)) {
        curatedClusters.push(...result.clusters);
      }
      if (Array.isArray(result.clusterMembers)) {
        curatedClusterMembers.push(...result.clusterMembers);
      }

      const summary = result.summary ?? {};
      conceptsWithDomainUpdates += summary.conceptsWithDomainUpdates ?? 0;
      conceptsWithLevelOverrideUpdates +=
        summary.conceptsWithLevelOverrideUpdates ?? 0;
      conceptsDefaultedToDaily += summary.conceptsDefaultedToDaily ?? 0;
      unresolvedClusterMembers += summary.unresolvedClusterMembers ?? 0;
      metadataCurationPluginSummaries.push({
        languageCode: plugin.languageCode ?? 'unknown',
        ...summary,
      });
    }

    content.clusters = curatedClusters;
    content.cluster_members = curatedClusterMembers;
  }

  manifest.generated_at = new Date().toISOString();

  const summary = {
    concepts: concepts.length,
    conceptsWithDomainUpdates,
    conceptsDefaultedToDaily,
    conceptsWithLevelOverrideUpdates,
    clusters: Array.isArray(content.clusters) ? content.clusters.length : 0,
    clusterMembers: Array.isArray(content.cluster_members)
      ? content.cluster_members.length
      : 0,
    unresolvedClusterMembers,
    metadataCurationPluginsApplied: metadataCurationPluginSummaries.map(
      (entry) => entry.languageCode,
    ),
    metadataCurationPluginSummaries,
    sourceManifestLanguagesPresent: isSourcePack(manifest)
      ? manifest.languages_present
      : null,
  };

  if (!options.dryRun) {
    writeJson(contentPath, content);
    writeJson(manifestPath, manifest);
  }

  const mode = options.dryRun ? 'DRY RUN' : 'UPDATED';
  console.log(`${mode} pack metadata: ${path.relative(process.cwd(), packDir)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
