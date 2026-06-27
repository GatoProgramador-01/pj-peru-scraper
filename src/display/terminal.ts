const W = 66;
const BAR = 26;
const isTTY = Boolean(process.stdout.isTTY);

const hr = (c = '-'): void => { process.stdout.write(c.repeat(W) + '\n'); };

export const runBanner = (
  siteName: string,
  sectorLabel: string | null,
  outputPath: string,
  limit: number | null,
): void => {
  process.stdout.write('\n');
  hr('=');
  process.stdout.write(`  ${siteName}\n`);
  if (sectorLabel) process.stdout.write(`  Sector: ${sectorLabel}\n`);
  process.stdout.write(`  Salida : ${outputPath}\n`);
  if (limit !== null) process.stdout.write(`  Limite : ${limit.toLocaleString()} registros\n`);
  process.stdout.write(`  Inicio : ${new Date().toLocaleString()}\n`);
  hr('=');
  process.stdout.write('\n');
};

export const sectorBanner = (
  idx: number,
  total: number,
  sectorId: string | null,
  sectorName: string | null,
  totalRecords: number | null,
): void => {
  const label = sectorName ?? sectorId ?? 'all';
  process.stdout.write('\n');
  hr('=');
  process.stdout.write(`  SECTOR ${idx} de ${total} -- ${label}`);
  if (totalRecords !== null) process.stdout.write(`  (${totalRecords.toLocaleString()} registros)`);
  process.stdout.write('\n');
  hr('=');
  process.stdout.write('\n');
};

export const phaseStep = (msg: string): void => {
  if (isTTY) {
    process.stdout.write(`  >> ${msg}...`);
  } else {
    process.stdout.write(`  >> ${msg}...\n`);
  }
};

export const phaseOk = (msg: string, detail?: string): void => {
  const suffix = detail ? `  (${detail})` : '';
  if (isTTY) {
    process.stdout.write(`\r  OK ${msg}${suffix}\n`);
  } else {
    process.stdout.write(`  OK ${msg}${suffix}\n`);
  }
};

export const liveProgress = (label: string, done: number, total: number): void => {
  if (!isTTY) return;
  const ratio = total > 0 ? Math.min(done / total, 1) : 0;
  const filled = Math.round(ratio * BAR);
  const barStr = '#'.repeat(filled) + '.'.repeat(BAR - filled);
  const pct = Math.round(ratio * 100);
  process.stdout.write(`\r  ${label} [${barStr}] ${done}/${total} (${pct}%)`.padEnd(82));
};

export const clearProgress = (): void => {
  if (isTTY) process.stdout.write('\r' + ' '.repeat(82) + '\r');
};

export const pageLine = (
  pageNum: number,
  totalPages: number | null | undefined,
  docsThisPage: number,
  totalDocs: number,
  targetDocs: number | null,
  totalRecords: number | null,
  pdfOk: number,
  pdfConf: number,
  pdfFail: number,
  elapsed: string,
  docsPerMin: number | null,
  pagesPerMin: number | null = null,
): void => {
  const totalPagesStr = totalPages != null ? String(totalPages) : '?';
  const pct = totalRecords != null && totalRecords > 0
    ? ` (${((totalDocs / totalRecords) * 100).toFixed(1)}%)`
    : '';
  const remaining = totalRecords != null ? totalRecords - totalDocs : null;
  const remainingPages = totalPages != null ? totalPages - pageNum : null;

  let eta = 'calculando';
  if (docsPerMin != null && remaining != null && docsPerMin > 0) {
    eta = `~${Math.ceil(remaining / docsPerMin)} min`;
  } else if (pagesPerMin != null && remainingPages != null && pagesPerMin > 0) {
    eta = `~${Math.ceil(remainingPages / pagesPerMin)} min (est. por paginas)`;
  }

  const pdfParts = [
    `${pdfOk} descargados`,
    pdfConf > 0 ? `${pdfConf} confidenciales` : null,
    pdfFail > 0 ? `${pdfFail} fallidos` : null,
  ].filter(Boolean).join(' | ');

  const velocidad = docsPerMin != null
    ? `${docsPerMin} docs/min${pagesPerMin != null ? ` | ${pagesPerMin} pag/min` : ''}`
    : 'calculando';

  process.stdout.write('\n');
  hr();
  process.stdout.write(`  Pagina ${pageNum} de ${totalPagesStr}   |   Tiempo: ${elapsed}\n`);
  hr();
  process.stdout.write(`  + Documentos esta pagina  : ${docsThisPage}\n`);
  process.stdout.write(`    Total acumulado         : ${totalDocs}${targetDocs != null ? ` / ${targetDocs}` : ''}${pct}\n`);
  process.stdout.write(`    PDFs                    : ${pdfParts}\n`);
  process.stdout.write(`    Velocidad               : ${velocidad}\n`);
  process.stdout.write(`    ETA                     : ${eta} restantes\n`);
  hr();
};

export const runSummary = (
  rows: Array<[string, string | number]>,
  footer?: string,
): void => {
  process.stdout.write('\n');
  hr('=');
  process.stdout.write('  EXTRACCION COMPLETA\n');
  hr('=');
  for (const [k, v] of rows) {
    const label = `  ${k}`;
    const val = String(v);
    const dots = Math.max(1, W - label.length - val.length - 2);
    process.stdout.write(label + '.'.repeat(dots) + val + '\n');
  }
  if (footer) {
    hr('-');
    process.stdout.write(`  ${footer}\n`);
  }
  hr('=');
  process.stdout.write('\n');
};
