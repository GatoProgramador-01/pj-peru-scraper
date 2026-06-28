# pj-peru-scraper

Scraper HTTP en TypeScript para portales JSF peruanos. Usa axios + Cheerio, no automatiza navegador. Soporta OEFA (PrimeFaces) y PJ Peru (RichFaces), con paginacion JSF, checkpoints, salida JSONL y descarga opcional de PDFs.

## Contexto Rapido

El proyecto busca probar que el scraper corre de punta a punta:

- compila y pasa tests unitarios;
- maneja sesiones JSF reales sin browser automation;
- extrae paginas y documentos reales;
- descarga PDFs cuando el portal los expone;
- registra fallos recuperables sin truncar silenciosamente;
- corre en paralelo mediante comandos npm.

Evidencia actual: en una corrida real de Suprema por año con VPN peruana, el scraper sostuvo cerca de una hora de extraccion, llego a ~43,750 documentos combinando run principal + retry, y demostro que los soft-blocks son contencion del pool JSF, no HTTP 429.

## Configuracion Inicial

Copiar la plantilla y editar los valores que necesites:

```bash
cp .env.example .env
```

El scraper carga `.env` automaticamente al arrancar. No es necesario exportar variables en la terminal. Ver `.env.example` para la lista completa con descripciones.

Para los tests de esta guia, el `.env` recomendado es:

```bash
# .env — ajustes recomendados para validar el proyecto completo
PDF_CONCURRENCY=4          # descargas PDF concurrentes por pagina (por defecto: 1)
PROBE_429_TOTAL=100        # requests para la sonda 429 (reducir para test rapido)
PROBE_429_CONCURRENCY=10   # concurrencia de la sonda (ajustar al umbral a testear)
```

## Guia De Pruebas

Correr en este orden. Los comandos npm funcionan igual en Ubuntu, Windows y CI — no invocar los scripts `.mjs` directamente. Los primeros 3 pasos no requieren internet ni VPN.

### Paso 1 — Sin internet (verificacion estatica)

```bash
npm ci            # instala dependencias exactas del lockfile
npm run ci        # typecheck + build + lint + 170 tests unitarios
```

Resultado esperado: `Tests  170 passed (170)`, sin errores tsc ni lint.

### Paso 2 — Sin internet (retry y soft-block)

```bash
npm run verify:local
```

Simula tres escenarios sin tocar ningun portal: 429 recuperable (3 intentos, exito), 429 persistente (3 intentos, falla controlada), y soft-block (3 paginas AJAX vacias consecutivas → abort). Imprime `"ok": true` con las tres secciones en JSON.

```bash
npm run demo:soft-block
```

Levanta un servidor HTTP local en `127.0.0.1` que replica el patron de soft-block del portal real: GET bootstrap entrega 2 documentos, los POST de paginacion AJAX devuelven HTTP 200 con cuerpo vacio y next-button presente. Resultado esperado:

```
✓ scraped   page 1/?  docs=2
⚠ warning   page 2/?  docs=0
⚠ warning   page 3/?  docs=0
✖ ABORT     page 4/?  docs=0
```

`Page events emitted: 4`. No requiere VPN ni conexion de red.

### Paso 3 — Internet publica, sin VPN (OEFA)

```bash
npm run scrape:oefa:test100
```

Extrae 100 documentos reales del portal publico OEFA + descarga sus PDFs. No requiere VPN. Al terminar verifica:
- `output/test100/oefa-documents.jsonl` — exactamente 100 lineas
- `output/test100/pdfs/` — archivos `.pdf` presentes
- `output/test100/run-summary.json` — totales y metricas

### Paso 4 — VPN peruana activa (PJ Peru smoke)

El portal bloquea IPs no peruanas con HTTP 403. Verificar que el nodo de salida es Peru antes de correr:

```bash
curl -s https://ipinfo.io/json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('country'), d.get('city'), d.get('org'))"
# Debe imprimir: PE  Lima  <ISP peruano>
```

