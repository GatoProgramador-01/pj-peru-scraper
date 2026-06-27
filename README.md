# pj-peru-scraper

Scraper HTTP en TypeScript para portales JSF peruanos, sin automatizacion de navegador. Soporta dos variantes: OEFA (PrimeFaces) y PJ Peru (RichFaces). Ambos sitios validados con extraccion real y descarga de PDFs.

## Resumen Ejecutivo

El desafio pide extraer documentos, navegar paginas, descargar PDFs y manejar rate limiting HTTP 429. El scraper cubre dos portales con tecnologias JSF distintas — el mismo nucleo de sesion, ViewState y retry/backoff funciona en ambos.

| Requisito | Estado | Evidencia |
| --- | --- | --- |
| TypeScript | Cumplido | `src/**/*.ts`, `npm run build` |
| Sin browser automation | Cumplido | `axios` + `cheerio`; no Puppeteer/Playwright/Selenium |
| Navegacion/paginacion | Cumplido — OEFA y PJ Peru | PrimeFaces (OEFA) y RichFaces DataScroller (PJ Peru) |
| Extraccion de datos | Cumplido — ambos sitios | JSONL con campos normalizados y `rawCells` |
| Descarga de PDFs | Cumplido — ambos sitios | OEFA: accion JSF POST · PJ Peru: GET `/ServletDescarga?uuid=` |
| PDFs no disponibles | Cumplido | `confidential` separado de `failedDownload` |
| Manejo 429 con backoff | Cumplido | `npm run simulate:429` valida 429 recuperable y persistente |
| Registro de fallos reintentables | Cumplido | `failed-pdfs.json` |
| OEFA — sitio alternativo | Validado (1,724 docs, 5 sectores, 0 HTTP 429) | `output/mineria/`, `output/hidrocarburos/`, etc. |
| PJ Peru — sitio principal | Validado con VPN Peru (100 docs, 10 paginas, PDFs ok) | `output/pjperu/pj-peru-100.jsonl` |

## Quick Start

```bash
npm install
npm run build
```

Corrida controlada OEFA (100 docs + PDFs):

```bash
npm run scrape:oefa:test100
```

Corrida PJ Peru (requiere VPN/proxy peruano):

```bash
node dist/cli.js --site pj-peru --limit 10 --pdfs \
  --pdf-dir output/pjperu/pdfs \
  --out output/pjperu/pj-peru-documents.jsonl
```

Todos los sectores OEFA en paralelo:

```bash
npm run scrape:oefa:parallel
```

Simulacion reproducible de rate limiting:

```bash
npm run simulate:429
```

## Scripts Principales

| Script | Uso |
| --- | --- |
| `npm run build` | Compila TypeScript |
| `npm run scrape:oefa:test100` | Corrida controlada de 100 documentos OEFA + PDFs |
| `npm run scrape:oefa:mineria` | Sector MINERIA desde cero |
| `npm run scrape:oefa:mineria:resume` | Retoma MINERIA desde checkpoint |
| `npm run scrape:oefa:parallel` | Los 5 sectores OEFA en paralelo (~3 min total vs ~12 min secuencial) |
| `npm run scrape:oefa:parallel:dry` | Dry-run paralelo para validar sin escribir datos |
| `npm run simulate:429` | Prueba local de backoff 429, sin depender del servidor real |
| `npm run probe:oefa:429` | Probe agresivo contra OEFA real para observar si emite 429 |

## Arquitectura

El scraper no controla un navegador. Mantiene una sesion HTTP, conserva cookies, extrae `ViewState`, envia formularios JSF y parsea HTML con Cheerio. Soporta dos variantes de componentes JSF sin cambiar el nucleo.

```mermaid
flowchart TD
    CLI["CLI: src/cli.ts"] --> Config["SiteConfig: src/config.ts"]
    Config --> Session["Sesion HTTP: axios + cookies"]
    Session --> Start["GET pagina inicial"]
    Start --> ViewState["Extraer ViewState e inputs"]
    ViewState --> Search["POST formulario de busqueda"]
    Search --> Redirect{"Redireccion 302?"}
    Redirect -->|Si - PJ Peru| Upgrade["Upgrade http→https, GET resultado.xhtml"]
    Redirect -->|No - OEFA| Page
    Upgrade --> Page["Parsear filas, paginador y ViewState"]
    Page --> Docs["Mapear filas a JudicialDocument"]
    Docs --> PDFs{"Tipo de PDF?"}
    PDFs -->|URL directa - PJ Peru| DirectPdf["GET /ServletDescarga?uuid="]
    PDFs -->|Accion JSF - OEFA| PostPdf["POST accion JSF + ViewState"]
    DirectPdf --> JSONL["Escribir JSONL"]
    PostPdf --> JSONL
    JSONL --> PdfDir["Guardar PDFs"]
    JSONL --> Reports["run-summary, page-events, run-report"]
    PDFs --> Failed["failed-pdfs.json"]
    Page --> Next{"Hay siguiente pagina?"}
    Next -->|Si - PrimeFaces| PfPaginator["POST paginador PrimeFaces"]
    Next -->|Si - RichFaces| RfPaginator["POST DataScroller formBuscador:data1:page"]
    PfPaginator --> Page
    RfPaginator --> Page
    Next -->|No| Reports
```

