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
| PJ Peru — sitio principal | Validado con VPN Peru (100 docs, 10 paginas, 100 PDFs ok) | `output/pjperu/pj-peru-100.jsonl` |

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
| Test distritos v1 — 20 workers, pdf-concurrency 20 | 1,350 | 50 | 10/34 (29%)* | 0 | ~3.5m |
| Test distritos v2 — 20 workers, pdf-concurrency 5 | 1,200 | 50† | 10/34 (29%) | 0 | ~5m |
| Test distritos v3 — 12 workers, pdf-concurrency 5 | 1,500 | 50† | 4/34 (12%) | 0 | ~8m |
| Validacion PDF aislada — Lima (d18), 20 docs, fresh dir | 20 | 20 | 0 | 0 | ~1m33s |
| **Produccion v4 — 12 workers, pdf-conc 15 (en curso 2026-06-27)** | **54,480+** | **4,105+** | **6/34 (18%)‡** | **0** | **~2h** |

> *Root cause: 400 conexiones simultaneas a `/ServletDescarga` (20 workers × 20 pdf-conc) → saturacion. Fix: pdf-concurrency 5 por worker.
> †PDFs contados como `skippedExisting` porque el directorio compartido ya tenia los archivos de corridas anteriores. Test aislado de Lima confirma 20/20 descargados, 45 PDFs/min, latencia avg 2055ms, 100% headers `%PDF-` validos.
> ‡6 distritos (AYACUCHO=80 docs, CALLAO=80, LIMA\_NORTE=90, CANETE=170, AMAZONAS=210, HUANUCO=200) terminaron temprano por saturacion de sesion JSF en el primer batch de 12 workers simultaneos. Son reintentables individualmente (ver seccion "Retry De Distritos Fallidos").

**PDF integrity check (10 muestras de `output/pjperu-districts/pdfs/`):** 10/10 headers `%PDF-` validos, 282–1005 KB por archivo, 0 corruptos.

**Escala real del dataset (medida en vivo):**

| Corte | Docs totales | Paginas (10/pag) | Con PDFs (20 conc.) | Sin PDFs | Con paralelismo distrital |
| --- | ---: | ---: | --- | --- | --- |
| Suprema (buCorte=1) | 207,527 | 20,753 | ~17h | ~4h | — (1 corte nacional) |
| Superior — sin paralelismo | ~458,909 | ~45,891 | ~76h | ~18h | — |
| Superior — 34 distritos x 20 workers | ~458,909 | ~45,891 | ~8h | ~2h | 34x speedup |
| **Ambas estrategias combinadas** | **~666,436** | **~66,644** | **~17h** | **~4h** | max(Suprema, Superior) |

Estimacion de speedup: 34 distritos con 20 workers = 2 rondas de ~90min c/u. El bottleneck pasa a ser Suprema (~4h JSONL only).

- PDFs via GET directo: `/jurisprudenciaweb/ServletDescarga?uuid=...` (298–453 KB por PDF)
- 0 HTTP 429 observados en ninguna corrida; el servidor usa saturacion silenciosa (empty AJAX / HTTP 500), no 429.
- Checkpoints por distrito: `output/checkpoint_pj-peru_s2_d18.json` — reanudar con `--resume`.

Notas generales:

- `Confidenciales` en OEFA no son fallas del scraper; OEFA no expone esos PDFs.
- `Fallos reales` quedan en `failed-pdfs.json` como `failedDownload` y son reintentables.
- 0 HTTP 429 reales en ambos sitios; `simulate:429` provee evidencia deterministica del comportamiento.

## Opciones Del CLI

