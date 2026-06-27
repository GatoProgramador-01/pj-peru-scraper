# Human Test Plan

This plan is for a reviewer cloning the repository into a clean folder and verifying the scraper without running a full multi-hour extraction.

## 1. Clone And Install

```bash
git clone <PUBLIC_REPO_URL>
cd pj-peru-scraper
npm install
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

Suprema has no district filter, so it is partitioned by year.

```bash
npm run scrape:pjperu:suprema:years:test
```

Expected:

- Separate year workers run disjoint searches.
- Output writes to `output/runs/suprema-years-*/`.
- Completed years merge into `all-suprema-years.jsonl`.

## 8. What Not To Do

- Do not use `--fresh-output` for PJ Peru runs.
- Do not delete `output/pdfs/` or any previous PDF store during validation.
- Do not launch full PJ Peru extraction without confirming VPN and available runtime.
- Do not judge missing/confidential PDFs as scraper failures without checking `failed-pdfs.json`.

## 9. Reviewer Reading Order

1. `README.md`
2. `docs/interview-deliverable.md`
3. `src/config.ts`
4. `src/session/session.ts`
5. `src/session/retry.ts`
6. `src/jsf/searchForm.ts`
7. `src/jsf/pagination.ts`
8. `src/parser/rowParser.ts`
9. `src/scraper/sectorScraper.ts`
10. `src/pdf/downloader.ts`
