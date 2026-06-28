# Interview Deliverable - PJ Peru Scraper

## Decision

This scraper is ready to present as a production-grade extraction prototype: it proves the hard parts of the assignment with real HTTP scraping, JSF/RichFaces session handling, pagination, PDF download, retry/backoff, structured JSONL output, and parallel execution.

It is not yet a fully unattended long-running production service. The remaining production hardening is mostly operational: external job supervision, durable per-partition progress, alerting, and a PDF-only second phase.

## Requirement Matrix

| Challenge requirement | Status | Evidence |
| --- | --- | --- |
| TypeScript from scratch | Complete | `src/**/*.ts`, `npm run build` |
| No browser automation | Complete | Uses `axios` + `cheerio`; no Puppeteer, Playwright, Selenium, or WebDriver |
| Explore and understand site structure | Complete | PJ Peru RichFaces/Mojarra flow documented in `README.md` |
| Navigate all pages | Complete by design | RichFaces paginator implemented in `src/jsf/pagination.ts` and exercised by district/year runners |
| Extract document data | Complete | Normalized JSONL records plus `rawCells` for audit/schema discovery |
| Download associated PDFs | Complete | PJ Peru direct PDF GET via `/ServletDescarga?uuid=...`; OEFA JSF POST fallback also implemented |
| Descriptive PDF names | Complete | Stable filenames from document IDs in `src/utils/fileName.ts` |
| 429 detection | Complete | `src/session/rateLimit.ts` and retry wrappers |
| Exponential/backoff retry | Complete | `src/session/retry.ts` handles retry waits and retry metrics |
| Continue after persistent PDF failure | Complete | PDF failures become `failedDownload` records instead of stopping the whole run |
| Log failed documents for retry | Complete | `failed-pdfs.json` artifact |
| Structured output | Complete | JSONL output plus run summary, page events, and report files |
| README instructions | Complete | `README.md` contains setup, commands, architecture, evidence, and caveats |
| Demonstrate can finish without scraping all day | Complete | Bounded test commands plus partitioned full-run strategy |

The assignment explicitly says it is not necessary to download every document in one execution for delivery. The deliverable should therefore emphasize capability, evidence from bounded runs, and the scalable path to full completion.

## What It Proves

- No browser automation: axios + cheerio only.
- Handles JSF state: cookies, ViewState, form submit, redirect upgrade, RichFaces pagination.
- Extracts normalized JSONL records with raw cells preserved for audit.
- Downloads PDFs and skips existing files idempotently.
- Detects retryable failures and records failed PDF metadata.
- Scales PJ Peru Superior by partitioning the search space into 34 district workers.
- Uses timestamped run folders so reruns do not destroy previous output.
- Avoids duplicate JSONL rows from crashes by keeping a partition in memory and writing once at the end.

## JSONL Optimization

Yes. The inefficient/unsafe output path was changed.

Current behavior:

- Each worker accumulates documents in memory.
- It writes the district/sector JSONL once at the end with `writeFileSync`.
- The parallel runner merges completed partition files into a final `all-*.jsonl`.
- `--fresh-output` is not used by the PJ Peru district runner.

Benefit:

- No partial append duplication after crash/retry.
- No repeated synchronous file write on every page.
- Cleaner artifacts for database import and LLM review.

Tradeoff:

- If a worker dies before completing a partition, its in-memory documents are lost and that partition must be retried.
- This is acceptable for the interview deliverable because partitions are bounded and retryable, but the next production step should use atomic chunk files or page-level durable shards.

## Speed Evidence

Observed and documented speedups:

| Scenario | Before | After | Defensible Claim |
| --- | ---: | ---: | --- |
| OEFA sectors | ~12 min sequential | ~3 min parallel | ~4x by sector parallelism |
| PJ Peru Superior metadata | ~51h serial estimate | ~3h district parallel estimate | up to ~17x wall-clock reduction |
| PJ Peru full strategy | ~666k docs serial bottleneck | Suprema + Superior in parallel | bounded by slowest partition group |
| Suprema metadata (parallel) | serial baseline N/A | 12 workers × ~84 docs/min avg · 43,000+ docs in ~75 min | Empirical — run 2026-06-27 |
| Suprema retry (solo) | 12-worker parallel run | 1 worker × 120 docs/min | 46% faster than parallel mode — Empirical, pool contention eliminated (run 2026-06-27) |

The biggest improvement is architectural, not micro-optimization: partitioning independent searches and running them concurrently.

## Production-Grade Assessment

Production-grade for the assignment:

- Yes, as an extraction engine and demo artifact.
- Yes, for controlled runs with VPN verified first.
- Yes, for restartable partition-level operation.
- Yes, for preserving previous artifacts and PDFs.

Not yet production-grade as a fully autonomous platform:

- No supervisor/queue for failed partitions.
- No durable page-level progress under memory-first output.
- No alerting on VPN loss or soft-block spikes.
- PDF download is still coupled to page scraping unless a PDF-only phase is implemented.

## Recommended Demo

Use a bounded run instead of scraping all day:

```bash
curl -s https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml -o /dev/null -w "%{http_code}\n"
npm run build
npm run scrape:pjperu:districts:dry
npm run scrape:pjperu:districts:test
```

Do not use `--fresh-output`.

## Suprema Scale-Up Path

Suprema has no district partition, so the safe parallelization strategy is to split by disjoint filters such as year:

```bash
npm run scrape:pjperu:suprema:years
```

For a safer first validation:

```bash
npm run scrape:pjperu:suprema:years:test
```

To retry soft-blocked years with no pool contention:

```bash
npm run scrape:pjperu:suprema:years:retry  # soft-blocked years, concurrency 1
```

This keeps workers disjoint and avoids duplicate pages. Start with JSONL-only for speed measurement; add PDFs only after the metadata path is stable.

## JSF Soft-Block Detection

PJ Peru does not emit HTTP 429. Instead it returns empty AJAX partial responses when the ViewState pool saturates. The scraper detects this after 3 consecutive empty pages (`CONSECUTIVE_EMPTY_ABORT = 3`), saves a checkpoint, and exits with code 1.

Empirical evidence from run 2026-06-27:
- 12 parallel workers: 82–89 docs/min per worker; 12 of 20 years soft-blocked over time
- Retry with `--concurrency 1`: 120 docs/min — 46% faster, zero soft-blocks
- Conclusion: the limit is ViewState pool concurrency, not server rate limiting

Full policy documented in `docs/retry-policy.md`.

## Interview Narrative

The main engineering decision was to avoid treating scraping as one giant loop. The scraper models the portal as a stateful JSF API, then partitions the search domain so independent workers can run safely. For PJ Peru Superior, district partitioning converts a multi-day serial scrape into a bounded parallel job. For Suprema, year partitioning gives a comparable path without relying on unsafe page splitting.

The remaining improvement is a two-phase pipeline: first scrape all metadata as JSONL, then download PDFs from those records with a separate downloader. That would remove the PDF latency bottleneck from pagination and make large runs much easier to schedule.
