#!/usr/bin/env node
/**
 * Runs Corte Suprema (pj-peru buCorte=1) in parallel by year.
 *
 * Year filters are disjoint, so this is safe to merge without duplicate pages.
 * Use this for speed validation before attempting larger full-corpus runs.
 */

import { spawn } from 'child_process';
import { mkdirSync, createReadStream, createWriteStream, statSync, readdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const get = flag => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const has = flag => args.includes(flag);

const currentYear = new Date().getFullYear();
const fromYear = Number(get('--from-year') ?? 2007);
const toYear = Number(get('--to-year') ?? currentYear);
const explicitYears = get('--years');
const years = explicitYears
  ? explicitYears.split(',').map(y => y.trim()).filter(Boolean)
  : Array.from({ length: toYear - fromYear + 1 }, (_, i) => String(toYear - i));

const pdfs = has('--pdfs');
const pdfConc = get('--pdf-concurrency') ?? '5';
const limit = get('--limit');
const dryRun = has('--dry-run');
const resume = has('--resume');
const maxWorkers = Math.max(1, Number(get('--concurrency') ?? 12));
const slots = Math.min(maxWorkers, years.length);

const ts = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const outDir = get('--out-dir') ?? `output/runs/suprema-years-${ts}`;
const pdfDir = get('--pdf-dir') ?? 'output/pdfs';

mkdirSync(outDir, { recursive: true });
if (pdfs) mkdirSync(pdfDir, { recursive: true });

const W = 76;
const hr = (c = '-') => process.stdout.write(c.repeat(W) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const elapsed = ms => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
};
const pdfCount = () => {
  try { return readdirSync(pdfDir).filter(f => f.endsWith('.pdf')).length; }
  catch { return 0; }
};

hr('=');
process.stdout.write('  Suprema Parallel Scrape -- pj-peru Corte Suprema (buCorte=1)\n');
process.stdout.write(`  ${years.length} years | ${slots} workers | PDFs: ${pdfs ? `YES (conc ${pdfConc})` : 'NO'}\n`);
process.stdout.write(`  Run folder: ${outDir}\n  PDF store:  ${pdfDir}\n`);
hr('=');
process.stdout.write('\n');

const results = [];
const startTimes = new Map();
const runStart = Date.now();
let activeCount = 0;
let doneCount = 0;
let idx = 0;

const dashboard = () => {
  const ok = results.filter(r => r.code === 0).length;
  const fail = results.filter(r => r.code !== 0).length;
  const pending = years.length - doneCount - activeCount;
  const pdfsText = pdfs ? ` | PDFs: ${pdfCount()}` : '';
  hr();
  process.stdout.write(`  ${doneCount}/${years.length} done | OK: ${ok} | FAIL: ${fail} | activos: ${activeCount} | pendientes: ${pending}${pdfsText} | tiempo: ${elapsed(Date.now() - runStart)}\n`);
  hr();
  process.stdout.write('\n');
};

const spawnYear = year => new Promise(resolveYear => {
  const outFile = `${outDir}/suprema-${year}.jsonl`;
  const checkpointId = `y${year}`;
  const cliArgs = [
    'dist/cli.js', '--site', 'pj-peru', '--sector', '1',
    '--year', year, '--checkpoint-id', checkpointId,
    '--out', outFile, '--pdf-concurrency', pdfConc,
  ];
  if (pdfs) cliArgs.push('--pdfs', '--pdf-dir', pdfDir);
  if (limit) cliArgs.push('--limit', limit);
  if (dryRun) cliArgs.push('--dry-run');
  if (resume) cliArgs.push('--resume');

  startTimes.set(year, Date.now());
  activeCount++;

  const pad = `[SUPREMA ${year}]`;
  process.stdout.write(`  START ${pad.padEnd(16)} slot ${activeCount}/${slots} | total ${idx}/${years.length}\n`);

  const proc = spawn('node', cliArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.setMaxListeners(0);
  proc.stderr.setMaxListeners(0);
  proc.stdout.on('data', buf =>
    buf.toString().split('\n').filter(Boolean).forEach(l => process.stdout.write(`  ${pad} ${l}\n`)));
  proc.stderr.on('data', buf =>
    buf.toString().split('\n').filter(Boolean).forEach(l => process.stderr.write(`  ${pad} ERR ${l}\n`)));

  proc.on('close', code => {
    activeCount--;
    doneCount++;
    const icon = code === 0 ? 'OK  ' : 'FAIL';
    process.stdout.write(`\n  ${icon} DONE  ${pad} exit ${code} | tiempo: ${elapsed(Date.now() - startTimes.get(year))}\n`);
    results.push({ year, outFile, code });
    dashboard();
    resolveYear();
  });
});

const pool = Array.from({ length: slots }, async (_, slotIdx) => {
  const jitterMs = slotIdx * 900 + Math.random() * 1200;
  if (slotIdx > 0) await sleep(jitterMs);
  while (idx < years.length) {
    const year = years[idx++];
    await spawnYear(year);
  }
});
await Promise.all(pool);

const ok = results.filter(r => r.code === 0);
const failed = results.filter(r => r.code !== 0);

process.stdout.write('\n');
hr('=');
process.stdout.write(`  SUPREMA YEARS COMPLETE\n`);
process.stdout.write(`  OK: ${ok.length}/${years.length} | FAIL: ${failed.length} | tiempo total: ${elapsed(Date.now() - runStart)}\n`);
if (failed.length) process.stdout.write(`  FALLIDOS: ${failed.map(r => r.year).join(', ')}\n`);
hr('=');
process.stdout.write('\n');

if (!dryRun && ok.length > 0) {
  const mergedPath = `${outDir}/all-suprema-years.jsonl`;
  process.stdout.write(`  >> Merging ${ok.length} archivos -> ${mergedPath}\n`);
  const writer = createWriteStream(mergedPath, { flags: 'w' });
  writer.setMaxListeners(0);
  for (const { outFile } of ok) {
    try { await pipeline(createReadStream(outFile), writer, { end: false }); }
    catch { /* year had zero results */ }
  }
  writer.end();
  await new Promise(res => writer.on('finish', res));
  try {
    const kb = (statSync(mergedPath).size / 1024).toFixed(0);
    process.stdout.write(`  OK Merged: ${mergedPath} (${kb} KB)\n\n`);
  } catch {}
}
