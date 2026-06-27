const W = 62; // inner box width (chars between │ characters)
const BAR = 20; // progress bar character width

const isTTY = Boolean(process.stdout.isTTY);

// ── Box primitives ───────────────────────────────────────────────

const boxTop = (): void => { process.stdout.write(`\n┌${'─'.repeat(W)}┐\n`); };
const boxDiv = (): void => { process.stdout.write(`├${'─'.repeat(W)}┤\n`); };
const boxBot = (): void => { process.stdout.write(`└${'─'.repeat(W)}┘\n`); };
const boxLine = (s: string): void => {
  const content = s.length > W - 2 ? s.slice(0, W - 5) + '...' : s;
  process.stdout.write(`│  ${content.padEnd(W - 2)}│\n`);
};

// ── Public API ───────────────────────────────────────────────────

export const runBanner = (
  siteName: string,
  sectorLabel: string | null,
  outputPath: string,
  limit: number | null,
): void => {
  boxTop();
  boxLine(siteName);
  if (sectorLabel) boxLine(`Sector filter: ${sectorLabel}`);
  boxLine(`Output: ${outputPath}`);
  if (limit !== null) boxLine(`Limit: ${limit.toLocaleString()} records`);
  boxLine(new Date().toLocaleString());
  boxBot();
};

export const sectorBanner = (
  idx: number,
  total: number,
  sectorId: string | null,
  sectorName: string | null,
  totalRecords: number | null,
): void => {
  const label = sectorName ?? sectorId ?? 'all';
  boxTop();
  boxLine(`Sector ${idx}/${total}  ·  ${label}`);
  if (totalRecords !== null) boxLine(`${totalRecords.toLocaleString()} records expected`);
  boxBot();
};

export const phaseStep = (msg: string): void => {
  if (isTTY) {
    process.stdout.write(`  ▷ ${msg} ...`);
  } else {
    process.stdout.write(`  ▷ ${msg} ...\n`);
  }
};

export const phaseOk = (msg: string, detail?: string): void => {
  const suffix = detail ? `  (${detail})` : '';
  if (isTTY) {
    process.stdout.write(`\r  ✓ ${msg}${suffix}\n`);
  } else {
    process.stdout.write(`  ✓ ${msg}${suffix}\n`);
  }
};

export const liveProgress = (label: string, done: number, total: number): void => {
  if (!isTTY) return;
  const ratio = total > 0 ? Math.min(done / total, 1) : 0;
  const filled = Math.round(ratio * BAR);
  const barStr = '█'.repeat(filled) + '░'.repeat(BAR - filled);
  process.stdout.write(`\r  ${label} [${barStr}] ${done}/${total}`.padEnd(80));
};

export const clearProgress = (): void => {
  if (isTTY) process.stdout.write('\r' + ' '.repeat(80) + '\r');
};

export const pageLine = (
  pageNum: number,
  totalPages: number | null | undefined,
  docsThisPage: number,
  totalDocs: number,
  targetDocs: number | null,
  pdfOk: number,
  pdfConf: number,
  pdfFail: number,
  elapsed: string,
): void => {
  const totalPagesStr = totalPages != null ? String(totalPages) : '---';
  const pageNumStr = String(pageNum).padStart(totalPagesStr.length);
  const pgLabel = `${pageNumStr}/${totalPagesStr}`;
  const docLabel = targetDocs != null ? `${totalDocs}/${targetDocs}` : String(totalDocs);
  const pdfParts: string[] = [`${pdfOk}✓`];
  if (pdfConf > 0) pdfParts.push(`${pdfConf} conf`);
  if (pdfFail > 0) pdfParts.push(`${pdfFail} fail`);
  process.stdout.write(
    `  [${pgLabel}]  +${docsThisPage}  total ${docLabel} docs  ·  pdf ${pdfParts.join(' ')}  ·  ${elapsed}\n`,
  );
};

export const runSummary = (
  rows: Array<[string, string | number]>,
  footer?: string,
): void => {
  process.stdout.write('\n');
  boxTop();
  boxLine('RUN COMPLETE');
  boxDiv();
  for (const [k, v] of rows) {
    const keyPad = k.padEnd(32);
    const val = String(v);
    boxLine(`${keyPad}${val}`);
  }
  if (footer) {
    boxDiv();
    boxLine(footer);
  }
  boxBot();
  process.stdout.write('\n');
};