Modulos clave:

| Modulo | Responsabilidad |
| --- | --- |
| `src/cli.ts` | Flags, `--fresh-output`, arranque |
| `src/config.ts` | Configuracion por sitio: URL, selectores, columnas, tiempos, `rowParser` |
| `src/session/*` | Axios, cookies, deteccion de rate limit, retry/backoff |
| `src/jsf/*` | Formularios, paginacion PrimeFaces y RichFaces, respuestas parciales JSF |
| `src/parser/*` | HTML a pagina, filas `<tr>` o div-repeat, documentos |
| `src/scraper/*` | Orquestacion por sitio/sector/pagina; multi-proceso paralelo |
| `src/pdf/downloader.ts` | Descarga directa (PJ Peru) y por accion JSF (OEFA) |
| `src/output/runReport.ts` | Artefactos de auditoria |
| `scripts/parallel-sectors.mjs` | Lanza N procesos Node en paralelo, uno por sector |
| `src/tools/simulate429.ts` | Validacion local de 429 |

## Flujo De PDFs

OEFA tiene documentos descargables y documentos confidenciales. Los confidenciales son documentos validos, pero el portal no expone PDF. El scraper los marca aparte para que no parezcan errores.

```mermaid
flowchart TD
    Row["Fila del portal"] --> Url{"Tiene URL directa?"}
    Url -->|Si| Direct["GET PDF con cookies"]
    Url -->|No| Action{"Tiene accion JSF?"}
    Action -->|Si| PostPdf["POST accion JSF + ViewState"]
    Action -->|No| Conf{"rawCells contiene confidencial?"}

    Conf -->|Si| Confidential["status: confidential"]
    Conf -->|No| Missing["status: missingJsfAction"]

    Direct --> Existing{"PDF ya existe?"}
    PostPdf --> Existing
    Existing -->|Si| Skipped["status: skippedExisting"]
    Existing -->|No| Retry["withRetry: 429/backoff y fallas transitorias"]
    Retry --> PdfOk{"Respuesta PDF valida?"}
    PdfOk -->|Si| Downloaded["status: downloaded"]
    PdfOk -->|No| Failed["status: failedDownload"]

    Downloaded --> JSONL["JSONL con pdfLocalPath"]
    Skipped --> JSONL
    Confidential --> FailedReport["failed-pdfs.json"]
    Missing --> FailedReport
    Failed --> FailedReport
```

Interpretacion de estados:

| Estado | Significado | Accion |
| --- | --- | --- |
| `downloaded` | PDF descargado en esta corrida | OK |
| `skippedExisting` | PDF ya estaba en disco | OK en resume/retry |
| `confidential` | OEFA no expone PDF por confidencialidad | Esperado, no es error |
| `missingJsfAction` | No se encontro URL ni accion JSF | Revisar selector si aumenta |
| `missingPdfUrl` | Documento sin URL directa | Normal en algunos sitios, depende del mapper |
| `failedDownload` | Hubo intento real y fallo | Reintentar o revisar red/portal/parser |

## Manejo De HTTP 429

El requisito pide detectar 429, aplicar backoff, continuar si persiste y registrar documentos fallidos. El scraper usa `withRetry()` en navegacion, paginacion y descarga de PDFs.

