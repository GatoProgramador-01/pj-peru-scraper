#!/usr/bin/env node
/**
 * parallel-districts.mjs — runs one `node dist/cli.js` per Superior-court district in parallel.
 *
 * Splits pj-peru buCorte=2 (Superior) across 34 judicial districts instead of scraping
 * all districts in a single serial session. Estimated speedup: ~20× for Superior.
 *
 * Usage:
 *   node scripts/parallel-districts.mjs [--pdfs] [--pdf-dir output/pjperu-districts/pdfs]
 *                                        [--pdf-concurrency 10] [--limit N] [--dry-run] [--resume]
 *                                        [--concurrency 10]
 *
 * Each district writes to output/pjperu-districts/district-<id>-<NAME>.jsonl
 * After all complete, merges into output/pjperu-districts/all-districts.jsonl
 *
 * District IDs discovered 2026-06-27 via AJAX cascade buCorte=2 → buDistrito options.
 */

import { spawn } from 'child_process';
import { mkdirSync, createReadStream, createWriteStream, statSync } from 'fs';
import { pipeline } from 'stream/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// All 34 Superior-court districts — discovered 2026-06-27 via RichFaces AJAX cascade
const DISTRICTS = {
  '1':  'AMAZONAS',
  '2':  'ANCASH',
  '3':  'APURIMAC',
  '4':  'AREQUIPA',
  '5':  'AYACUCHO',
  '6':  'CAJAMARCA',
  '7':  'CALLAO',
  '8':  'CANETE',
  '9':  'LIMA_NORTE',
  '10': 'CUSCO',
  '11': 'HUANCAVELICA',
  '12': 'HUANUCO',
  '13': 'HUAURA',
  '14': 'ICA',
  '15': 'JUNIN',
  '16': 'LA_LIBERTAD',
  '17': 'LAMBAYEQUE',
  '18': 'LIMA',
  '19': 'LORETO',
  '20': 'PIURA',
  '21': 'PUNO',
  '22': 'SAN_MARTIN',
  '23': 'TACNA',
  '24': 'UCAYALI',
  '25': 'DEL_SANTA',
  '26': 'TUMBES',
  '27': 'MADRE_DE_DIOS',
  '28': 'MOQUEGUA',
  '29': 'PASCO',
  '30': 'LIMA_SUR',
  '31': 'SULLANA',
  '38': 'LIMA_ESTE',
  '39': 'PUENTE_PIEDRA',
  '41': 'SELVA_CENTRAL',
};

const args   = process.argv.slice(2);
const get    = f => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const has    = f => args.includes(f);

const pdfs        = has('--pdfs');
const pdfDir      = get('--pdf-dir')         ?? 'output/pjperu-districts/pdfs';
const pdfConc     = get('--pdf-concurrency') ?? '10';
const limit       = get('--limit');
const dryRun      = has('--dry-run');
const resume      = has('--resume');
const freshOutput = has('--fresh-output');
const maxWorkers  = parseInt(get('--concurrency') ?? '20', 10);

const outDir = 'output/pjperu-districts';
mkdirSync(outDir, { recursive: true });
if (pdfs) mkdirSync(pdfDir, { recursive: true });

const entries = Object.entries(DISTRICTS);
console.log(`\n${'='.repeat(70)}`);
console.log(`  District Parallel Scrape -- pj-peru Superior (buCorte=2)`);
console.log(`  ${entries.length} distritos | max ${maxWorkers} workers simultáneos | PDFs: ${pdfs ? 'SI' : 'NO'}`);
console.log(`${'='.repeat(70)}\n`);

const results = [];
let idx = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const spawnDistrict = (id, name) => new Promise(resolve => {
  const outFile = `${outDir}/district-${id}-${name}.jsonl`;
  const cliArgs = [
    'dist/cli.js', '--site', 'pj-peru', '--sector', '2', '--district', id,
    '--out', outFile, '--pdf-concurrency', pdfConc,
  ];
  if (pdfs)        { cliArgs.push('--pdfs', '--pdf-dir', pdfDir); }
  if (limit)       { cliArgs.push('--limit', limit); }
  if (dryRun)      { cliArgs.push('--dry-run'); }
  if (resume)      { cliArgs.push('--resume'); }
  if (freshOutput) { cliArgs.push('--fresh-output'); }

  const pad = `[${(id + '=' + name).padEnd(20)}]`;
  console.log(`  START ${pad} -> ${outFile}`);

  const proc = spawn('node', cliArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.setMaxListeners(0);
  proc.stderr.setMaxListeners(0);
  proc.stdout.on('data', buf =>
    buf.toString().split('\n').filter(Boolean).forEach(l => process.stdout.write(`${pad} ${l}\n`)));
  proc.stderr.on('data', buf =>
    buf.toString().split('\n').filter(Boolean).forEach(l => process.stderr.write(`${pad} ERR ${l}\n`)));

  proc.on('close', code => {
    const icon = code === 0 ? 'OK  ' : 'FAIL';
    console.log(`  ${icon} DONE  ${pad} exit ${code}`);
    results.push({ id, name, outFile, code });
    resolve();
  });
});

// Concurrency pool with startup jitter:
// Each slot waits slotIdx * 600ms + random(800ms) before its FIRST launch.
// This spreads the initial thundering herd across ~12-20s instead of all hitting T=0.
const pool = Array.from({ length: Math.min(maxWorkers, entries.length) }, async (_, slotIdx) => {
  const jitterMs = slotIdx * 600 + Math.random() * 800;
  if (slotIdx > 0) await sleep(jitterMs);
  while (idx < entries.length) {
    const [id, name] = entries[idx++];
    await spawnDistrict(id, name);
  }
});
await Promise.all(pool);

const ok     = results.filter(r => r.code === 0);
const failed = results.filter(r => r.code !== 0);

console.log(`\n${'='.repeat(70)}`);
console.log(`  DISTRICTS COMPLETE — ${ok.length}/${entries.length} OK`);
if (failed.length) console.log(`  FALLIDOS: ${failed.map(r => `${r.id}=${r.name}`).join(', ')}`);
console.log(`${'='.repeat(70)}\n`);

if (!dryRun && ok.length > 0) {
  const mergedPath = `${outDir}/all-districts.jsonl`;
  console.log(`  >> Merging -> ${mergedPath}`);
  const writer = createWriteStream(mergedPath, { flags: 'w' });
  writer.setMaxListeners(0);
  for (const { outFile } of ok) {
    try { await pipeline(createReadStream(outFile), writer, { end: false }); }
    catch { /* district had zero results */ }
  }
  writer.end();
  await new Promise(res => writer.on('finish', res));
  try {
    const kb = (statSync(mergedPath).size / 1024).toFixed(0);
    console.log(`  OK Merged: ${mergedPath} (${kb} KB)\n`);
  } catch {}
}
