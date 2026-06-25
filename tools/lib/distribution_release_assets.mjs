import fs from 'node:fs';
import path from 'node:path';

/**
 * Path <-> Release-asset-name flattening for the Lexicon distribution.
 *
 * GitHub Release asset names are FLAT: they cannot contain a path separator.
 * The built distribution is a nested tree:
 *
 *   root_manifest.json
 *   indexes/<lang>.json
 *   chunks/<lang>/<pack_id>/content.json
 *   chunks/<lang>/<pack_id>/manifest.json
 *
 * When the distribution is published to a GitHub Release (ADR-0004), each file
 * becomes one asset whose name is the relative path with '/' replaced by the
 * separator below. The consumer (admin_console) reverses this to map an
 * incoming '/lexicon/<rel-path>' request back to the flat asset to download.
 *
 * This naming scheme is part of the inter-repo contract. It is intentionally
 * lossless and reversible: no path segment may contain the separator, so
 * unflatten(flatten(x)) === x for every distribution path. The check below
 * enforces that invariant at build time rather than letting a bad name ship.
 *
 *   indexes/de.json                        -> indexes__de.json
 *   chunks/de/lexicon.de.a1.seed/content.json
 *       -> chunks__de__lexicon.de.a1.seed__content.json
 *   root_manifest.json                     -> root_manifest.json
 */
export const ASSET_PATH_SEPARATOR = '__';

function toPosixSegments(relPath) {
  return String(relPath)
    .split(path.sep)
    .join('/')
    .split('/')
    .filter((segment) => segment.length > 0);
}

/**
 * Flattens a distribution-relative path into a Release asset name.
 * Throws if any segment contains the separator (would break the round-trip).
 */
export function flattenDistributionPath(relPath) {
  const segments = toPosixSegments(relPath);
  if (segments.length === 0) {
    throw new Error(`Empty distribution path cannot be flattened: "${relPath}"`);
  }
  for (const segment of segments) {
    if (segment.includes(ASSET_PATH_SEPARATOR)) {
      throw new Error(
        `Distribution path segment "${segment}" contains the reserved ` +
          `separator "${ASSET_PATH_SEPARATOR}" and cannot be flattened ` +
          `losslessly (path: "${relPath}").`,
      );
    }
  }
  return segments.join(ASSET_PATH_SEPARATOR);
}

/**
 * Reverses {@link flattenDistributionPath}: a Release asset name back into the
 * distribution-relative path the consumer serves it under.
 */
export function unflattenAssetName(assetName) {
  return String(assetName).split(ASSET_PATH_SEPARATOR).join('/');
}

/**
 * Recursively lists every file under a built distribution dir and returns the
 * publish plan: one entry per file with its absolute path, the
 * distribution-relative path, and the flattened Release asset name.
 *
 * Sorted by asset name for deterministic output (stable dry-runs + uploads).
 */
export function planReleaseAssets(distDir) {
  const root = path.resolve(distDir);
  if (!fs.existsSync(root)) {
    throw new Error(`Distribution dir not found: ${root} - build it first`);
  }
  const plan = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(root, absPath);
        plan.push({
          absPath,
          relPath: relPath.split(path.sep).join('/'),
          assetName: flattenDistributionPath(relPath),
        });
      }
    }
  };
  walk(root);
  plan.sort((a, b) => a.assetName.localeCompare(b.assetName));
  return plan;
}
