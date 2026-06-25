import fs from 'node:fs';
import path from 'node:path';

import { handleCliHelp } from '../lib/cli_help.mjs';
import {
  MACRO_DOMAIN_TAGS,
  POS_BALANCE_TARGETS,
  normalizeDomainTags,
} from '../lib/content_taxonomy.mjs';
import { DEFAULT_SOURCE_PACK_DIR } from '../lib/default_pack_paths.mjs';
import {
  DEFAULT_LEXICON_LEVEL,
  LEXICON_LEVELS,
  normalizeLexiconLevel,
} from '../lib/lexicon_conventions.mjs';

const DEFAULT_PACK_DIR = DEFAULT_SOURCE_PACK_DIR;
const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_pack_balance.mjs [options]

Options:
  --pack-dir <dir>         Pack directory to inspect. Default: packs/lexicon_source
  --target-size <number>   Pragmatic per-level target size used for warnings. Default: 100
  -h, --help               Show this help message
`;

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    packDir: DEFAULT_PACK_DIR,
    targetSize: 100,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pack-dir') options.packDir = argv[++i];
    else if (arg === '--target-size') options.targetSize = Number(argv[++i]);
  }

  return options;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLevel(value) {
  return normalizeLexiconLevel(value) ?? DEFAULT_LEXICON_LEVEL;
}

function share(count, total) {
  if (total <= 0) return 0;
  return Number((count / total).toFixed(4));
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function buildWarnings(bucket, targetSize) {
  const warnings = [];
  const total = bucket.total;
  if (total === 0) {
    warnings.push('No concepts found for this level.');
    return warnings;
  }

  if (targetSize > 0 && total < targetSize) {
    warnings.push(
      `Below the pragmatic target size (${total}/${targetSize} concepts).`,
    );
  }

  for (const [pos, config] of Object.entries(POS_BALANCE_TARGETS)) {
    const currentShare = share(bucket.pos[pos] ?? 0, total);
    const minShare = config.minShare;
    const maxShare = config.maxShare;
    if (total >= 20 && currentShare < minShare) {
      warnings.push(
        `${pos} share is low (${formatPercent(currentShare)} < ${formatPercent(minShare)}).`,
      );
    }
    if (total >= 20 && currentShare > maxShare) {
      warnings.push(
        `${pos} share is high (${formatPercent(currentShare)} > ${formatPercent(maxShare)}).`,
      );
    }
  }

  const macroCoverage = MACRO_DOMAIN_TAGS.filter(
    (domain) => (bucket.macroDomains[domain] ?? 0) > 0,
  );
  if (total >= 20 && macroCoverage.length < 2) {
    warnings.push(
      `Macro-topic spread is narrow (${macroCoverage.join(', ') || 'none'}).`,
    );
  }
  if (total >= 50 && macroCoverage.length < 3) {
    warnings.push(
      `Macro-topic spread should cover at least 3 macro categories by this size.`,
    );
  }

  return warnings;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(options.packDir);
  const manifest = readJson(path.join(packDir, 'manifest.json'));
  const content = readJson(path.join(packDir, 'content.json'));
  const concepts = Array.isArray(content.concepts) ? content.concepts : [];

  const buckets = new Map();

  for (const concept of concepts) {
    const level = normalizeLevel(concept.level_override ?? concept.level_auto);
    const bucket =
      buckets.get(level) ??
      {
        total: 0,
        pos: { noun: 0, verb: 0, adj: 0, adv: 0, chunk: 0 },
        macroDomains: Object.fromEntries(
          MACRO_DOMAIN_TAGS.map((domain) => [domain, 0]),
        ),
        domains: {},
      };
    bucket.total += 1;
    const pos = normalizeText(concept.pos).toLowerCase();
    bucket.pos[pos] = (bucket.pos[pos] ?? 0) + 1;

    const domains = normalizeDomainTags(concept.domain_tags ?? [], {
      fallback: ['Daily'],
    });
    for (const domain of domains) {
      bucket.domains[domain] = (bucket.domains[domain] ?? 0) + 1;
      if (MACRO_DOMAIN_TAGS.includes(domain)) {
        bucket.macroDomains[domain] = (bucket.macroDomains[domain] ?? 0) + 1;
      }
    }
    buckets.set(level, bucket);
  }

  const summary = {};
  for (const level of LEXICON_LEVELS) {
    const bucket = buckets.get(level);
    if (!bucket) {
      continue;
    }
    summary[level] = {
      total: bucket.total,
      pos: Object.fromEntries(
        Object.entries(bucket.pos).map(([pos, count]) => [
          pos,
          {
            count,
            share: share(count, bucket.total),
          },
        ]),
      ),
      macro_domains: bucket.macroDomains,
      top_domains: Object.entries(bucket.domains)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12),
      warnings: buildWarnings(bucket, options.targetSize),
    };
  }

  console.log(
    JSON.stringify(
      {
        pack_id: manifest.pack_id,
        version: manifest.version,
        target_size: options.targetSize,
        levels: summary,
      },
      null,
      2,
    ),
  );
}

main();
