# pj-peru-scraper

Scraper HTTP en TypeScript para portales JSF/PrimeFaces peruanos, sin automatizacion de navegador. La implementacion validada usa el sitio alternativo permitido por el desafio: OEFA TFA.

## Resumen Ejecutivo

El desafio original pide extraer documentos, navegar paginas, descargar PDFs y manejar rate limiting HTTP 429. El portal principal de PJ Peru requiere IP peruana/VPN para validacion completa. Este repositorio deja una implementacion completa y reproducible sobre OEFA, el sitio alternativo sin VPN indicado en el enunciado, usando la misma familia tecnica: formularios JSF, `javax.faces.ViewState`, cookies, POSTs y paginacion PrimeFaces.

| Requisito | Estado | Evidencia |
| --- | --- | --- |
| TypeScript | Cumplido | `src/**/*.ts`, `npm run build` |
| Sin browser automation | Cumplido | Usa `axios` + `cheerio`; no Puppeteer/Playwright/Selenium |
| Navegacion/paginacion | Cumplido en OEFA | POST JSF + paginador PrimeFaces |
| Extraccion de datos | Cumplido en OEFA | `oefa-documents.jsonl` con campos normalizados y `rawCells` |
| Descarga de PDFs | Cumplido en OEFA | `pdfs/*.pdf`, `pdfLocalPath`, conteos en `run-summary.json` |
| PDFs no disponibles | Cumplido | `confidential` separado de `failedDownload` |
| Manejo 429 con backoff | Cumplido | `npm run simulate:429` valida 429 recuperable y persistente |
| Registro de fallos reintentables | Cumplido | `failed-pdfs.json` |
| PJ Peru | Preparado, no validado | Requiere VPN/proxy peruano; usar `--proxy` y `npm run recon -- --site pj-peru` |

## Quick Start

```bash
npm install
npm run build
```

Corrida controlada con OEFA:

```bash
npm run scrape:oefa:test100
```

Simulacion reproducible de rate limiting:

```bash
npm run simulate:429
```

Corrida manual por sector:

```bash
node dist/cli.js --site oefa --sector 1 --pdfs \
  --pdf-dir output/mineria/pdfs \
  --out output/mineria/oefa-documents.jsonl \
  --pdf-concurrency 20 \
  --fresh-output
```

## Scripts Principales

| Script | Uso |
| --- | --- |
| `npm run build` | Compila TypeScript |
| `npm run scrape:oefa:test100` | Corrida controlada de 100 documentos OEFA + PDFs |
| `npm run scrape:oefa:mineria` | Sector MINERIA desde cero |
| `npm run scrape:oefa:mineria:resume` | Retoma MINERIA desde checkpoint |
| `npm run simulate:429` | Prueba local de backoff 429, sin depender del servidor real |
| `npm run probe:oefa:429` | Probe agresivo contra OEFA real para observar si emite 429 |
| `npm run recon -- --site pj-peru --proxy <url>` | Recon inicial de PJ cuando haya VPN/proxy peruano |

## Arquitectura

El scraper no controla un navegador. Mantiene una sesion HTTP, conserva cookies, extrae `ViewState`, envia formularios JSF y parsea HTML con Cheerio.

```mermaid
flowchart TD
    CLI["CLI: src/cli.ts"] --> Config["SiteConfig: src/config.ts"]
    Config --> Session["Sesion HTTP: axios + cookies"]
    Session --> Start["GET pagina inicial"]
    Start --> ViewState["Extraer ViewState e inputs"]
    ViewState --> Search["POST formulario de busqueda"]
    Search --> Page["Parsear filas, paginador y ViewState"]
    Page --> Docs["Mapear filas a JudicialDocument"]
    Docs --> PDFs["Resolver PDFs directos o acciones JSF"]
    PDFs --> JSONL["Escribir JSONL"]
    PDFs --> PdfDir["Guardar PDFs"]
    JSONL --> Reports["run-summary, page-events, run-report"]
    PDFs --> Failed["failed-pdfs.json"]
    Page --> Next{"Hay siguiente pagina?"}
    Next -->|Si| Paginator["POST paginador PrimeFaces"]
    Paginator --> Page
    Next -->|No| Reports
```

Modulos clave:

| Modulo | Responsabilidad |
| --- | --- |
| `src/cli.ts` | Flags, `--fresh-output`, arranque |
| `src/config.ts` | Configuracion por sitio: URL, selectores, columnas, tiempos |
| `src/session/*` | Axios, cookies, deteccion de rate limit, retry/backoff |
| `src/jsf/*` | Formularios, paginacion, respuestas parciales JSF |
| `src/parser/*` | HTML a pagina, filas y documentos |
| `src/scraper/*` | Orquestacion por sitio/sector/pagina |
| `src/pdf/downloader.ts` | Descarga directa y descarga por accion JSF |
| `src/output/runReport.ts` | Artefactos de auditoria |
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

Estos son resultados observados en el workspace durante el sprint. Para una entrega formal, se recomienda regenerar una carpeta final limpia con `--fresh-output`.

| Sector/corrida | Docs | PDFs disponibles | Confidenciales | Fallos reales | HTTP 429 | Duracion |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `output/mineria` | 840 | 786 | 44 | 10 | 0 | 3m0s |
| `output/hidrocarburos` | 434 | 397 | 33 | 4 | 0 | 4m11s |
| `output/pesqueria` | 255 | 233 | 16 | 6 | 0 | 2m13s |
| `output/electricidad` | 125 | 100 | 25 | 0 | 0 | 2m0s |
| `output/industria_c30` | 90 | 79 | 11 | 0 | 0 | 40s |
| `output/smoke-speed-retry` | 20 | 15 | 5 | 0 | 0 | 6s |

Notas:

- `Confidenciales` no son fallas del scraper; OEFA no expone esos PDFs.
- `Fallos reales` quedan en `failed-pdfs.json` como `failedDownload` y son reintentables.
- Las corridas de performance observaron 0 HTTP 429 reales; por eso se incluye `simulate:429` como evidencia deterministica.

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

## PJ Peru Con VPN/Proxy

El sitio PJ Peru queda preparado como siguiente paso, pero no validado sin IP peruana. Cuando exista VPN/proxy:

```bash
npm run recon -- --site pj-peru --proxy http://user:pass@host:port
```

Luego ajustar en `src/config.ts`:

- columnas reales de la tabla;
- selectores de filas/celdas/PDF;
- campos de busqueda si difieren;
- accion exacta de descarga de PDF.

La arquitectura ya deberia transferirse bien porque PJ y OEFA comparten patrones JSF/PrimeFaces: `ViewState`, cookies, formularios POST y paginacion.

## Checklist Para El Primer Entregable

Antes de compartir:

1. Ejecutar `npm run build`.
2. Ejecutar `npm run simulate:429`.
3. Ejecutar una corrida OEFA limpia, por ejemplo `npm run scrape:oefa:test100`.
4. Revisar `run-summary.json` y `failed-pdfs.json`.
5. Confirmar que `confidential` no se reporta como fallo real.
6. Subir el repo publico o compartir la rama con estos artefactos documentados.

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