| Opcion | Uso |
| --- | --- |
| `--site oefa` | Portal OEFA (PrimeFaces, sin VPN) |
| `--site pj-peru` | Portal PJ Peru (RichFaces, requiere VPN Peru) |
| `--sector 1` | OEFA: `1=MINERIA`, `2=ELECTRICIDAD`, `3=HIDROCARBUROS`, `8=PESQUERIA`, `9=INDUSTRIA`. PJ Peru: `1=SUPREMA`, `2=SUPERIOR` |
| `--district 18` | PJ Peru solamente: filtra por distrito judicial (ej. `18=Lima`). Usado por `parallel-districts.mjs`. |
| `--discover-sectors` | Lee sectores desde el portal y termina |
| `--limit 100` | Limita documentos (util para pruebas de menos de 10 min) |
| `--pdfs` | Activa descarga de PDFs |
| `--pdf-dir <dir>` | Directorio de PDFs |
| `--pdf-concurrency 20` | Maximo de descargas PDF concurrentes por pagina |
| `--fresh-output` | Limpia JSONL y `failed-pdfs.json` del destino antes de correr |
| `--resume` | Retoma desde checkpoint por sitio/sector/distrito |
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

## Paralelizacion Por Distrito — Por Que Y Como

### El problema: un solo proceso para 459k documentos es demasiado lento

La Corte Superior tiene ~459,000 documentos distribuidos en 34 distritos judiciales (Lima, Arequipa, Cusco, etc.). Si se consultan todos juntos (`buDistrito=0`, "Todos"), el scraper los navega en serie: pagina 1, pagina 2, ... pagina 45,891. Con el portal respondiendo a ~4-5 segundos por pagina, eso son **~51 horas** de corrida continua.

### La solucion: un proceso por distrito

Cada distrito tiene ~13,500 documentos en promedio. Si lanzamos 20 procesos en paralelo, cada uno filtrando un distrito diferente, el tiempo se reduce a **2 rondas de ~90 minutos = ~3 horas** para toda la Corte Superior.

```
Sin paralelismo:  1 proceso × 45,891 pages × 5s = 51h
Con paralelismo: 34 distritos ÷ 20 workers × 1,350 pages × 5s ≈ 3h
```

### Root cause: saturacion del pool de sesiones JSF

En el test inicial con 20 workers sin jitter, 7 de 34 distritos fallaron (79% de exito). Los errores no eran HTTP 429 — eran respuestas AJAX vacias (`Partial AJAX response empty`). Esto es saturacion silenciosa del servidor, no rate limiting formal.

**Por que ocurre:** El servidor JSF/RichFaces mantiene un pool de sesiones y ViewStates activos en memoria. Cuando 20 procesos arrancan exactamente al mismo tiempo y todos hacen GET + POST de busqueda en el mismo segundo, el pool se satura y algunos requests reciben respuestas vacias en lugar de un error explicito.

**Las 4 mejoras implementadas:**

| Mejora | Donde | Efecto |
| --- | --- | --- |
| **Startup jitter** | `parallel-districts.mjs` | Cada worker espera `slotIdx × 600ms + random(800ms)` antes de arrancar. Los 20 workers se distribuyen en ~14 segundos en lugar de arrancar todos a la vez. Elimina la saturacion inicial. |
| **Full jitter en retries** | `src/session/retry.ts` | Los reintentos usan `base/2 + random(base/2)` en lugar de tiempos fijos. Evita que todos los workers fallidos reintenten al mismo segundo, lo que volveria a saturar el servidor. |
| **Inter-page delay 300–700ms** | `src/config.ts` + `src/scraper/sectorScraper.ts` | Delay aleatorio ANTES de cada `fetchNextPage`. Workers que empiezan a la vez y navegan al mismo ritmo se van desincronizando pagina a pagina — la carga AJAX se distribuye en el tiempo en lugar de llegar en oleadas sincronizadas. Pendiente validar impacto en tasa de exito. |
| **`setMaxListeners(0)`** | `parallel-districts.mjs` | Suprime el warning de Node.js sobre event listeners al tener 20+ streams activos en stdout/stderr y en el WriteStream de fusion. No afecta funcionalidad. |

### Comandos de paralelismo distrital