```mermaid
sequenceDiagram
    participant Scraper
    participant Portal
    participant Metrics

    Scraper->>Portal: Request GET/POST/PDF
    Portal-->>Scraper: HTTP 429 + Retry-After
    Scraper->>Metrics: totalRetries++, total429++
    Scraper->>Scraper: sleep(max(Retry-After, retryWaitMs[n]))
    Scraper->>Portal: Retry 2
    Portal-->>Scraper: HTTP 429
    Scraper->>Metrics: totalRetries++, total429++
    Scraper->>Scraper: backoff
    Scraper->>Portal: Retry 3
    alt Recuperable
        Portal-->>Scraper: 200 / PDF valido
        Scraper->>Metrics: continua corrida
    else Persistente
        Portal-->>Scraper: HTTP 429 o error final
        Scraper->>Metrics: registra fallo
        Scraper->>Scraper: continua con siguiente documento/pagina segun contexto
    end
```

La prueba local no depende de que OEFA emita 429 en vivo:

```bash
npm run simulate:429
```

Salida esperada resumida:

```json
{
  "ok": true,
  "recoverable": {
    "attempts": 3,
    "retries": 2,
    "total429": 2,
    "outcome": "ok"
  },
  "persistent": {
    "attempts": 3,
    "retries": 3,
    "total429": 3,
    "outcome": "failed-after-retries"
  }
}
```

Esto demuestra dos escenarios del desafio:

| Escenario | Comportamiento validado |
| --- | --- |
| 429 recuperable | Espera, reintenta y sigue |
| 429 persistente | Agota intentos, registra metricas y falla controladamente |

Tambien existe un probe contra OEFA real:

```bash
npm run probe:oefa:429
```

Ese probe sirve para observar si el portal real empieza a limitar, pero no es necesario para demostrar la logica porque el servidor puede no emitir 429 durante una corrida normal.

## Artefactos De Corrida

Cada corrida no `dry-run` escribe evidencia junto al JSONL de salida.

```mermaid
flowchart LR
    Run["Corrida scraper"] --> JSONL["oefa-documents.jsonl"]
    Run --> PDFDir["pdfs/"]
    Run --> Summary["run-summary.json"]
    Run --> Events["page-events.jsonl"]
    Run --> Report["run-report.md"]
    Run --> Failed["failed-pdfs.json"]
    Run --> Checkpoint["output/checkpoint_<site>_s<sector>.json"]

    Summary --> Review["Revision rapida"]
    Events --> Timeline["Auditoria por pagina"]
    Failed --> RetryAudit["Confidenciales vs fallos reales"]
    JSONL --> DB["Carga DB/analisis"]
```

| Archivo | Proposito |
| --- | --- |
| `oefa-documents.jsonl` | Un documento por linea, amigable para cargas incrementales |
| `pdfs/*.pdf` | PDFs descargados |
| `run-summary.json` | Totales, metricas y rutas de artefactos |
| `page-events.jsonl` | Evento estructurado por pagina |
| `run-report.md` | Resumen humano de la corrida |
| `failed-pdfs.json` | Inventario de confidenciales, missing y fallos reales |
| `checkpoint_*.json` | Estado para `--resume` |

## Evidencia Local Observada

Resultados reales de corridas en el workspace. Para entrega formal, regenerar con `--fresh-output`.

### OEFA — Sitio alternativo (PrimeFaces/JSF, sin VPN)

| Sector | Docs | PDFs ok | Confidenciales | Fallos reales | HTTP 429 | Duracion |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| MINERIA (1) | 840 | 786 | 44 | 10 | 0 | 3m0s |
| HIDROCARBUROS (3) | 434 | 397 | 33 | 4 | 0 | 4m11s |
| PESQUERIA (8) | 255 | 233 | 16 | 6 | 0 | 2m13s |
| ELECTRICIDAD (2) | 125 | 100 | 25 | 0 | 0 | 2m0s |
| INDUSTRIA (9) | 90 | 79 | 11 | 0 | 0 | 40s |
| **Total OEFA** | **1,744** | | | | **0** | |

Con `scrape:oefa:parallel`: todos los sectores en paralelo, tiempo total = sector mas lento (~3 min).

### PJ Peru — Sitio principal (RichFaces/JSF, requiere VPN Peru)

| Corrida | Docs | PDFs ok | Fallos | HTTP 429 | Duracion |
| --- | ---: | ---: | ---: | ---: | --- |
| Prueba inicial (5 docs) | 5 | 5 | 0 | 0 | 35s |
| Corrida validacion (100 docs, 10 paginas) | 100 | 100 | 0 | 0 | ~7m |

- Dataset total: 207,527 resultados (Corte Suprema) · 666,436 resoluciones (todas las cortes)
- PDFs via GET directo: `/jurisprudenciaweb/ServletDescarga?uuid=...` (298–453 KB por PDF)
- 0 HTTP 429 observados; politica de delay 2.5–5.5s entre paginas.