Confirmar que el portal responde:

```bash
curl -s --max-time 5 -o /dev/null -w "%{http_code}\n" https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml
# Debe retornar: 200
```

Luego:

```bash
npm run scrape:pjperu:smoke
```

Conecta al portal, envia el formulario de busqueda JSF y parsea 20 documentos en dry-run (no escribe nada al disco). Resultado esperado:

```
OK Session ready
OK Search complete  N records · M pages
  Pagina 1 de M   |   Tiempo: Xs
  + Documentos esta pagina  : 10
    Total acumulado         : 10
```

Confirma que la sesion HTTP, el ViewState JSF, el formulario de busqueda y el parser RichFaces funcionan con el portal real.

### Paso 5 — VPN peruana activa (tests acotados con datos reales)

```bash
npm run scrape:pjperu:suprema:years:test   # 4 años x 500 docs + PDFs, ~6 min
npm run scrape:pjperu:districts:test       # 34 distritos + PDFs, ~25 min
```

Estos son los tests de integracion completos. Producen documentos reales, PDFs descargados y reportes en `output/`.

### Paso 6 — Verificar logica de 429 contra portal real (opcional)

```bash
npm run probe:oefa:429
```

Sonda el portal OEFA con 500 requests concurrentes para encontrar el threshold de rate limiting. Imprime `[PASS]` si detecta 429, `[WARN]` si no. Solo util para calibrar `PDF_CONCURRENCY`.

---

| Comando | Requiere VPN | Tiempo aprox |
| --- | --- | --- |
| `npm run ci` | No | ~15 s |
| `npm run verify:local` | No | ~3 s |
| `npm run demo:soft-block` | No | ~5 s |
| `npm run scrape:oefa:test100` | No | ~2-5 min |
| `npm run scrape:pjperu:smoke` | Si (Peru) | ~30 s |
| `npm run scrape:pjperu:suprema:years:test` | Si (Peru) | ~6 min |
| `npm run scrape:pjperu:districts:test` | Si (Peru) | ~25 min |

## Scripts Principales

| Script | Uso |
| --- | --- |
| `npm run simulate:429` | Simula retry/backoff 429 localmente |
| `npm run demo:soft-block` | Demo offline de deteccion de soft-block (servidor local) |
| `npm run scrape:oefa:test100` | 100 documentos OEFA + PDFs |
| `npm run scrape:oefa:parallel` | Sectores OEFA en paralelo |
| `npm run scrape:pjperu:smoke` | Smoke PJ Peru directo por CLI |
| `npm run scrape:pjperu:districts:dry` | Smoke Superior por distritos, sin escribir datos |
| `npm run scrape:pjperu:districts:test` | Prueba acotada Superior con PDFs |
| `npm run scrape:pjperu:districts` | Extraccion Superior por distritos |
| `npm run scrape:pjperu:suprema:years:dry` | Smoke Suprema por años |
| `npm run scrape:pjperu:suprema:years:test` | Prueba acotada Suprema por años |
| `npm run scrape:pjperu:suprema:years` | Extraccion Suprema particionada por año |
| `npm run scrape:pjperu:suprema:years:retry` | Retry secuencial de años con soft-block |

## Politica De Retry Y Caso Real Encontrado

El scraper maneja dos familias de error de disponibilidad:

| Caso | Como se detecta | Que hace el scraper |
| --- | --- | --- |
| HTTP 429 o timeout | Excepcion HTTP | `withRetry()` reintenta hasta 3 veces con jitter exponencial |
| Soft-block JSF | 3 HTTP 200 con AJAX vacio seguidos | Registra `soft_block_abort`, guarda checkpoint, permite `--resume` |

**El caso real encontrado en produccion fue el soft-block, no el 429.**