```bash
# Validacion rapida — 34 distritos x 5 docs, sin PDFs (~2 min)
npm run scrape:pjperu:districts:dry

# Test de 10 minutos — 34 distritos x 50 docs, con PDFs (~3-5 min)
npm run scrape:pjperu:districts:test

# Corrida completa — Superior completo con PDFs (~3h con VPN)
npm run scrape:pjperu:districts

# Reanudar si se interrumpe
npm run scrape:pjperu:districts:resume
```

Los archivos de salida se generan por distrito y luego se fusionan automaticamente:
```
output/pjperu-districts/
  district-18-LIMA.jsonl       # docs del Distrito Lima
  district-4-AREQUIPA.jsonl    # docs de Arequipa
  ...
  all-districts.jsonl          # fusion de todos los OK
  pdfs/                        # PDFs descargados
```

### Retry De Distritos Fallidos

Los distritos que terminaron con pocos registros (AYACUCHO, CALLAO, LIMA\_NORTE, CANETE, AMAZONAS, HUANUCO) fallaron por saturacion del pool JSF en el primer batch. Se pueden reintentar individualmente con `--concurrency 1` para que no compitan con ningun otro worker:

```bash
# Un distrito a la vez — sin competencia, sin saturacion
for DISTRICT in 5 7 9 8 1 12; do
  node dist/cli.js --site pj-peru --sector 2 \
    --district $DISTRICT \
    --pdfs --pdf-dir output/pjperu-districts/pdfs \
    --pdf-concurrency 15 \
    --out output/pjperu-districts/district-$(printf '%02d' $DISTRICT)-retry.jsonl \
    --fresh-output
done
```

Por que `--concurrency 1` funciona: el fallo original fue que 12 procesos arrancan juntos y saturan el ViewState pool. Un proceso solo nunca compite con nadie — puede extraer la pagina completa del distrito sin recibir respuestas AJAX vacias.

### Optimizacion PDF: Skip Existing

El downloader siempre revisa si el PDF ya existe en disco antes de hacer la peticion HTTP. Si existe, lo marca como `skippedExisting` y sigue. Esto significa que:

- **Retries son gratuitos**: reintentar un distrito no re-descarga PDFs que ya estan.
- **Rondas sucesivas son fast**: la segunda corrida de produccion solo descarga los PDFs que no tiene.
- **PDFs y metadatos son independientes**: se puede correr sin `--pdfs` para extraer JSONL rapido, y luego correr solo PDFs en una segunda fase.

La extraccion de metadatos (JSONL) es significativamente mas rapida que la descarga de PDFs porque:

```
JSONL: 1 request AJAX por pagina × 10 docs = ~0.5s/doc
PDF:   1 request GET por doc × ~2s latencia = ~2s/doc
```

Estrategia optima para dataset completo:

```bash
# Fase 1 — extraer todos los metadatos primero (~2h, sin PDFs)
node scripts/parallel-districts.mjs --concurrency 12

# Fase 2 — descargar PDFs con alta concurrencia (~3h, sin re-navegar el portal)
# scripts/pdf-only.mjs --input output/pjperu-districts/all-districts.jsonl --concurrency 50
# (pendiente implementar)
```

## Estrategia De Extraccion Masiva PJ Peru

El dataset completo (~666k docs) no requiere descargarse de una sola vez. La estrategia optima:

### Opcion A — Distritos paralelos (recomendada, ~4h total)

```bash
# Suprema en un proceso + Superior en 34 distritos paralelos
node dist/cli.js --site pj-peru --sector 1 --out output/pjperu-suprema.jsonl &
npm run scrape:pjperu:districts
# El bottleneck es Suprema (~4h sin PDFs). Superior termina en ~2h.
```

### Opcion B — Solo metadatos primero, PDFs despues

