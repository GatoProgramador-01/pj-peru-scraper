# Human Test Plan

This plan is for a reviewer cloning the repository into a clean folder and verifying the scraper without running a full multi-hour extraction.

## 1. Clone And Install

```bash
git clone <PUBLIC_REPO_URL>
cd pj-peru-scraper
npm install
# prepare hook runs npm run build automatically
```

## 2. Offline Checks

These checks do not need VPN or live portal access.

```bash
npm run verify:local
```

Expected:

- TypeScript build exits successfully.
- `simulate:429` prints an object with `"ok": true`.

## 3. Optional OEFA Smoke Test

OEFA is the optional no-VPN site from the challenge. Use it to prove HTTP scraping and PDF download without needing Peru VPN.

```bash
npm run scrape:oefa:test100
```

Expected artifacts:

- `output/test100/oefa-documents.jsonl`
- `output/test100/pdfs/*.pdf`
- `output/test100/run-summary.json`
- `output/test100/page-events.jsonl`
- `output/test100/run-report.md`

## 4. PJ Peru VPN Gate

Do not run PJ Peru commands unless this returns `200`.

```bash
curl -s https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml -o /dev/null -w "%{http_code}\n"
```

Expected:

- `200`: continue.
- `403` or anything else: connect VPN to Peru and repeat.

## 5. PJ Peru Minimal Smoke Test

This proves the real RichFaces/JSF flow without downloading the full corpus.

```bash
node dist/cli.js --site pj-peru --dry-run --limit 20
```

Expected:

- Search form submits successfully.
- At least two pages are read.
- Logs show `Page scraped`.

## 6. PJ Peru Parallel Demo

This proves the scalable partitioned path without a full production run.

```bash
npm run scrape:pjperu:districts:dry
```

For a bounded PDF test:

```bash
npm run scrape:pjperu:districts:test
```

Expected:

- District workers start with jitter.
- Each successful district writes a JSONL in a timestamped run folder.
- Completed district JSONLs merge into `all-districts.jsonl`.
- PDFs go to the shared `output/pdfs/` store.

## 7. Suprema Scale Path

Suprema has no district filter, so it is partitioned by year. Start with a dry run to validate without waiting for real results.

```bash
npm run scrape:pjperu:suprema:years:dry
```

For a bounded test with real data (4 recent years, max 500 docs each, ~10 min with VPN):

```bash
npm run scrape:pjperu:suprema:years:test
```

If any year exits with code 1 (`soft_block_abort` in page-events.jsonl), retry those years with concurrency 1:

```bash
npm run scrape:pjperu:suprema:years:retry
```

Expected when retry runs: `120+ docs/min` per year (46% faster than parallel mode — no ViewState pool contention). See `docs/retry-policy.md` for the full explanation.

## 8. What Not To Do

- Do not use `--fresh-output` for PJ Peru runs.
- Do not delete `output/pdfs/` or any previous PDF store during validation.
- Do not launch full PJ Peru extraction without confirming VPN and available runtime.
- Do not judge missing/confidential PDFs as scraper failures without checking `failed-pdfs.json`.
- Do not interpret `soft_block_abort` exit 1 as a scraper bug — see `docs/retry-policy.md` for detection logic and retry strategy.

## 9. Reviewer Reading Order

1. `README.md`
2. `docs/retry-policy.md`
3. `docs/interview-deliverable.md`
4. `src/config.ts`
5. `src/session/session.ts`
6. `src/session/retry.ts`
7. `src/jsf/searchForm.ts`
8. `src/jsf/pagination.ts`
9. `src/parser/rowParser.ts`
10. `src/scraper/sectorScraper.ts`
11. `src/pdf/downloader.ts`
