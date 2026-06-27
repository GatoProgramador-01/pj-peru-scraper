# Codex Task — pj-peru full extraction

**Repo:** GatoProgramador-01/pj-peru-scraper  
**Branch:** feat/pj-peru-full-extraction (already pushed, read HANDOFF-CODEX-2026-06-27.md first)

---

## Context in 5 lines

This is a Node.js/TypeScript HTTP scraper for jurisprudencia.pj.gob.pe (RichFaces JSF portal).
It runs 34 parallel workers (one per judicial district) and writes one JSONL per district.
The portal blocks non-Peru IPs with 403 — VPN to Peru required for all network ops.
Claude Code refactored output to memory-first (atomic write at end) and fixed maxSockets.
6,221 PDFs already downloaded to output/pjperu-districts/pdfs/. All JSONL files were accidentally wiped by --fresh-output on a failed run.

---

## Your job

### 1. Verify VPN
```
curl -s https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml -o /dev/null -w "%{http_code}"
```
Must return `200`. If `403`, stop — do not proceed without VPN.

### 2. Run extraction
```
cd C:\Users\lanitaEmperadora\Desktop\pj-peru-scraper
npm run build
node scripts/parallel-districts.mjs --pdfs --pdf-dir output/pjperu-districts/pdfs --pdf-concurrency 10 --concurrency 20
```
- NO `--fresh-output` (would delete nothing now, but is a footgun)
- NO `--resume` (all checkpoints are incomplete; new logic restarts from page 0 anyway)
- Redirect stdout to a log file for monitoring: append `> output/run-$(date +%Y%m%d-%H%M).log 2>&1`

### 3. Monitor for problems
Watch for these in the log:
- `soft_block_abort` → district stopped early due to empty pages with hasNextPage=true
- `429` events → reduce `--pdf-concurrency` to 5 and restart that district
- District exits with code 1 → check stderr for the error type

### 4. Validate after completion
```bash
node -e "
const fs = require('fs');
const dir = 'output/pjperu-districts';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
let total = 0;
for (const f of files) {
  const n = fs.readFileSync(dir+'/'+f,'utf8').trim().split('\n').filter(Boolean).length;
  total += n;
  console.log(n.toString().padStart(7), f);
}
console.log('TOTAL:', total, '/ expected ~458909');
"
```

### 5. Handle failed districts
If any district exits code 1 after the main run, re-run just that district:
```
node dist/cli.js --site pj-peru --sector 2 --district <ID> \
  --out output/pjperu-districts/district-<ID>-<NAME>.jsonl \
  --pdfs --pdf-dir output/pjperu-districts/pdfs --pdf-concurrency 5
```

### 6. Merge + commit
`parallel-districts.mjs` auto-merges into `output/pjperu-districts/all-districts.jsonl` when done.
Commit the checkpoint files (`output/checkpoint_pj-peru_s2_d*.json`) as run evidence.

---

## What NOT to do
- Don't touch `src/scraper/scraper.ts`, `src/scraper/sectorScraper.ts`, `src/session/session.ts` — stable
- Don't wipe `output/pjperu-districts/pdfs/` — 6,221 PDFs already there
- Don't add `--fresh-output` to any command
- Don't run without VPN — you'll just get 403 and wipe JSONL again

---

## District map (34 total, sector 2 = Superior)
IDs 1-9,10-18,19-29,30-31,38-39,41 → see scripts/parallel-districts.mjs DISTRICTS const