```bash
# Fase 1: JSONL sin PDFs (mucho mas rapido)
npm run scrape:pjperu:districts  # sin --pdfs en package.json, editar si se prefiere

# Fase 2 (pendiente implementar): leer JSONL y descargar PDFs sin re-navegar el portal
# node scripts/pdf-only.mjs --input output/pjperu-districts/all-districts.jsonl --concurrency 50
```

### Tabla de escenarios (referencia)

| Escenario | Docs | Tiempo estimado |
| --- | ---: | --- |
| Dry-run validacion | 5/distrito = 170 | ~1 min |
| Test 10 min (50/distrito) | 1,700 | ~3-5 min |
| Superior completo con distritos | ~459,000 | ~3h |
| Suprema completa (1 proceso) | ~207,000 | ~4h |
| Todo PJ Peru con paralelismo | ~666,000 | ~4h (paralelo) |

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

## Ver Ficha — Campos Adicionales Del Portal

El modal "Ver Ficha" (boton en la tabla de resultados) expone campos que no estan en las columnas visibles. Captura real de la interfaz (2026-06-27):

| Seccion | Campo | Ejemplo | Estado |
| --- | --- | --- | --- |
| DATOS DE LA RESOLUCION | `fechaResolucion` | 26/06/2026 | Pendiente implementar |
| DATOS DE LA RESOLUCION | `tipoResolucion` | Sentencia de Vista | Pendiente implementar |
| DATOS DE LA RESOLUCION | `fallo` | Confirmada | Pendiente implementar |
| DATOS DE LA RESOLUCION | `jueces` | [array de nombres] | Pendiente implementar |
| DATOS DE LA RESOLUCION | `ponente` | *** (confidencial) | No expuesto por portal |
| DATOS DE LA RESOLUCION | `dirimente` | *** (confidencial) | No expuesto por portal |
| DATOS DE LA RESOLUCION | `sumilla` | Texto largo | **Ya extraido del panel** |
| DATOS DEL PROCESO | `especialidad` | Familia Civil | Pendiente implementar |
| DATOS DEL PROCESO | `organoJurisdiccional` | 1° SALA MIXTA - Sede Sicuani | Pendiente implementar |
| DATOS DEL PROCESO | `pretensionDelito` | DIVORCIO POR CAUSAL | Pendiente implementar |
| DATOS DEL PROCESO | `proceso` | Conocimiento | Pendiente implementar |
| DATOS DEL PROCESO | `palabrasClave` | CONFIRMARON, CONFIRMA... | **Ya extraido del panel** |
| DATOS DE PROCEDENCIA | `distritoJudicialProcedencia` | Cusco | Pendiente implementar |
| DATOS DE PROCEDENCIA | `expedienteProcedencia` | 235-2025-0 | Pendiente implementar |
| DATOS DE PROCEDENCIA | `fechaResolucionProcedencia` | 13/01/2026 | Pendiente implementar |
| DATOS DE PROCEDENCIA | `falloProcedencia` | Improcedente | Pendiente implementar |

`ponente` y `dirimente` aparecen como `***` — el portal no los expone, no es un bug del scraper.

Para implementar la extraccion de ficha: cada fila devuelve un link o boton que dispara un POST AJAX JSF. El scraper necesita:
1. Capturar el ID del componente que dispara la ficha (via DevTools Network al hacer click en "Ver Ficha").
2. Implementar `src/jsf/fichaFetcher.ts` que hace el POST con `javax.faces.source` del componente y el ViewState activo.
3. Parsear el HTML del panel de respuesta (estructura de tabla `<td>Label</td><td>Valor</td>`).

Esto requiere captura del Network request real — ver seccion "Checklist De Entrega" para el flujo.

## Agenda Proxima Sesion

**Estado al 2026-06-27 (produccion v4 corriendo):**

- 54,480+ docs extraidos | 4,105+ PDFs descargados | run activo con 12 workers
- 18 de 34 distritos completados; 6 fallidos por saturacion JSF primer batch
- El portal muestra 7,168 paginas por distrito → ~71,680 docs/distrito. Limite de tests ajustado a 500 docs para representar mejor la carga real.
- VPN Peru activa durante el run actual

