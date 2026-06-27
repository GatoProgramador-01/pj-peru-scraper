# Handoff to Codex — 2026-06-27

**Branch:** `feat/pj-peru-full-extraction`  
**Remote:** pushed to `origin/feat/pj-peru-full-extraction` (commit `33a4411`)  
**Handed off by:** Claude Code (session ended at context limit)

---

## What changed in this session (last 3 commits)

### `72a16bc` — memory-first JSONL output
**Problem fixed:** `flags:'a'` append + per-page WriteStream write caused duplicates when
a session interrupted between the page write and the checkpoint save. On `--resume` the
checkpoint still pointed to the prior page, so that page's docs were written again.

**Change:** `scrapeSector` now returns `{ count, docs: JudicialDocument[] }` instead of
writing to a stream. `scrapeAll` accumulates all docs across sectors into `allDocs[]`
and writes a single atomic `fs.writeFileSync` at run end.

**Files:** `src/scraper/sectorScraper.ts`, `src/scraper/scraper.ts`

---

### `33a4411` — maxSockets + checkpoint resume fix
**Problem 1:** Node.js default HTTPS agent caps at 5 sockets per host. With 20 parallel
district workers hitting `jurisprudencia.pj.gob.pe`, 15 workers were queued behind 5
open connections. Fix: explicit `https.Agent({ keepAlive: true, maxSockets: 64 })` per
session in `src/session/session.ts`.

**Problem 2:** With memory-first output, `startPage` from mid-district checkpoints was
broken — fast-forward would replay HTTP pages but docs would be skipped from `collected[]`.
Fix: only `completed=true` flag is honoured; all incomplete districts restart from page 0.
Removed the fast-forward HTTP replay loop and all per-page `saveCheckpoint` calls.

**Files:** `src/session/session.ts`, `src/scraper/sectorScraper.ts`

---

## Current output state (as of handoff)

| Artifact | Status |
|---|---|
| `output/pjperu-districts/*.jsonl` | **DELETED** — `--fresh-output` wiped them in a failed run (403 because VPN was off). See below. |
| `output/pjperu-districts/pdfs/` | **INTACT** — 6,221 PDFs from prior extraction sprint |
| `output/pjperu-districts/checkpoints` | **Exist** for districts 1-18, all `completed:false` (mid-district) |
| `output/run-2026-06-27.log` | Failed run log — all 34 workers → 403 Forbidden immediately |

### Why JSONL was deleted
Running `node scripts/parallel-districts.mjs --fresh-output ...` triggers `cli.ts` to
call `fs.rmSync(argv.out)` per worker before any network I/O. The 403 error came *after*
the file was deleted. All previously scraped district JSONL files are gone.

**PDFs are safe** — `--fresh-output` only removes the `.jsonl` output file and `failed-pdfs.json`.

---

## What Codex must do next

### Step 1 — Verify VPN is connected to Peru
```
curl -s https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml -o /dev/null -w "%{http_code}"
```
Expected: `200`. If `403`: VPN is not connected or wrong country. Use CyberGhost → Peru.

### Step 2 — Run extraction (NO --fresh-output)
```
cd C:\Users\lanitaEmperadora\Desktop\pj-peru-scraper
npm run build
node scripts/parallel-districts.mjs --pdfs --pdf-dir output/pjperu-districts/pdfs --pdf-concurrency 10 --concurrency 20
```

Do **NOT** add `--fresh-output` — there are no JSONL files to clear and the flag would
be a no-op now, but it's a footgun if old files exist.

`--resume` is also not useful here: all checkpoints are `completed:false` (mid-district),
which under the new logic means "restart from page 0" anyway.

### Step 3 — Monitor
Tail the log or watch the console. Healthy run shows per-district lines like:
```
  [18=LIMA             ] {"level":"info","message":"Page scraped","page":"1/?","docsThisPage":10,...}
```
If all districts show `ERR 403 Forbidden` → VPN dropped. Kill and reconnect.

### Step 4 — After run completes, validate
```
node -e "
const fs = require('fs');
const dir = 'output/pjperu-districts';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
let total = 0;
for (const f of files) {
  const lines = fs.readFileSync(dir+'/'+f,'utf8').trim().split('\n').filter(Boolean);
  total += lines.length;
  console.log(lines.length.toString().padStart(6), f);
}
console.log('TOTAL:', total);
"
```
Expected total: ~458,909 docs across 34 districts.

### Step 5 — Merge and commit
After all 34 districts complete, `parallel-districts.mjs` auto-merges into
`output/pjperu-districts/all-districts.jsonl`. Verify it, then commit the artifacts
(or at minimum commit the checkpoint files as evidence of completion).

---

## Architecture reference

```
parallel-districts.mjs
  └─ spawns N workers: node dist/cli.js --site pj-peru --sector 2 --district <id> --out district-N-NAME.jsonl
       └─ scrapeAll()  [src/scraper/scraper.ts]
            └─ scrapeSector() → { count, docs }  [src/scraper/sectorScraper.ts]
                 ├─ submitSearch() — RichFaces POST with buCorte=2, buDistrito=<id>
                 ├─ loop: fetchNextPage() AJAX → parsePage() → rowToDocument()
                 ├─ downloadPagePdfs() — concurrent batch via downloadJsfActionPdf()
                 └─ returns all docs in memory
            └─ fs.writeFileSync(outputPath, allDocs.join('\n'))  ← atomic write
```

Key config: `src/config.ts` → `pj-peru` site.  
- `rowParser: 'richfacesRepeat'` — uses RichFaces DataScroller, NOT PrimeFaces  
- `sectorField: 'formBuscador:buCorte'` — sector 2 = Superior (458,909 docs)  
- Districts injected as `formBuscador:buDistrito` field in search POST  
- PDFs: direct GET `ServletDescarga?uuid=...` (no JSF action needed for pj-peru)  

---

## Known risks / things to watch

1. **Soft-block detection**: if `consecutiveEmptyPages >= 3` with `hasNextPage=true`,
   the district stops early. Check `page-events.jsonl` for `soft_block_abort` events
   after the run. Those districts will have fewer docs than expected.

2. **totalRecords vs actual**: pj-peru reports totals at search time but some districts
   may have fewer actual pages if the portal truncates results. Cross-check doc counts
   against known district sizes.

3. **Checkpoint files**: After a successful district, `output/checkpoint_pj-peru_s2_dN.json`
   will have `completed: true`. These are the skip markers for `--resume` on future runs.

4. **PDF concurrency**: currently `--pdf-concurrency 10` per worker × 20 workers = up to
   200 concurrent PDF connections to the same host. Watch for 429 responses in the logs.
   Drop to `--pdf-concurrency 5` if 429s appear.

5. **Memory**: each district buffers all docs in memory before writing. LIMA (~6,000 docs
   × ~800 bytes) ≈ 5 MB. No issue. Largest district should be well under 20 MB.

---

## Files Codex should NOT touch
- `output/pjperu-districts/pdfs/` — 6,221 PDFs already downloaded; don't wipe
- `src/scraper/scraper.ts` — stable after atomic-write refactor
- `src/scraper/sectorScraper.ts` — stable after this session's fixes
- `src/session/session.ts` — maxSockets fix is in place
