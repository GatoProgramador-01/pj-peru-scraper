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

Si hay VPN peruana:

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
| Resultado observado | ~43,160 docs en run principal |
| Retry observado | `npm run scrape:pjperu:suprema:years:retry` |
| Total combinado observado | ~43,750 docs |
| Velocidad principal | ~80-89 docs/min por worker activo |
| Velocidad retry | ~120 docs/min en 1 worker |

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

## Soft-Block No Es HTTP 429

PJ Peru puede devolver HTTP 200 con respuesta AJAX parcial vacia. Si el scraper aceptara eso como pagina vacia, truncaria resultados. Por eso `sectorScraper.ts` aborta despues de 3 paginas vacias consecutivas.

El evento esperado queda en `page-events.jsonl`:

```text
soft_block_abort
```

Despues se usa el checkpoint:

```bash
npm run scrape:pjperu:suprema:years:retry
```

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

## Lo Que No Es Parte Del Camino Principal

El diagrama `docs/parallel-architecture.excalidraw` conserva ideas de arquitectura futura y comparaciones de optimizacion. No es necesario para validar el scraper actual. Para revisar lo implementado, usar README + este runbook + tests.