**Tasa de exito por concurrencia (historico):**

| Workers | Exitosos | Tasa | Estado |
| ---: | ---: | --- | --- |
| 20 (sin jitter) | 24/34 | 71% | descartado |
| 12 (con jitter) | 28/34 | 82% | bueno, 6 fallidos por saturacion primer batch |
| 12 + delay 300-700ms | validando en v4 | en curso | objetivo 34/34 en retry individual |

**Proximos pasos (en orden):**

1. **Esperar fin de v4** y contar distritos completados con >4,000 docs.
2. **Retry 6 distritos fallidos** uno por uno con `--concurrency 1`:
   ```bash
   for D in 5 7 9 8 1 12; do
     node dist/cli.js --site pj-peru --sector 2 --district $D \
       --pdfs --pdf-dir output/pjperu-districts/pdfs --pdf-concurrency 15 \
       --out output/pjperu-districts/district-${D}-retry.jsonl --fresh-output
   done
   ```
3. **Calibrar limite de tests a 500 docs** (50 paginas × 10 docs) en lugar de 50 — mas representativo de la carga real del portal (7,168 paginas por distrito).
4. **Implementar `fichaFetcher`** — capturar con DevTools el POST AJAX del boton "Ver Ficha" para agregar los 10 campos nuevos al JSONL.
5. **Implementar `pdf-only.mjs`** — descarga de PDFs desde JSONL existente sin re-navegar JSF. Desbloquea concurrencia de 50+ sin tocar el pool de sesiones.
6. **Fusionar** `output/pjperu-districts/district-*.jsonl` en `all-districts.jsonl` y cargar a MongoDB.

**Comando de inicio proxima sesion (con VPN activa):**
```bash
# Verificar VPN y estado del portal
node dist/cli.js --site pj-peru --dry-run --limit 5

# Retry distritos fallidos (uno por uno, sin competencia)
for D in 5 7 9 8 1 12; do
  node dist/cli.js --site pj-peru --sector 2 --district $D \
    --pdfs --pdf-dir output/pjperu-districts/pdfs --pdf-concurrency 15 \
    --out output/pjperu-districts/district-${D}-retry.jsonl --fresh-output
done

# Test de 500 docs (calibracion de carga real)
node scripts/parallel-districts.mjs --limit 500 --concurrency 12 --pdf-concurrency 15 --fresh-output
```

## Checklist De Entrega

1. `npm run build` — sin errores TypeScript.
2. `npm run simulate:429` — confirmar que salida muestra `"ok": true`.
3. `npm run scrape:oefa:test100` — corrida OEFA limpia de 100 docs.
4. `node dist/cli.js --site pj-peru --dry-run --limit 20` (con VPN peru) — confirmar 2+ paginas.
5. `npm run scrape:pjperu:districts:dry` (con VPN peru) — confirmar 34/34 distritos OK.
6. Revisar `run-summary.json` y `failed-pdfs.json`.
7. Confirmar que `confidential` no aparece como `failedDownload`.
8. Compartir rama `feat/pj-peru-full-extraction` o `main` con artefactos documentados.

## Catalogo De Errores Y Comportamientos Anomalos

Estos son los errores reales observados en produccion. Cada uno tiene una causa especifica y una respuesta conocida.

