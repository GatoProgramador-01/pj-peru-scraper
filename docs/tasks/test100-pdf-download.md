# Test 100 PDF Download Run

## Purpose

This task validates a controlled OEFA scrape that collects 100 records and attempts the corresponding PDF downloads. It is a baseline observability run, not a 429 stress test or a full concurrency redesign.

## Recommended Configuration

Run:

```bash
npm run scrape:oefa:test100
```

The script uses:

- `--site oefa`
- `--limit 100`
- `--pdfs`
- `--out output/test100/oefa-documents.jsonl`
- `--pdf-dir output/test100/pdfs`
- `--pdf-concurrency 4`
- `--fresh-output`

Direct PDF URL downloads may run concurrently. JSF action POST downloads remain sequential because they reuse the current page ViewState and mutate session cookies.

## Metrics To Watch

The final log line named `Run metrics` should include:

- `totalDocumentsCollected`: expected to be 100 when enough records are available.
- `totalPdfCandidates`: records with a direct PDF URL or JSF action.
- `totalPdfDownloaded`: PDFs downloaded during this run.
- `totalPdfFailed`: PDF attempts that returned errors or invalid content.
- `totalPdfMissing`: records without a usable direct URL or JSF action.
- `totalSkippedExisting`: PDFs already present on disk.
- `total429`: HTTP 429 responses observed by retry handling.
- `totalRetries`: total retry attempts.
- `elapsedTime`, `docsPerMinute`, `pdfsPerMinute`, `avgPdfLatencyMs`.

## Success Criteria

- The command completes without crashing.
- `output/test100/oefa-documents.jsonl` contains 100 records when 100 OEFA results are available.
- Successful or already-existing PDFs have `pdfLocalPath` set in JSONL.
- Missing or failed PDFs are written to `output/test100/failed-pdfs.json`.
- A PDF failure does not stop the scrape.
- Final metrics are present in logs.

## Retrying Failures

Rerun:

```bash
npm run scrape:oefa:test100
```

Existing PDFs will be counted as `skippedExisting`. The JSONL and failed report are refreshed because the script passes `--fresh-output`; the PDF folder is kept so completed downloads do not need to be fetched again.

To force a fully fresh PDF download set, remove `output/test100/pdfs/` before rerunning.

## Changing PDF Concurrency

Default behavior is conservative:

```bash
PDF_CONCURRENCY=1 node dist/cli.js --site oefa --limit 100 --pdfs
```

For the controlled test, use:

```bash
node dist/cli.js --site oefa --limit 100 --pdfs \
  --pdf-dir output/test100/pdfs \
  --out output/test100/oefa-documents.jsonl \
  --pdf-concurrency 4 \
  --fresh-output
```

Only direct PDF URL downloads use this concurrency. JSF action PDFs are intentionally sequential.

## Controlled 429 Probe

Run this separately from the PDF baseline:

```bash
npm run probe:oefa:429
```

Default budget:

- `PROBE_429_TOTAL=500`
- `PROBE_429_CONCURRENCY=20`
- `PROBE_429_STOP_ON_FIRST=true`
- `PROBE_429_OUT=output/test429/probe429.json`

PowerShell example for a stronger probe:

```powershell
$env:PROBE_429_TOTAL='1500'
$env:PROBE_429_CONCURRENCY='40'
npm run probe:oefa:429
```

The probe writes status counts, total 429s, first 429 request number, and `Retry-After` values when present. It exits with code `2` if no 429 is reached inside the configured budget.

## Small PDFs

Small PDFs are valid evidence and should not be discarded by size. The downloader saves direct PDF responses as returned. For JSF action POSTs, the only content guard is the PDF magic header (`%PDF`); this avoids saving XML/HTML error responses as PDF while allowing tiny PDFs.

## Review Artifacts

Every non-dry run writes these files beside the JSONL output:

- `run-summary.json`: overall metrics and interpretation.
- `page-events.jsonl`: page-by-page progress events.
- `run-report.md`: human-readable report.

For OEFA, confidential rows are represented as `status: "confidential"` in `failed-pdfs.json`. They are expected unavailable PDFs and should not be counted as downloader failures.
