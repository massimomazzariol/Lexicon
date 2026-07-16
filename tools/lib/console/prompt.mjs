// Shared console prompt helpers (P2 extraction: the console stays a thin
// dispatcher, interaction primitives live here). Zero dependencies: readline
// plus the ANSI palette in colors.mjs.

import { createInterface, emitKeypressEvents } from 'readline';
import { C } from '../colors.mjs';

/** One line of input, trimmed. */
export function ask(q) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res(String(a).trim()); });
  });
}

/** Yes/no line: anything starting with y (case-insensitive) is a yes. */
export async function confirm(q) {
  return (await ask(q)).toLowerCase().startsWith('y');
}

/** Numbered menu; returns the chosen index or -1. */
export async function menu(title, opts) {
  console.log('\n' + C.b(title) + C.dim(':'));
  opts.forEach((o, i) => console.log(`  ${C.cyan(String(i + 1))}) ${o}`));
  const n = parseInt(await ask(C.cyan('> ')), 10);
  return n >= 1 && n <= opts.length ? n - 1 : -1;
}

/** Numbered menu that falls back to the first option on a bad answer. */
export async function pick(label, opts) {
  const i = await menu(label, opts);
  return opts[i] ?? opts[0];
}

/** Multi-select over a numbered list: "1,3,5" / "all" / "none". */
export async function askMulti(title, items) {
  console.log('\n' + C.b(title));
  items.forEach((o, i) => console.log(`  ${C.cyan(String(i + 1))}) ${o}`));
  const a = (await ask(C.dim('keep - e.g. ') + '1,3,5' + C.dim(' / ') + 'all' + C.dim(' / ') + 'none' + C.dim(': '))).toLowerCase();
  if (a === 'all') return items.slice();
  if (a === 'none' || !a) return [];
  return [...new Set(a.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => n >= 1 && n <= items.length))].map((n) => items[n - 1]);
}

/**
 * One raw keypress, restricted to `allowed` (lowercase names; Enter arrives
 * as "enter"). Ctrl-C exits. Falls back to line input when stdin is not a
 * TTY so the flow stays usable in a pipe.
 */
export function readKey(allowed) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return ask('> ').then((line) => {
      const k = (line[0] || 'enter').toLowerCase();
      return !allowed || allowed.includes(k) ? k : 'enter';
    });
  }
  return new Promise((res) => {
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    const onKey = (str, key) => {
      if (key?.ctrl && key.name === 'c') { cleanup(); process.exit(130); }
      const k = key?.name === 'return' ? 'enter' : String(str || key?.name || '').toLowerCase();
      if (!allowed || allowed.includes(k)) { cleanup(); res(k); }
    };
    const cleanup = () => {
      stdin.off('keypress', onKey);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('keypress', onKey);
  });
}
