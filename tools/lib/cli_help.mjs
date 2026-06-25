export function handleCliHelp(argv, helpText) {
  if (!Array.isArray(argv)) {
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(String(helpText ?? '').trim());
    process.exit(0);
  }
}