| Error / Sintoma | Causa raiz | Respuesta del scraper | Accion correctiva |
| --- | --- | --- | --- |
| `Partial AJAX response empty` | Saturacion del pool JSF: demasiados workers arrancando al mismo tiempo, el servidor retorna respuestas vacias en lugar de resultados | Logger lo registra; el worker aborta el distrito actual | Reintentar ese distrito con `--concurrency 1`, sin competencia de otros workers |
| HTTP 500 en POST de busqueda | ViewState expirado o sesion invalida: la sesion del worker murio y el POST llega sin ViewState valido | `withRetry` reintenta 3 veces con backoff; si persiste, el distrito falla con `exit 1` | Reiniciar el worker; el checkpoint permite continuar desde la ultima pagina |
| 0 resultados despues de busqueda exitosa | "Soft block" silencioso: el servidor acepta el request pero retorna una pagina valida con 0 filas. No hay error HTTP | Detectado por `consecutiveEmptyPages >= EMPTY_PAGES_ABORT` (implementado); worker aborta y guarda checkpoint | Esperar y reintentar; si persiste, rotar VPN o reducir concurrencia |
| `docsThisPage = 0` por varias paginas seguidas | Variante del soft block: las primeras N paginas regresan con datos, luego el servidor empieza a servir paginas vacias | Detectado por contador `consecutiveEmptyPages`; abort automatico | Checkpoint disponible; `--resume` retoma desde la ultima pagina con datos |
| PDF no descargado — `failedDownload` | `/ServletDescarga?uuid=` retorna non-PDF (404, redirect, HTML de error) despues de 3 reintentos | Registrado en `failed-pdfs.json` con URL y status | Revisar si el UUID sigue siendo valido (pueden expirar); reintentar con script pdf-only |
| PDF como `missingPdfUrl` | El mapper no encontro URL en la fila — puede ser un documento sin PDF real | Registrado en `failed-pdfs.json` | Revisar el HTML raw de la fila; si el selector no captura la URL, actualizar `rowParser.ts` |
| `totalPages = ?` en terminal | `parsePaginatorText` no encontro `maxValue` en los scripts de la pagina — ocurre en respuestas AJAX parciales que no incluyen la config del DataScroller | `totalPages` se computa desde `totalRecords / 10` cuando es posible; de lo contrario se muestra `?` | Normal para paginas AJAX intermedias; solo la pagina inicial tiene `maxValue` |
| `tipoRecurso / sumilla / palabrasClave = null` | Selector `div.rf-p[id^="formBuscador:repeat:"]` no encontro el panel — puede ser una respuesta parcial incompleta | Los campos quedan en null; el documento igual se guarda | Verificar que la respuesta AJAX incluya el HTML completo del repeat; puede ser saturacion o timeout del servidor |
| Checkpoint no avanza (pagesSinceCheckpoint = 0) | El scraper guarda checkpoint cada 5 paginas; si el distrito termina en menos de 5 paginas, el checkpoint puede no haberse guardado | El checkpoint se guarda al terminar (exit limpio) | Si el proceso murio sin checkpoint, el distrito corre desde cero; el skip de PDFs existentes evita re-descargas |

### Soft Block — Deteccion Y Respuesta Automatica

El portal PJ Peru usa saturacion silenciosa en lugar de HTTP 429. Cuando un worker hace demasiadas requests, el servidor empieza a servir paginas con 0 documentos en vez de retornar un error explicito. Sin deteccion, el scraper navega decenas de paginas vacias y nunca termina.

```mermaid
flowchart TD
    Page["Procesar pagina N"] --> Count["docsThisPage = 0?"]
    Count -->|Si| Inc["consecutiveEmptyPages++"]
    Count -->|No| Reset["consecutiveEmptyPages = 0"]
    Inc --> Threshold{">= 3 vacias\nconsecutivas?"}
    Threshold -->|Si| Abort["Abort: guardar checkpoint\nloggear soft_block en page-events"]
    Threshold -->|No| Next["Siguiente pagina"]
    Reset --> Next
    Abort --> Retry["Reintentar con --resume\no --concurrency 1"]
```

Constante configurable en `src/scraper/sectorScraper.ts`:

```typescript
const CONSECUTIVE_EMPTY_ABORT = 3; // abortar si 3 paginas seguidas devuelven 0 docs
```

El evento de abort se registra en `page-events.jsonl` con `type: "soft_block_abort"` para auditoria.

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
