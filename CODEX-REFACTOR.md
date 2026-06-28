# Refactor Total — Arquitectura Catedral

**Rama:** `main` (HEAD: 56d8509)  
**Tests actuales:** 53/53 pasando, 0 errores tsc  
**Regla absoluta:** después de cada archivo tocado → `npx tsc --noEmit` + `npm test` deben pasar 53/53.

---

## El objetivo

Leer cualquier archivo de `src/` debe ser leer una historia. Las definiciones de tipos no son
historia — son vocabulario. El vocabulario va en diccionarios (`models/`). La lógica va en capas.

**Un archivo = una responsabilidad. Sin tipos perdidos en archivos de lógica.**

---

## Paso 1 — Crear `src/models/scraperTypes.ts`

Mover desde `src/scraper/sectorScraper.ts`:
- `export interface SectorResult`
- `export interface SectorContext`
- `interface PageMetrics` → cambiar a `export interface PageMetrics`
- `interface AdvancePageCtx` → cambiar a `export interface AdvancePageCtx`

El archivo nuevo debe importar solo lo necesario:
```typescript
import type { PageEvent, PdfFailure, RunMetrics } from './metrics.js';
import type { ParsedPage, Session } from './internalTypes.js';
import type { JudicialDocument } from '../types.js';
```

Luego en `sectorScraper.ts`: reemplazar las definiciones con imports desde `../models/scraperTypes.js`.

---

## Paso 2 — Crear `src/models/pdfTypes.ts`

Mover desde `src/scraper/pdfBatch.ts`:
- `export interface PagePdfStats`
- `export interface PdfBatchInput`
- `export interface PdfBatchOptions`
- `type PdfCandidate` → cambiar a `export type PdfCandidate`

El archivo nuevo debe importar:
```typescript
import type { ParsedRow, Session } from './internalTypes.js';
import type { PdfFailure, RunMetrics } from './metrics.js';
import type { JudicialDocument } from '../types.js';
```

Luego en `pdfBatch.ts`: reemplazar definiciones con imports desde `../models/pdfTypes.js`.

También mover desde `src/pdf/downloader.ts`:
- `export interface PdfDownloadConfig`
- `export interface JsfPdfTarget`

Agregarlas a `pdfTypes.ts`. Actualizar imports en `downloader.ts`.

---

## Paso 3 — Crear `src/models/jsfTypes.ts`

Mover desde `src/jsf/pagination.ts`:
- `export interface PaginationRequest`

Crear `src/models/jsfTypes.ts` con este interface. Actualizar imports en `pagination.ts`.

Si en `searchForm.ts` o `partialResponse.ts` hay interfaces locales, moverlas aquí también.
Verificar con: `grep -n "^interface\|^export interface" src/jsf/*.ts`

---

## Paso 4 — Centralizar constantes en `src/config/constants.ts`

`src/config/constants.ts` ya existe con `ROWS_PER_PAGE`. Agregar:

```typescript
// HTTP session
export const MAX_SOCKETS = 64;
export const SESSION_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 5;
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Retry
export const MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_AFTER_MS = 60_000;

// Scraper behavior
export const CONSECUTIVE_EMPTY_ABORT = 3;

// PDF validation
export const PDF_MAGIC = '%PDF';
```

Luego actualizar los archivos que usan estas constantes:
- `src/session/session.ts` → importar `MAX_SOCKETS, SESSION_TIMEOUT_MS, MAX_REDIRECTS, DEFAULT_USER_AGENT`
- `src/session/retry.ts` → importar `MAX_RETRY_ATTEMPTS`
- `src/session/rateLimit.ts` → importar `DEFAULT_RETRY_AFTER_MS`; `RATE_LIMIT_SIGNALS` puede quedarse local (no es una constante de configuración, es lógica de detección)
- `src/scraper/sectorScraper.ts` → importar `CONSECUTIVE_EMPTY_ABORT` (ya no define la const local)
- `src/pdf/downloader.ts` → importar `PDF_MAGIC`

---

## Paso 5 — Limpiar `src/scraper/sectorScraper.ts`