En las corridas de PJ Peru Suprema con 12 workers en paralelo, el portal devolvio HTTP 200
con cuerpo AJAX vacio en lugar de un codigo de error explicito. Es el equivalente funcional
del 429: el portal deja de entregar datos silenciosamente porque los workers compiten por
el mismo ViewState del pool JSF.

El scraper lo detecta, lo registra y no trunca el resultado:

```bash
# Ver eventos de soft-block en una corrida real:
grep "soft_block" output/*/page-events.jsonl

# Reanudar con un solo worker para eliminar la contencion:
npm run scrape:pjperu:suprema:years:retry
```

Para validar la logica de retry sin necesitar ningun portal:

```bash
npm run verify:local
```


## Artefactos De Ejecucion

| Archivo | Proposito |
| --- | --- |
| `*.jsonl` | Un documento por linea |
| `pdfs/*.pdf` | PDFs descargados |
| `run-summary.json` | Totales y metricas principales |
| `page-events.jsonl` | Eventos por pagina |
| `run-report.md` | Resumen humano de la corrida |
| `failed-pdfs.json` | PDFs confidenciales, missing o fallidos |
| `checkpoint_*.json` | Estado para `--resume` |

## Flujo General

```mermaid
flowchart TD
    CLI["npm script / CLI"] --> Config["SiteConfig"]
    Config --> Session["Sesion HTTP"]
    Session --> Start["GET pagina inicial"]
    Start --> Search["POST busqueda JSF"]
    Search --> Page["Parsear filas + paginador + ViewState"]
    Page --> Docs["JudicialDocument[]"]
    Docs --> Pdfs{"--pdfs?"}
    Pdfs -->|Si| Download["Descargar PDFs"]
    Pdfs -->|No| Output["JSONL + reportes"]
    Download --> Output
    Page --> Next{"Siguiente pagina?"}
    Next -->|Si| PagePost["POST paginacion AJAX"]
    PagePost --> Page
    Next -->|No| Output
```

## PDFs

PJ Peru expone PDFs por URL directa. OEFA usa acciones JSF con `ViewState`; algunos documentos son confidenciales y no exponen PDF. Esos casos se registran como `confidential`, no como error del scraper.

| Estado | Significado |
| --- | --- |
| `downloaded` | PDF descargado |
| `skippedExisting` | PDF ya existia en disco |
| `confidential` | Documento valido sin PDF publico |
| `missingJsfAction` | No se encontro accion JSF para descargar |
| `missingPdfUrl` | Documento sin URL directa |
| `failedDownload` | Hubo intento real y fallo |

## Paralelizacion

La interfaz recomendada siempre es npm:

```bash
npm run scrape:oefa:parallel
npm run scrape:pjperu:districts
npm run scrape:pjperu:suprema:years
```

Los runners internos particionan el trabajo:

- OEFA: por sector;
- PJ Peru Superior: por distrito judicial;
- PJ Peru Suprema: por año, porque no tiene filtro de distrito.

## Mapa de Lectura del Codigo

Lee en este orden. Cada capa depende de la anterior.

### Capa 1 - Contratos

| Archivo | Que define |
| --- | --- |
| `src/types.ts` | `JudicialDocument`, `SiteConfig`, `ScrapeOptions` |
| `src/models/internalTypes.ts` | `Session`, `ParsedPage`, `ParsedRow`, `$Root` |
| `src/models/metrics.ts` | `RunMetrics`, `PdfFailure`, `PageEvent`, `PdfDownloadResult` |
| `src/models/scraperTypes.ts` | `SectorResult`, `SectorContext`, `PageMetrics`, `AdvancePageCtx` |
| `src/models/pdfTypes.ts` | `PagePdfStats`, `PdfBatchInput`, `PdfCandidate`, `PdfDownloadConfig` |
| `src/models/jsfTypes.ts` | `PaginationRequest` y tipos JSF |

### Capa 2 - Sesion HTTP

