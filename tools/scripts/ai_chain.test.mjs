// The AI authoring chain end to end against a fake local LLM: draft -> promote
// -> finalize -> runtime pack. Runs in a temp copy, never touches the repo's
// source pack. The real model only changes what the drafts say, not the wiring.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const toolsDir = path.resolve(import.meta.dirname, '..');
const repoDir = path.resolve(toolsDir, '..');

const DRAFT = {
  match: { kind: 'new', concept_id: null, confidence: 0.95, reason: 'No backwards concept.' },
  concept: { pos: 'adv', level: 'A1', gender: 'none', domain_tags: ['Daily'] },
  lexemes: {
    de: { text: 'rückwärts', lemma: 'rückwärts' },
    it: { text: "all'indietro", lemma: "all'indietro" },
    en: { text: 'backwards', lemma: 'backwards' },
  },
  definitions: {
    de: 'In die Richtung hinter einem.',
    it: 'Nella direzione alle proprie spalle.',
    en: 'In the direction behind you.',
  },
  synonyms: { de: [], it: [], en: [] },
  antonyms: { de: [], it: [], en: [] },
  example: {
    de: 'Das Auto fährt aus der Garage, mit dem Heck zuerst.',
    it: "L'auto esce dal garage con il retro davanti.",
    en: 'The car leaves the garage rear end first.',
  },
};

function fakeLlm() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      calls.push(req.url);
      // connection: close, or each child process waits on the idle keep-alive socket.
      res.setHeader('connection', 'close');
      const reply = (data) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };
      if (req.url === '/api/tags') return reply({ models: [{ name: 'fake-7b', details: { parameter_size: '7B' } }] });
      if (req.url === '/api/show') return reply({ capabilities: ['completion'] });
      if (req.url === '/api/chat') return reply({ message: { content: JSON.stringify(DRAFT) } });
      res.statusCode = 404;
      res.end('not faked');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls })));
}

function run(cwd, script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(toolsDir, script), ...args], { cwd, env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('draft, promote and finalize put a new word into a runtime pack', async () => {
  const { server, calls } = await fakeLlm();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-ai-chain-'));
  try {
    fs.cpSync(path.join(repoDir, 'packs/lexicon_source'), path.join(tmp, 'packs/lexicon_source'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'authoring'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'authoring/wish.jsonl'), `${JSON.stringify({ term: 'rückwärts', lang: 'de' })}\n`);
    const env = { LLM_HOST: `http://127.0.0.1:${server.address().port}`, NO_COLOR: '1' };

    const drafted = await run(tmp, 'scripts/draft_from_wishlist.mjs', ['--wishlist', 'authoring/wish.jsonl', '--no-embed'], env);
    assert.equal(drafted.code, 0, drafted.out);
    assert.ok(calls.includes('/api/chat'), 'the drafter never asked the model');
    const draftFile = fs.readdirSync(path.join(tmp, 'authoring/drafts')).find((f) => f.endsWith('.jsonl'));
    assert.ok(draftFile, 'no draft written');

    const promoted = await run(tmp, 'scripts/promote_drafts.mjs', ['--file', `authoring/drafts/${draftFile}`, '--apply'], env);
    assert.equal(promoted.code, 0, promoted.out);
    const read = () => JSON.parse(fs.readFileSync(path.join(tmp, 'packs/lexicon_source/content.json'), 'utf8'));
    const lexeme = read().lexemes.find((row) => row.lang === 'de' && row.text === 'rückwärts');
    assert.ok(lexeme, `promote did not add the word:\n${promoted.out}`);
    const conceptId = lexeme.concept_id;

    const finalized = await run(tmp, 'pipeline/finalize_source.mjs', ['--pack-dir', 'packs/lexicon_source'], env);
    assert.equal(finalized.code, 0, finalized.out);
    const after = read();
    assert.equal(after.concepts.find((row) => row.concept_id === conceptId).review_status, 'reviewed', finalized.out);
    const formLexemes = new Set(after.lexeme_forms.map((row) => row.lexeme_id));
    for (const row of after.lexemes.filter((r) => r.concept_id === conceptId)) {
      assert.ok(formLexemes.has(row.lexeme_id), `no forms for ${row.lexeme_id}`);
    }

    const built = await run(tmp, 'pipeline/build_target_pack_from_source.mjs', [
      '--source-pack-dir', 'packs/lexicon_source', '--dest-pack-dir', 'out/it_a1', '--pack-id', 'test.it.a1',
      '--target-lang', 'it', '--level', 'A1', '--kind', 'vocab', '--version', '1.0.0',
    ], env);
    assert.equal(built.code, 0, built.out);
    const runtime = JSON.parse(fs.readFileSync(path.join(tmp, 'out/it_a1/content.json'), 'utf8'));
    assert.ok(runtime.concepts.some((row) => row.concept_id === conceptId), 'the new word is not in the runtime pack');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
