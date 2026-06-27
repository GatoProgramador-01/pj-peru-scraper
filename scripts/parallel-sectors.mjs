#!/usr/bin/env node
/**
 * Runs one `node dist/cli.js` process per sector in parallel.
 *
 * Usage:
 *   node scripts/parallel-sectors.mjs --site oefa [--pdfs] [--pdf-dir output/oefa/pdfs] [--pdf-concurrency 20] [--limit N] [--dry-run] [--resume]
 *
 * Each sector writes to output/<site>/sector-<id>-<NAME>.jsonl
 * After all complete, merges into output/<site>/all-sectors.jsonl
 */

import { spawn } from 'child_process';
import { mkdirSync, createReadStream, createWriteStream, statSync } from 'fs';
import { pipeline } from 'stream/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors src/config.ts — update here if sectors change
const SECTOR_MAP = {
  'oefa': { '1': 'MINERIA', '2': 'ELECTRICIDAD', '3': 'HIDROCARBUROS', '8': 'PESQUERIA', '9': 'INDUSTRIA' },
};

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const has = (flag) => args.includes(flag);

const site         = get('--site') ?? 'oefa';
const pdfs         = has('--pdfs');
const pdfDir       = get('--pdf-dir') ?? `output/${site}/pdfs`;
const pdfConc      = get('--pdf-concurrency') ?? '20';
const limit        = get('--limit');
const dryRun       = has('--dry-run');
const resume       = has('--resume');

const sectors = SECTOR_MAP[site];
if (!sectors) {
  console.error(`Site "${site}" has no sector map — run directly: node dist/cli.js --site ${site}`);
  process.exit(1);
}

const outDir = `output/${site}`;
mkdirSync(outDir, { recursive: true });
if (pdfs) mkdirSync(pdfDir, { recursive: true });

const entries = Object.entries(sectors);
console.log(`\n${'='.repeat(66)}`);
console.log(`  \u{1F431} Parallel scrape: ${site.toUpperCase()} — ${entries.length} sectors en paralelo`);
console.log(`${'='.repeat(66)}\n`);

const results = await Promise.all(entries.map(([id, name]) => {
  const outFile = `${outDir}/sector-${id}-${name}.jsonl`;

  const cliArgs = ['dist/cli.js', '--site', site, '--sector', id, '--out', outFile, '--pdf-concurrency', pdfConc];
  if (pdfs)   { cliArgs.push('--pdfs', '--pdf-dir', pdfDir); }
  if (limit)  { cliArgs.push('--limit', limit); }
  if (dryRun) { cliArgs.push('--dry-run'); }
  if (resume) { cliArgs.push('--resume'); }

  console.log(`  \u{1F638} [${id}=${name}] → ${outFile}`);

  const proc = spawn('node', cliArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

  const pad = `[${(id + '=' + name).padEnd(16)}]`;
  proc.stdout.on('data', buf =>
    buf.toString().split('\n').filter(Boolean).forEach(l => process.stdout.write(`${pad} ${l}\n`)));
  proc.stderr.on('data', buf =>
    buf.toString().split('\n').filter(Boolean).forEach(l => process.stderr.write(`${pad} ERR ${l}\n`)));

  return new Promise(res => proc.on('close', code => {
    const icon = code === 0 ? '\u{1F63B}' : '❌';
    console.log(`  ${icon} [${id}=${name}] exit ${code}`);
    res({ id, name, outFile, code });
  }));
}));

const ok     = results.filter(r => r.code === 0);
const failed = results.filter(r => r.code !== 0);

console.log(`\n${'='.repeat(66)}`);
console.log(`  PARALLEL COMPLETE — ${ok.length}/${entries.length} sectores OK`);
if (failed.length) console.log(`  FALLIDOS: ${failed.map(r => `${r.id}=${r.name}`).join(', ')}`);
console.log(`${'='.repeat(66)}\n`);

if (!dryRun && ok.length > 0) {
  const mergedPath = `${outDir}/all-sectors.jsonl`;
  console.log(`  \u{1F43E} Merging → ${mergedPath}`);
  const writer = createWriteStream(mergedPath, { flags: 'w' });
  for (const { outFile } of ok) {
    try { await pipeline(createReadStream(outFile), writer, { end: false }); }
    catch { /* sector had zero results — file may be empty */ }
  }
  writer.end();
  await new Promise(res => writer.on('finish', res));
  try {
    const kb = (statSync(mergedPath).size / 1024).toFixed(0);
    console.log(`  \u{1F63B} Merged: ${mergedPath} (${kb} KB)\n`);
  } catch {}
}