| Archivo | Que hace |
| --- | --- |
| `src/session/cookies.ts` | Jar manual de cookies |
| `src/session/rateLimit.ts` | Detecta rate-limit por contenido o 429 |
| `src/session/retry.ts` | Retry con jitter |
| `src/session/session.ts` | Cliente axios, headers, sockets y start page |

### Capa 3 - Protocolo JSF

| Archivo | Que hace |
| --- | --- |
| `src/jsf/viewState.ts` | Extrae `javax.faces.ViewState` del HTML inicial |
| `src/jsf/partialResponse.ts` | Parsea la envoltura XML de respuestas AJAX JSF |
| `src/jsf/actionLink.ts` | Parsea onclick `mojarra.jsfcljs` para links de PDF (OEFA) |
| `src/jsf/searchForm.ts` | Envia formulario de busqueda (AJAX o clasico con redirect) |
| `src/jsf/pagination.ts` | Avanza paginas por AJAX (PrimeFaces o RichFaces) |

### Capa 4 - Parsers HTML

| Archivo | Que hace |
| --- | --- |
| `src/parser/paginatorParser.ts` | Lee pagina actual, total y registros |
| `src/parser/rowParser.ts` | Extrae filas PrimeFaces o RichFaces |
| `src/parser/documentMapper.ts` | Convierte filas a `JudicialDocument` |
| `src/parser/pageParser.ts` | Construye un `ParsedPage` completo |

### Capa 5 - PDF

| Archivo | Que hace |
| --- | --- |
| `src/pdf/downloader.ts` | Descarga PDF directo o via accion JSF |
| `src/scraper/pdfBatch.ts` | Clasifica candidatos y descarga en batches |

### Capa 6 - Scraping

Cada archivo tiene una sola responsabilidad. Los orquestadores (`sectorScraper.ts`, `scraper.ts`) usan comentarios de seccion (`// ── Fase ──`) para que la ejecucion se lea como una narrativa lineal sin tener que rastrear funciones auxiliares.

**Helpers (funciones puras, sin efectos de red ni disco):**

| Archivo | Que hace |
| --- | --- |
| `src/scraper/sectorHelpers.ts` | Limites, duraciones, deteccion de condiciones de paginador |
| `src/scraper/paginationHelpers.ts` | Avance de pagina, fusion de estado, resolucion de siguiente pagina |
| `src/scraper/softBlock.ts` | Detecta y registra el patron soft-block (HTTP 200 con AJAX vacio consecutivo) |
| `src/scraper/pageEvents.ts` | Construye eventos de pagina (exito/soft-block) para el reporte de ejecucion |

**Bucle de paginacion (sectorScraper):**

| Archivo | Que hace |
| --- | --- |
| `src/scraper/sectorScraper.ts` | Ciclo Bootstrap → Busqueda → Paginas → PDFs → Checkpoint |

**Bucle de sectores (scraper):**

| Archivo | Que hace |
| --- | --- |
| `src/scraper/sectorDiscovery.ts` | Descubre sectores disponibles en el portal |
| `src/scraper/sectorLoop.ts` | Resolucion de sectores, reintento por sector y pausas entre sectores |
| `src/scraper/runStats.ts` | Calcula estadisticas finales y registra resumenes de ejecucion |
| `src/scraper/runOutput.ts` | Escribe JSONL y reporte de PDFs fallidos en disco |
| `src/scraper/scraper.ts` | Orquestador principal: Setup → Sectores → Salida → Metricas → Reporte |

### Capa 7 - Entrada y Paralelismo

| Archivo | Que hace |
| --- | --- |
| `package.json` | Comandos npm portables para Ubuntu, Windows y CI |
| `src/config.ts` | Configuracion por sitio: URLs, selectores, columnas y tiempos |
| `src/config/constants.ts` | Constantes numericas y strings del sistema |
| `src/cli.ts` | Flags CLI y arranque |
| `scripts/` | Implementaciones internas llamadas por los comandos npm |

## Licencia

MIT.