Después de los pasos 1 y 4, `sectorScraper.ts` debe quedar así:

```
imports (todos al tope, sin excepción)
  ↓
// ─── Pagination helpers ───
resolveHasNextPage
buildNextPage
advancePage
  ↓
// ─── Pure helpers ───
elapsedSince
hasReachedDocLimit
isSoftBlock
shouldDownloadPdfs
richFacesMissingNextButton
paginatorHidTotalPages
calcPageMetrics
  ↓
// ─── Main scraper ───
export const scrapeSector
```

Sin ninguna definición de interface o type. Solo imports y funciones.

---

## Paso 6 — Limpiar `src/scraper/pdfBatch.ts`

Después del paso 2, `pdfBatch.ts` debe quedar:

```
imports (incluyendo los tipos desde ../models/pdfTypes.js)
  ↓
// ─── Helpers ───
emptyPdfStats
isConfidentialDocument
recordPdfResult
updatePagePdfStats
resolveNoPdfSource
buildCandidates
downloadCandidate
  ↓
// ─── Main batch function ───
export const downloadPagePdfs
```

Sin ninguna definición de interface o type.

---

## Paso 7 — Verificar `src/models/` como fuente de verdad

Al terminar, `src/models/` debe contener:
```
models/
  internalTypes.ts   — Session, ParsedPage, ParsedRow, $Root
  metrics.ts         — RunMetrics, PdfFailure, PageEvent, PdfDownloadResult
  scraperTypes.ts    — SectorResult, SectorContext, PageMetrics, AdvancePageCtx  ← NUEVO
  pdfTypes.ts        — PagePdfStats, PdfBatchInput, PdfBatchOptions, PdfCandidate,
                        PdfDownloadConfig, JsfPdfTarget                           ← NUEVO
  jsfTypes.ts        — PaginationRequest (+ cualquier otro tipo JSF)              ← NUEVO
```

Y `src/types.ts` sigue siendo el contrato público: `JudicialDocument`, `SiteConfig`, `ScrapeOptions`.

---

## Paso 8 — Actualizar README sección `## Mapa de Lectura del Codigo`

Actualizar la tabla de **Capa 1 — Contratos** para incluir los tres archivos nuevos:

```markdown
| `src/models/scraperTypes.ts` | `SectorResult`, `SectorContext`, `PageMetrics`, `AdvancePageCtx` |
| `src/models/pdfTypes.ts`     | `PagePdfStats`, `PdfBatchInput`, `PdfCandidate`, `PdfDownloadConfig` |
| `src/models/jsfTypes.ts`     | `PaginationRequest` y tipos JSF |
```

Y en **Capa 7** agregar:
```markdown
| `src/config/constants.ts` | Todas las constantes numéricas y strings del sistema |
```

---

## Verificación final

```bash
npx tsc --noEmit     # debe dar 0 errores
npm test             # debe dar 53/53
npm run build        # debe compilar sin warnings
```

Luego commitear con mensaje:
```
refactor: cathedral architecture — types to models/, constants to config/

- models/scraperTypes.ts: SectorResult, SectorContext, PageMetrics, AdvancePageCtx
- models/pdfTypes.ts: PagePdfStats, PdfBatchInput, PdfBatchOptions, PdfCandidate,
  PdfDownloadConfig, JsfPdfTarget
- models/jsfTypes.ts: PaginationRequest
- config/constants.ts: MAX_SOCKETS, SESSION_TIMEOUT_MS, MAX_RETRY_ATTEMPTS,
  DEFAULT_RETRY_AFTER_MS, CONSECUTIVE_EMPTY_ABORT, PDF_MAGIC
- sectorScraper.ts, pdfBatch.ts, downloader.ts, session.ts, retry.ts,
  rateLimit.ts, pagination.ts: replace local definitions with imports
- README: update Mapa de Lectura with new model files
```

---

## Lo que NO tocar

- Tests en `tests/` — no modificar ningún test
- `scripts/*.mjs` — no tocar
- `src/types.ts` — es el contrato público, no mover nada de aquí
- Lógica de ninguna función — solo mover tipos y constantes
