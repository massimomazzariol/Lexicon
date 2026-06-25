// Zero-dep ANSI colors, shared by the console and the engines. Off when output is piped
// or NO_COLOR is set, so logs/files stay clean. (Subprocesses with stdio:'inherit' keep
// the parent's TTY, so colors propagate through the console → autopilot → eval_fix chain.)

const ON = process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (n) => (s) => (ON ? `\x1b[${n}m${s}\x1b[0m` : String(s));

export const C = {
  b: sgr(1),
  dim: sgr(2),
  red: sgr(31),
  green: sgr(32),
  yellow: sgr(33),
  blue: sgr(34),
  cyan: sgr(36),
  gray: sgr(90)
};
