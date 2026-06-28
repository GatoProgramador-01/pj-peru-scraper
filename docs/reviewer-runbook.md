# Reviewer Runbook

Este documento complementa al README. Su objetivo es dar contexto operativo: que se corrio, cuanto duro, como se valida en Ubuntu y cual es la politica de retry.

## Ruta Recomendada Para Un Reviewer

En una maquina limpia:

```bash
npm ci
npm run ci
npm run verify:local
```

Si no hay VPN peruana, quedarse en OEFA:

```bash
npm run scrape:oefa:test100
```

Si hay VPN peruana, verificar primero la conectividad al portal:

```bash
curl -s --max-time 5 -o /dev/null -w "%{http_code}" https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml
# esperar 200; cualquier otro codigo o timeout indica que la VPN no esta activa o no rutea Peru
```

Luego correr:

```bash
npm run scrape:pjperu:smoke
npm run scrape:pjperu:suprema:years:dry
```

No es necesario invocar `node scripts/*.mjs` directamente. Los comandos npm son la interfaz estable y funcionan igual en Ubuntu y Windows.

## Corrida Real Actual

Run de referencia: PJ Peru Suprema particionado por anio, con VPN peruana, sin PDFs.

| Dato | Valor |
| --- | --- |
| Fecha | 2026-06-27 |
| Comando base | `npm run scrape:pjperu:suprema:years` |
| Particion | 2007-2026 por anio |
| Concurrencia principal | 12 workers |
| Duracion observada | ~73 min de run principal |
| Resultado observado | ~43,160 docs en run principal (PJ Peru Suprema) |
| Retry observado | `npm run scrape:pjperu:suprema:years:retry` |
| Total combinado observado | ~43,750 docs |
| Velocidad principal | ~80-89 docs/min por worker activo |
| Velocidad retry | ~120 docs/min en 1 worker |

Run secundario: PJ Peru Superior con PDFs y OEFA con PDFs.

| Portal | PDFs descargados |
| --- | --- |
| PJ Peru Superior | ~499 PDFs |
| OEFA | ~670 PDFs |

Lectura: el scraper sostuvo cerca de una hora de extraccion real. Los workers con soft-block no demostraron bug de parser; demostraron contencion del pool JSF del portal. Al bajar a retry secuencial, el mismo flujo acelero porque dejo de competir por ViewState.

## Politica De Retry

Hay dos familias de error.

| Error | Senal | Manejo |
| --- | --- | --- |
| HTTP 429, timeout o fallo transitorio | Excepcion HTTP/request | `withRetry()` hace hasta 3 intentos con jitter |
| Soft-block JSF | 3 respuestas AJAX vacias consecutivas | Se registra `soft_block_abort`, se guarda checkpoint y se reintenta con `--resume` |

Comandos:

```bash
npm run simulate:429
npm run scrape:pjperu:suprema:years:retry
```

`simulate:429` prueba la logica sin depender del portal real. `years:retry` corre con concurrencia 1 para eliminar contencion de ViewState.

## Soft-Block: El Caso Real Encontrado (Equivalente A HTTP 429)

Durante las corridas reales de PJ Peru Suprema no se observo ningun HTTP 429.
Lo que si se observo fue su equivalente funcional: el portal devolvio HTTP 200 con
cuerpo AJAX vacio en paginas consecutivas, sin ningun codigo de error.

Este comportamiento se llama soft-block y es la forma en que PJ Peru (RichFaces) expresa
contencion del pool JSF cuando hay muchos workers compitiendo por el mismo ViewState.
El efecto es identico al 429: el portal deja de entregar datos, pero lo hace silenciosamente.

**Por que es un problema si no se detecta:** si el scraper aceptara un 200-con-AJAX-vacio
como pagina sin resultados, truncaria el run sin ningun error visible. Los documentos
restantes se perderian y el output pareceria completo.

**Como lo maneja el scraper:** `sectorScraper.ts` cuenta las paginas vacias consecutivas.
Al llegar a 3 (`CONSECUTIVE_EMPTY_ABORT`), registra `soft_block_abort`, guarda checkpoint
y termina el sector. El runner puede retomarlo con `--resume`.

Para verificar que esto ocurrio en un run, buscar en `page-events.jsonl`:

```bash
grep "soft_block" output/*/page-events.jsonl
```

El evento queda registrado asi:

```json
{"type":"soft_block_abort","sectorId":"2026","pageIndex":4,"docsThisPage":0,...}
```

Para reanudar los sectores que quedaron incompletos por soft-block:

```bash
npm run scrape:pjperu:suprema:years:retry
```

