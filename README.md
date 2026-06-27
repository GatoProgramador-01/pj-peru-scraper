# pj-peru-scraper

**Scraper TypeScript para portales judiciales y ambientales del Perú.**  
Extrae resoluciones del Tribunal de Fiscalización Ambiental (OEFA) y jurisprudencia del Poder Judicial (PJ Perú). Sin browser automation en el flujo principal — HTTP puro con manejo de ViewState JSF/PrimeFaces.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org/)
[![Licencia](https://img.shields.io/badge/licencia-MIT-yellow)](LICENSE)

---

## Tabla de Contenidos

1. [Descripción del Proyecto](#1-descripción-del-proyecto)
2. [Arquitectura General](#2-arquitectura-general)
3. [Requisitos del Sistema](#3-requisitos-del-sistema)
4. [Instalación](#4-instalación)
5. [Uso por Línea de Comandos](#5-uso-por-línea-de-comandos)
6. [Flujo de Scraping](#6-flujo-de-scraping)
7. [Configuración de Sitios](#7-configuración-de-sitios)
8. [Manejo de Errores y Rate Limiting](#8-manejo-de-errores-y-rate-limiting)
9. [Descarga de PDFs](#9-descarga-de-pdfs)
10. [Formato de Salida JSONL](#10-formato-de-salida-jsonl)
11. [Sistema de Checkpoints](#11-sistema-de-checkpoints)
12. [Iteración por Sectores (OEFA)](#12-iteración-por-sectores-oefa)
13. [Herramientas de Desarrollo](#13-herramientas-de-desarrollo)
14. [Uso con Proxy / VPN](#14-uso-con-proxy--vpn)
15. [Sitios Soportados](#15-sitios-soportados)
16. [Historial de Sprints](#16-historial-de-sprints)

---

## 1. Descripción del Proyecto

Este proyecto nació como desafío técnico de scraping: extraer todas las resoluciones del Repositorio Digital de OEFA y la jurisprudencia del Poder Judicial del Perú, ambos portales construidos con JSF/PrimeFaces.

**Problema:** Ambos sitios no exponen API pública. Los datos viven detrás de un formulario de búsqueda con estado JSF (`javax.faces.ViewState`) y paginación AJAX de PrimeFaces.

**Solución:** Scraper HTTP puro que:
- Replica el handshake JSF extrayendo el ViewState del HTML inicial
- Envía el formulario de búsqueda como POST (incluyendo filtro de sector)
- Navega las páginas replicando las peticiones AJAX de PrimeFaces
- Descarga los PDFs adjuntos con reintentos
- Maneja errores 429 respetando el header `Retry-After`

---

## 2. Arquitectura General

```mermaid
graph TD
    CLI["CLI (cli.ts)"]
    HTTP["HTTP Scraper (http-scraper.ts)"]
    BROWSER["Browser Scraper (scraper.ts)\n— dev fallback —"]
    CONFIG["Site Config (config.ts)"]
    LOGGER["Logger (logger.ts)"]
    OEFA["publico.oefa.gob.pe\nTribunal de Fiscalización Ambiental"]
    PJPERU["jurisprudencia.pj.gob.pe\nPoder Judicial del Perú"]
    OUT["output/results.jsonl"]
    PDFS["pdfs/*.pdf"]
    CP["output/checkpoint_*.json"]

    CLI -->|"--mode http"| HTTP
    CLI -->|"--mode browser"| BROWSER
    HTTP --> CONFIG
    BROWSER --> CONFIG
    HTTP --> LOGGER
    HTTP -->|GET + POST JSF| OEFA
    HTTP -->|GET + POST JSF| PJPERU
    HTTP --> OUT
    HTTP --> PDFS
    HTTP --> CP
```

**Decisiones de diseño clave:**

| Decisión | Alternativa | Motivo |
|----------|------------|--------|
| HTTP puro (axios + cheerio) como flujo principal | Browser automation siempre | 10× más rápido, sin overhead de Chromium, suficiente para sitios JSF sin JS-challenge |
| ViewState replay manual | Sesión de browser | JSF stateful: basta reproducir el ViewState en cada POST |
| POST full-page para el formulario de búsqueda OEFA | PrimeFaces AJAX | El botón Buscar usa `ajax=false` — responde con HTML completo |
| JSONL append-safe | JSON array | Crash-resumable: no requiere re-parsear el archivo completo |
| discoverSectors() en runtime | IDs hardcodeados | IDs de sector pueden cambiar; la <select> del portal es la fuente de verdad |
| Puppeteer en devDependencies | En producción | Solo necesario para recon.ts y browser fallback — no parte del scraper HTTP |

---

## 3. Requisitos del Sistema

- Node.js ≥ 20
- npm ≥ 10
- (Opcional) Chromium instalado para modo browser/recon
- (Solo PJ Perú) VPN con IP peruana

---

## 4. Instalación

```bash
git clone https://github.com/GatoProgramador-01/pj-peru-scraper.git
cd pj-peru-scraper
npm install
npm run build
```

---

## 5. Uso por Línea de Comandos

```bash
# Ver sectores disponibles en OEFA (sin scrapear)
node dist/cli.js --site oefa --discover-sectors

# Dry-run OEFA — todos los sectores, sin escribir archivos
node dist/cli.js --site oefa --dry-run

# Dry-run limitado a 50 registros
node dist/cli.js --site oefa --dry-run --limit 50

# Scrape completo OEFA — todos los sectores, con descarga de PDFs
node dist/cli.js --site oefa --out output/oefa.jsonl --pdfs

# Scrape solo sector MINERIA (id=1)
node dist/cli.js --site oefa --sector 1 --out output/oefa_mineria.jsonl

# Reanudar desde el último checkpoint
node dist/cli.js --site oefa --out output/oefa.jsonl --resume

# Con proxy (para PJ Perú con VPN)
node dist/cli.js --site pj-peru --proxy http://user:pass@proxy-pe:3128 --out output/pj.jsonl --pdfs

# Recon (descubrimiento de selectores) — requiere Puppeteer
node dist/recon.js --site oefa
```

**Opciones disponibles:**

| Opción | Tipo | Default | Descripción |
|--------|------|---------|-------------|
| `--site` | string | `oefa` | Portal a scrapear: `oefa` \| `pj-peru` |
| `--mode` | string | `http` | Motor: `http` \| `browser` \| `recon` |
| `--sector` | string | (todos) | ID de sector específico (ej: `1` = MINERIA) |
| `--discover-sectors` | flag | false | Imprime sectores disponibles y sale |
| `--out` | string | `output/results.jsonl` | Archivo de salida |
| `--pdfs` | flag | false | Descargar PDFs a `./pdfs/` |
| `--limit` | number | (sin límite) | Máximo de registros a extraer |
| `--proxy` | string | — | URL de proxy `http://[user:pass@]host:port` |
| `--dry-run` | flag | false | Log sin escribir archivos |
| `--resume` | flag | false | Reanudar desde checkpoint |
| `--headed` | flag | false | [browser] Mostrar ventana de Chrome |

---

## 6. Flujo de Scraping

```mermaid
flowchart TD
    A([Inicio]) --> B[GET página inicial\nEstablece sesión + cookies]
    B --> C[Extraer javax.faces.ViewState]
    C --> D{¿Sitio tiene\nbuscador?}
    D -->|Sí| E[POST formulario de búsqueda\nViewState + filtro de sector]
    D -->|No| F[Parsear tabla directa]
    E --> F
    F --> G{¿Rows > 0?}
    G -->|No — 0 resultados| H([Sector vacío — saltar])
    G -->|Sí| I[Extraer documentos de la página\nrowToDocument]
    I --> J{¿PDF disponible?}
    J -->|Sí| K[Descargar PDF\ncon reintento]
    J -->|No| L[pdfUrl = null]
    K --> M[Guardar en JSONL]
    L --> M
    M --> N[Guardar checkpoint]
    N --> O{¿Siguiente página?}
    O -->|Sí| P[POST paginator\nPrimeFaces AJAX]
    P -->|Éxito| I
    P -->|429| Q[Leer Retry-After\nEsperar y reintentar]
    Q --> P
    O -->|No| R{¿Más sectores?}
    R -->|Sí| S[Pausa 5-10s\nNueva sesión]
    S --> B
    R -->|No| T[Validar salida\nconteo + schema + IDs únicos]
    T --> U([Fin])
```

---

## 7. Configuración de Sitios

Los sitios se configuran en `src/config.ts`. Cada sitio define:

- **`startUrl`** — URL de entrada
- **`selectors`** — selectores CSS para filas, PDF links, paginador
- **`columns`** — índices de columna a campo del documento (base 0)
- **`timing`** — delays entre páginas, PDFs y reintentos
- **`search`** — configuración del formulario de búsqueda (si aplica)
  - `sectorField` — nombre del campo `<select>` de sector
  - `sectors` — fallback de IDs conocidos (se sobreescribe con `discoverSectors()`)

Para agregar un nuevo sitio, copiar la entrada de `oefa` y ajustar selectores con `recon.ts`.

---

## 8. Manejo de Errores y Rate Limiting

El scraper maneja tres tipos de señales de rate limiting:

1. **HTTP 429** (Too Many Requests): detectado por código de estado en la respuesta axios. Lee el header `Retry-After` y espera el tiempo indicado (en segundos o formato HTTP-date). Si no hay header, espera 60 segundos.

2. **Texto de error en HTML**: detectado por `isRateLimited()` que busca frases como `"demasiadas solicitudes"`, `"access denied"`, `"por favor espere"`.

3. **Fallos de red**: timeout, conexión rechazada — manejados por `withRetry()` con esperas configuradas en `timing.retryWaitMs`.

**Política de reintentos:**
```
Intento 1: esperar timing.retryWaitMs[0]
Intento 2: esperar timing.retryWaitMs[1]
Intento 3: esperar timing.retryWaitMs[2]  ← si falla aquí, propaga error
```

En caso de 429, el tiempo de espera es `max(Retry-After, retryWaitMs[i])`.

---

## 9. Descarga de PDFs

Los PDFs se descargan con `--pdfs` activado. El flujo:

1. Si `pdfUrl` no es nulo, se descarga via `GET` con la misma sesión HTTP (cookies incluidas)
2. Si el archivo ya existe localmente, se omite (idempotente)
3. Si el buffer es menor a 500 bytes, se descarta (respuesta de error disfrazada)
4. Los errores de descarga individuales se loguean pero no detienen el scrape principal

**Nota OEFA:** Muchos registros muestran `"Información confidencial"` en la columna de archivo — estos no tienen URL de PDF y `pdfUrl` queda en `null`.

---

## 10. Formato de Salida JSONL

Cada línea del archivo de salida es un JSON con este schema:

```json
{
  "id": "oefa_S1_3211-2018-OEFA_DFAI_PAS_INFORMACI_N_CONFIDENCIAL",
  "site": "oefa",
  "sector": "MINERIA",
  "caseNumber": "3211-2018-OEFA/DFAI/PAS",
  "court": "Coricancha",
  "date": "Información confidencial",
  "summary": "Great Panther Coricancha S.A.",
  "resolution": "Información confidencial",
  "pdfUrl": null,
  "pdfLocalPath": null,
  "pageIndex": 0,
  "rowIndex": 0,
  "fetchedAt": "2026-06-26T17:03:04.000Z",
  "rawCells": ["1", "3211-2018-OEFA/DFAI/PAS", "...", "Minería", "...", "..."]
}
```

El campo `rawCells` preserva todas las celdas originales para re-procesamiento si los índices de columna cambian.

---

## 11. Sistema de Checkpoints

Cada sector guarda su progreso en `output/checkpoint_{site}_s{sectorId}.json`:

```json
{
  "site": "oefa",
  "sectorId": "1",
  "lastPageIndex": 42,
  "totalScraped": 420,
  "completed": false,
  "updatedAt": "2026-06-26T17:30:00.000Z"
}
```

Con `--resume`, el scraper salta los sectores marcados `completed: true` y retoma el resto desde `lastPageIndex`. Sin `--resume`, siempre empieza desde cero.

---

## 12. Iteración por Sectores (OEFA)

OEFA organiza sus resoluciones en 5 sectores. El portal requiere seleccionar uno para que la tabla muestre resultados (búsqueda sin sector devuelve 0 filas).

El scraper:
1. Llama a `discoverSectors()` — hace un GET a la página y parsea el `<select>` de sector
2. Itera cada sector con una sesión HTTP independiente
3. Escribe todos los resultados al mismo archivo JSONL (campo `sector` diferencia el origen)
4. Pausa 5–10 segundos entre sectores

Sectores descubiertos dinámicamente (no hardcodeados):
| ID | Sector |
|----|--------|
| 1 | MINERIA |
| 2 | ELECTRICIDAD |
| 3 | HIDROCARBUROS |
| 8 | PESQUERIA |
| 9 | INDUSTRIA |

---

## 13. Herramientas de Desarrollo

Estas herramientas son parte de `devDependencies` (Puppeteer) y se usan durante el desarrollo, no en producción:

### `recon.ts` — Descubrimiento de selectores
Abre el portal en un browser headed y vuelca:
- Todas las tablas con headers y filas de muestra
- Elementos de paginación
- Links candidatos a PDF
- Inputs ocultos (ViewState, etc.)
- URLs de acción de formularios

```bash
node dist/recon.js --site oefa
# Salida: output/recon_oefa.json
```

Usar después de que el sitio cambie su estructura, antes de actualizar `config.ts`.

### `scraper.ts` — Browser fallback
Mismo flujo que el HTTP scraper pero ejecutando las llamadas API dentro del browser via `page.evaluate()`. Usar cuando:
- El sitio tiene un JS-challenge (F5 BIG-IP, Cloudflare) que bloquea requests HTTP directos
- El TLS fingerprinting del servidor detecta clients no-browser

```bash
node dist/cli.js --mode browser --site oefa --headed --limit 50
```

---

## 14. Uso con Proxy / VPN

El scraper soporta proxies HTTP/HTTPS via `--proxy`:

```bash
node dist/cli.js --site pj-peru \
  --proxy http://usuario:contraseña@proxy-peru.example.com:3128 \
  --out output/pj.jsonl --pdfs
```

**Recomendaciones para VPN:**
- Usar sesión sticky (mismo IP durante todo un sector) — no rotar a mitad de paginación
- Rotar IP entre sectores para distribuir la carga
- PJ Perú requiere IP peruana; OEFA es accesible sin VPN

---

## 15. Sitios Soportados

| Sitio | URL | VPN Requerida | Sectores | Estado |
|-------|-----|--------------|----------|--------|
| OEFA TFA | `publico.oefa.gob.pe/repdig/...` | No | 5 (auto-descubiertos) | ✅ Producción |
| PJ Perú | `jurisprudencia.pj.gob.pe/...` | Sí (IP peruana) | — | 🔧 Pendiente recon con VPN |

---

## 16. Historial de Sprints

<details>
<summary><strong>Sprint 1 — v0.1.0 · Setup y validación OEFA (2026-06-26)</strong></summary>

**Objetivo:** Tener el scraper HTTP funcionando contra OEFA sin VPN, todos los sectores, PDFs y 429 handling.

**Completado:**
- [x] Arquitectura HTTP-first con axios + cheerio + TypeScript
- [x] ViewState replay y manejo de formulario JSF/PrimeFaces
- [x] `discoverSectors()` — lee sectores del portal en runtime (no hardcodeados)
- [x] Iteración por los 5 sectores OEFA con sesión independiente por sector
- [x] Manejo de HTTP 429 con respeto de header `Retry-After`
- [x] Descarga de PDFs con validación de tamaño
- [x] Sistema de checkpoints por sector (crash-resumable)
- [x] Limpieza de dependencias: removidos `axios-cookiejar-support` y `tough-cookie` (no usados); `puppeteer*` movido a devDependencies
- [x] Dry-run validado: 5 sectores × 10 rows = 100 registros sin errores
- [x] Repositorio público en GitHub

**Descubrimiento clave:** PESQUERIA tiene ID=8 en el portal (no 4) — `discoverSectors()` lo detectó correctamente desde la `<select>` del HTML.

**Próximo sprint:**
- Correr scrape completo OEFA (todos los sectores, sin `--limit`)
- Validación humana de los datos extraídos
- Test con proxy VPN para PJ Perú

</details>

---

*Proyecto desarrollado como desafío técnico de scraping para portales judiciales y ambientales del Perú.*

## Test run: 100 records + PDFs

Use this controlled run to collect 100 OEFA records, attempt the matching PDF downloads, and log baseline metrics without running a larger stress test.

```bash
npm run scrape:oefa:test100
```

The command builds the project and runs:

```bash
node dist/cli.js --site oefa --limit 100 --pdfs \
  --pdf-dir output/test100/pdfs \
  --out output/test100/oefa-documents.jsonl \
  --pdf-concurrency 4 \
  --fresh-output
```

Outputs:
- `output/test100/oefa-documents.jsonl`: the 100 JSONL records when 100 results are available.
- `output/test100/pdfs/`: downloaded PDFs for those records.
- `output/test100/failed-pdfs.json`: non-downloaded PDF records, including `missingPdfUrl`, `missingJsfAction`, or `failedDownload`.

Metrics are logged at the end of the run:
- `totalDocumentsCollected`
- `totalPdfCandidates`
- `totalPdfDownloaded`
- `totalPdfFailed`
- `totalPdfMissing`
- `totalPdfConfidential`
- `totalSkippedExisting`
- `total429`
- `totalRetries`
- `elapsedTime`
- `docsPerMinute`
- `pdfsPerMinute`
- `avgPdfLatencyMs`

`pdfLocalPath` is written to the JSONL only after each page's PDF attempts finish, so successful or already-existing PDFs appear in the final record. JSF action PDF downloads stay sequential because they reuse the page ViewState and session cookies. `PDF_CONCURRENCY` / `--pdf-concurrency` only applies to direct PDF URLs.

To retry failed PDFs, rerun the same command. Existing PDFs are reported as `skippedExisting`, and failed or missing records are regenerated in `failed-pdfs.json`. To test a different concurrency level:

```bash
node dist/cli.js --site oefa --limit 100 --pdfs \
  --pdf-dir output/test100/pdfs \
  --out output/test100/oefa-documents.jsonl \
  --pdf-concurrency 1 \
  --fresh-output
```

### Controlled 429 probe

To intentionally look for HTTP 429 behavior without mixing it into the 100-record PDF run:

```bash
npm run probe:oefa:429
```

Defaults:
- `PROBE_429_TOTAL=500`
- `PROBE_429_CONCURRENCY=20`
- `PROBE_429_STOP_ON_FIRST=true`
- output: `output/test429/probe429.json`

Example with a larger probe:

```powershell
$env:PROBE_429_TOTAL='1500'; $env:PROBE_429_CONCURRENCY='40'; npm run probe:oefa:429
```

The probe exits with code `2` if no 429 was observed inside the configured request budget. If a 429 appears, the report captures `total429`, `first429AtRequest`, status counts, and any `Retry-After` values.

Small PDFs are not discarded. Direct PDF responses are saved as returned, and JSF action responses are saved when they start with `%PDF`, regardless of byte size. Non-PDF JSF responses are still recorded as `failedDownload`.

### Review-friendly run artifacts

Each non-dry run now writes review artifacts next to the JSONL output:

- `run-summary.json`: machine-friendly metrics, artifact paths, and interpretation notes.
- `page-events.jsonl`: one structured event per scraped page for timeline review or database loading.
- `run-report.md`: compact human-readable report for reviewers.

Confidential OEFA rows are reported as `status: "confidential"` in `failed-pdfs.json`. These are expected unavailable PDFs, not scraper failures.

## Sprint 2 log: controlled OEFA validation

**Goal:** Validate the refactored HTTP scraper with a controlled OEFA run: 100 records, PDF attempts, clear metrics, and reviewable evidence for humans, database loading, and LLM analysis.

**Completed:**
- Split the original HTTP scraper into focused modules: `session`, `jsf`, `parser`, `pdf`, `checkpoint`, `output`, `scraper`, `utils`.
- Added `npm run scrape:oefa:test100`.
- Wrote test outputs to `output/test100/oefa-documents.jsonl` and `output/test100/pdfs/`.
- Fixed JSONL write order so `pdfLocalPath` is updated before each document is written.
- Fixed OEFA PrimeFaces pagination using the DataTable source, `*_skipChildren`, `*_encodeFeature`, row-fragment parsing, and partial ViewState updates.
- Stopped discarding small valid PDFs by byte size.
- Added explicit PDF statuses: `downloaded`, `skippedExisting`, `confidential`, `missingPdfUrl`, `missingJsfAction`, `failedDownload`.
- Added review artifacts: `run-summary.json`, `page-events.jsonl`, `run-report.md`, and `failed-pdfs.json`.
- Added `npm run probe:oefa:429` for a separate controlled 429 probe.

**Verified result for `test100`:**
- 100 JSONL records.
- 100 unique IDs.
- 92 records with `pdfLocalPath`.
- 92 downloadable PDFs saved locally.
- 8 records without PDFs because OEFA marks them as confidential.
- 8 `failed-pdfs.json` entries with `status: "confidential"`.
- 0 `failedDownload`.
- 0 HTTP 429 during the test100 run.

**Manual review conclusion:** Manual inspection reached the same result as the scraper reports: the first 100 records do not have 100 downloadable PDFs. The scraper downloads all available PDFs; the remaining records are confidential OEFA rows and cannot be downloaded.

**Related commits:**
- `069a3e8` - `refactor: split HTTP scraper into focused modules`
- `1bab1dd` - `feat: add 100 record PDF download test mode`
- `b4feb63` - `feat: add review-friendly scrape reports`

**Sprint 3 target:**
- Extract a complete OEFA sector.
- Improve terminal visualization so the process is easy to follow live.
- Make the run narrative human-readable and LLM-readable: phases, sectors, pages, documents, PDF outcomes, confidential rows, retries, 429 events, timing, and artifact paths.
- Keep structured artifacts suitable for database ingestion and downstream LLM review.
