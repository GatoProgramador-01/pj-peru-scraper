# Codex Task — Review, Docs Update & Architecture Brief

**Rama:** `feat/pj-peru-full-extraction`
**Prioridad:** Alta — el repo va a revisión humana externa pronto
**Contexto:** Claude Code acaba de completar dos rondas de refactoring. El código está limpio pero falta documentación de arquitectura para que el revisor entienda el sistema sin leer el código completo.

---

## Commits a revisar (desde el último review de Codex)

```
c0068de  refactor: reduce all functions to ≤4 params, extract pipeline helpers, name conditionals
4342bc8  docs: restructure README to solution+runbook only, move error catalog to jsf-error-log.md
1ed2c1a  refactor: extract constants, eliminate dead code, reduce downloader to ≤4 params
53cdc27  docs: add suprema-run-log.md — live extraction metrics for deliverable
```

Haz `git diff c9d3634..HEAD` para ver todos los cambios desde la última sesión de Codex.

---

## Tarea 1 — Code Review del diff

Revisa todos los cambios de los 4 commits. Para cada archivo modificado, reporta:
- ¿Hay algo que se rompió silenciosamente?
- ¿Hay asunciones incorrectas en los nuevos tipos/interfaces?
- ¿Algún import faltante o tipo inconsistente?
- ¿El refactor de `RunReportInput` (se eliminó `failedPdfs`) se propagó correctamente a todos los call sites?

Reporta issues concretos con archivo:línea. Si no hay issues, confirmar explícitamente.

---

## Tarea 2 — Actualizar `docs/interview-deliverable.md`

El archivo actual describe el estado anterior al refactoring. Actualiza:
1. La sección de estructura de módulos — ahora hay nuevos tipos: `SectorContext`, `PaginationRequest`, `SearchTarget`, `SearchFilter`, `DocumentMappingCtx`, `PdfBatchInput`, `PdfBatchOptions`, `JsfPdfTarget`, `PdfDownloadConfig`
2. La sección de evidencia técnica — mencionar que todas las funciones tienen ≤4 parámetros
3. Cualquier referencia a rutas o nombres de función que hayan cambiado

No cambies el requirements matrix ni las secciones de evidencia de runs — esas siguen siendo válidas.

---

## Tarea 3 — Escribir `docs/architecture-deep-dive.md`

Crea un documento nuevo (~300-400 palabras) que explica el sistema a un revisor que no conoce el código. Estructura:

```markdown
# Arquitectura — JSF HTTP Scraper

## El problema que resuelve
## Flujo de una extracción (paso a paso en código)
## Por qué axios+cheerio y no Playwright
## Cómo funciona la sesión JSF
## Cómo se maneja la paginación (PrimeFaces vs RichFaces)
## Cómo se paraleliza sin duplicar datos
## Archivos clave para leer primero
```

Sé concreto: cita `src/scraper/sectorScraper.ts`, `src/jsf/searchForm.ts`, etc. El revisor debe poder navegar directamente al código relevante.

---

## Tarea 4 — Actualizar `docs/human-test-plan.md`

El README ahora tiene "Etapas de Verificación" (6 etapas numeradas). Alinea `human-test-plan.md` con esas etapas:
- Si tiene pasos que contradicen el README, corrige
- Si tiene pasos más detallados que el README, consérvalo
- Añade referencia a las nuevas etapas de verificación del README

---

## Entrega esperada

Al terminar, reporta:
- Issues encontrados en review (o "ninguno")
- Archivos modificados
- Resumen en ≤150 palabras de qué quedó listo para entrega