`years:retry` baja la concurrencia a 1 worker para eliminar la contencion de ViewState,
que es la causa raiz del soft-block en corridas paralelas.

## Paralelizacion Por Anio

Suprema no tiene filtro de distrito. La forma de partir el trabajo es por rango de fechas:

- un worker consulta 2007;
- otro consulta 2008;
- y asi hasta 2026.

Eso evita solapamiento de paginas y permite validar escala sin un solo proceso larguisimo. El comando publico es:

```bash
npm run scrape:pjperu:suprema:years
```

Para reviewers, usar primero:

```bash
npm run scrape:pjperu:suprema:years:dry
npm run scrape:pjperu:suprema:years:test
```

## Paralelizacion Por Distrito

Superior si tiene distrito judicial, asi que se parte por distrito:

```bash
npm run scrape:pjperu:districts:dry
npm run scrape:pjperu:districts:test
npm run scrape:pjperu:districts
```

Si un distrito queda incompleto por soft-block, la salida y el checkpoint permiten retomar. Para la revision inicial, basta con `districts:dry` o `districts:test`.

## Que Revisar En La Salida

| Archivo | Que mirar |
| --- | --- |
| `run-summary.json` | Totales, retries, 429, PDFs |
| `page-events.jsonl` | `pageScraped` y posibles `soft_block_abort` |
| `failed-pdfs.json` | Distinguir confidenciales de fallos reales |
| `checkpoint_*.json` | `completed: true` para particiones completas |
| `*.jsonl` | Un documento por linea |

### Diferencia entre `downloaded` y `skippedExisting`

Ambos cuentan como "PDFs obtenidos" en `run-summary.json`, pero tienen distinto significado:

- `downloaded`: el archivo no existia localmente; se descargo ahora.
- `skippedExisting`: el archivo ya existia en `pdfDir` con el mismo nombre; no se volvio a descargar.

En un primer run se esperan casi todos `downloaded`. En un re-run con `--resume` sobre el mismo `--pdf-dir`, la mayoria aparece como `skippedExisting` porque los archivos ya estan en disco. Ambos incrementan `pdfCompleted` y se muestran en la linea de progreso de la terminal.

## Runs De Produccion Completos (varias horas)

Estos se lanzan una vez validado el smoke test y el test run. Dejarlos corriendo sin supervisar; el scraper escribe checkpoint por sector/anio.

### PJ Peru Suprema — todos los anios (2007-2026)

```bash
npm run scrape:pjperu:suprema:years
```

| Parametro | Valor |
| --- | --- |
| Particion | 20 workers, uno por anio |
| Concurrencia | 12 workers en paralelo |
| Duracion estimada | ~73-90 min |
| Docs esperados | ~43,000-44,000 |
| PDFs | No (sin `--pdfs`; agregar si se quiere) |

Si alguna particion queda incompleta (soft-block), reanudar con:

```bash
npm run scrape:pjperu:suprema:years:resume
```

O solo los anios fallidos:

```bash
npm run scrape:pjperu:suprema:years:retry
```

### PJ Peru Superior — todos los distritos

```bash
npm run scrape:pjperu:districts
```

| Parametro | Valor |
| --- | --- |
| Particion | 34 distritos judiciales |
| Concurrencia | 20 workers, 10 PDFs c/u |
| Duracion estimada | ~2-4 horas (con PDFs) |
| Docs esperados | ~499+ PDFs observados en run parcial |

Reanudar incompletos:

```bash
npm run scrape:pjperu:districts:resume
```

### OEFA — extraccion completa

```bash
npm run scrape:oefa:parallel
```

| Parametro | Valor |
| --- | --- |
| Sectores | todos (mineria, energia, pesca...) |
| Concurrencia | 20 PDFs por sector |
| Duracion estimada | ~1-2 horas |
| PDFs esperados | ~670+ observados en run parcial |

Reanudar:

```bash
npm run scrape:oefa:parallel:resume
```

### Notas generales para runs largos

- Todos escriben en `output/` con subcarpeta propia. No sobreescriben runs anteriores.
- Si la VPN se cae a mitad, el checkpoint guarda el progreso. Reconectar VPN y usar el comando `:resume` correspondiente.
- Monitorear `output/*/run-summary.json` para ver totales en tiempo real (se actualiza al finalizar cada sector).

## Lo Que No Es Parte Del Camino Principal

El diagrama `docs/parallel-architecture.excalidraw` conserva ideas de arquitectura futura y comparaciones de optimizacion. No es necesario para validar el scraper actual. Para revisar lo implementado, usar README + este runbook + tests.