Notas generales:

- `Confidenciales` en OEFA no son fallas del scraper; OEFA no expone esos PDFs.
- `Fallos reales` quedan en `failed-pdfs.json` como `failedDownload` y son reintentables.
- 0 HTTP 429 reales en ambos sitios; `simulate:429` provee evidencia deterministica del comportamiento.

## Opciones Del CLI

| Opcion | Uso |
| --- | --- |
| `--site oefa` | Portal validado actualmente |
| `--site pj-peru` | Configuracion preparada para recon con VPN/proxy peruano |
| `--sector 1` | Sector OEFA; `1=MINERIA`, `2=ELECTRICIDAD`, `3=HIDROCARBUROS`, `8=PESQUERIA`, `9=INDUSTRIA` |
| `--discover-sectors` | Lee sectores desde el portal y termina |
| `--limit 100` | Limita documentos para pruebas |
| `--pdfs` | Activa descarga de PDFs |
| `--pdf-dir <dir>` | Directorio de PDFs |
| `--pdf-concurrency 20` | Maximo de descargas PDF concurrentes por pagina |
| `--fresh-output` | Limpia JSONL y `failed-pdfs.json` del destino antes de correr |
| `--resume` | Retoma desde checkpoint por sitio/sector |
| `--dry-run` | Recorre y loguea sin escribir salida |
| `--proxy <url>` | Proxy HTTP/HTTPS para PJ Peru o redes restringidas |

## Checkpoints Y Resume

Los checkpoints viven en `output/checkpoint_{site}_s{sectorId}.json`.

Con `--resume`, el scraper:

1. Carga el checkpoint del sector.
2. Abre una sesion nueva.
3. Reenvia la busqueda.
4. Reproduce POSTs de paginacion hasta la pagina guardada.
5. Continua desde ahi.
6. Marca `completed: true` solo al terminar el sector.

Para auditoria limpia, usar `--fresh-output`. Para continuidad operacional, usar `--resume`.

## PJ Peru — Diferencias Tecnicas Respecto A OEFA

PJ Peru usa **RichFaces 4.2.2 + Mojarra** (no PrimeFaces). Las diferencias relevantes:

| Aspecto | OEFA | PJ Peru |
| --- | --- | --- |
| Componente UI | PrimeFaces DataTable | RichFaces DataScroller + Repeat |
| Resultado | `<tr data-ri="N">` | `<div id="formBuscador:repeat:N:j_idt455">` |
| Paginacion AJAX | `_pagination=true` + `_first=N` | `formBuscador:data1:page=N` |
| Post-busqueda | POST directo | POST `inicio.xhtml` → 302 → GET `resultado.xhtml` |
| Redireccion | No | Si; servidor emite `http://` aunque se accede por `https://` — el scraper hace el upgrade manual |
| PDFs | POST accion JSF + ViewState | GET `/ServletDescarga?uuid=...` |
| VPN requerida | No | Si (IP peruana) |

Configuracion validada en `src/config.ts` bajo la clave `pj-peru`. Para correr:

```bash
# Con VPN peru activa:
node dist/cli.js --site pj-peru --limit 10 --dry-run
node dist/cli.js --site pj-peru --limit 100 --pdfs --pdf-dir output/pjperu/pdfs --out output/pjperu/pj-peru-documents.jsonl
```

## Checklist De Entrega

1. `npm run build` — sin errores TypeScript.
2. `npm run simulate:429` — confirmar que salida muestra `"ok": true`.
3. `npm run scrape:oefa:test100` — corrida OEFA limpia de 100 docs.
4. `node dist/cli.js --site pj-peru --dry-run --limit 20` (con VPN peru) — confirmar 2+ paginas.
5. Revisar `run-summary.json` y `failed-pdfs.json`.
6. Confirmar que `confidential` no aparece como `failedDownload`.
7. Compartir rama `feat/oefa-full-extraction` o `main` con artefactos documentados.

## Guia Para Un Futuro Colega

Si solo puedes leer tres cosas:

1. Este README.
2. `src/scraper/sectorScraper.ts` para entender el loop por pagina.
3. `src/pdf/downloader.ts` y `src/session/retry.ts` para entender PDFs, 429 y backoff.

Si revisas datos:

- Empieza por `run-summary.json`.
- Usa `page-events.jsonl` para reconstruir la corrida.
- Trata `failed-pdfs.json` como inventario, no como lista pura de errores.
- Separa siempre `confidential` de `failedDownload`.

## Licencia

MIT.
