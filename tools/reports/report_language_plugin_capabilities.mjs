import { handleCliHelp } from '../lib/cli_help.mjs';
import {
  BUILD_LANGUAGE_PLUGIN_CAPABILITIES,
} from '../lib/language_plugins/build_language_plugin_capabilities.mjs';
import {
  getBuildLanguagePluginCapabilitiesForLanguage,
  getBuildLanguagePluginSummary,
  getMissingBuildLanguageCapabilitiesForLanguage,
  listBuildLanguagePluginSummaries,
} from '../lib/language_plugins/build_language_plugin_registry.mjs';

const HELP_TEXT = `
Usage:
  pnpm node tools/reports/report_language_plugin_capabilities.mjs [options]

Options:
  --language <code>              Optional language code to inspect in detail
  --require-capability <id>      Optional capability requirement to check. Repeatable.
  -h, --help                     Show this help message
`;

function normalizeCapability(value) {
  return String(value ?? '').trim().toLowerCase();
}

function parseArgs(argv) {
  handleCliHelp(argv, HELP_TEXT);
  const options = {
    language: null,
    requiredCapabilities: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--language') {
      options.language = String(argv[++i] ?? '').trim().toLowerCase() || null;
    } else if (arg === '--require-capability') {
      const value = normalizeCapability(argv[++i]);
      if (value) {
        options.requiredCapabilities.push(value);
      }
    }
  }

  return options;
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeCapability(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const requiredCapabilities = unique(options.requiredCapabilities);
  const summaries = listBuildLanguagePluginSummaries();

  const payload = {
    known_capabilities: Object.values(BUILD_LANGUAGE_PLUGIN_CAPABILITIES),
    plugins: summaries,
  };

  if (options.language) {
    payload.language = options.language;
    payload.plugin = getBuildLanguagePluginSummary(options.language);
    payload.capabilities =
      getBuildLanguagePluginCapabilitiesForLanguage(options.language);
  }

  if (requiredCapabilities.length > 0) {
    payload.required_capabilities = requiredCapabilities;
    payload.missing_by_language = Object.fromEntries(
      summaries.map((summary) => [
        summary.languageCode,
        getMissingBuildLanguageCapabilitiesForLanguage(
          summary.languageCode,
          requiredCapabilities,
        ),
      ]),
    );
  }

  console.log(JSON.stringify(payload, null, 2));
}

main();
