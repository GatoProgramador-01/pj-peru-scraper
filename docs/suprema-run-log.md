# Suprema Parallel Run — Live Extraction Log

**Script:** `scripts/parallel-suprema-years.mjs`
**Configuración:** 20 años (2007–2026) · 12 workers paralelos · sin PDFs
**Inicio:** 2026-06-27 20:02 (hora local)
**Rama:** `feat/pj-peru-full-extraction`
**VPN:** IP compartida peruana activa

---

## Snapshot 1 — 20:21 (~19 min desde inicio)

| Año | Docs | Velocidad | Página | Estado |
|-----|-----:|----------:|-------:|--------|
| 2026 | 1,410 | 78 docs/min | p.141 | ✅ activo |
| 2023 | 1,300 | 73 docs/min | p.130 | ✅ activo |
| 2019 | 1,360 | 76 docs/min | p.136 | ✅ activo |
| 2014 | 1,240 | 75 docs/min | p.124 | ✅ activo |
| 2020 | 1,220 | 68 docs/min | p.122 | ✅ activo |
| 2011 | 1,060 | 69 docs/min | p.106 | ✅ activo |
| 2009 | 950 | 71 docs/min | p.95 | ✅ activo |
| 2007 | 350 | 83 docs/min | p.35 | ✅ activo |
| 2012 | — | — | — | ✅ activo (sin datos recientes en log) |
| 2008 | — | — | — | ✅ activo (sin datos recientes en log) |
| 2017 | parcial | — | — | ❌ soft-block abort (~16m7s) |
| 2016 | parcial | — | — | ❌ soft-block abort (~13m40s) |
| 2025 | parcial | — | — | ❌ soft-block abort (~13m49s) |
| 2010 | parcial | — | — | ❌ soft-block abort (~10m55s) |
| 2022 | mínimo | — | — | ❌ soft-block abort (~4m40s) |
| 2021 | mínimo | — | — | ❌ soft-block abort (~2m56s) |
| 2015 | mínimo | — | — | ❌ soft-block abort (~2m33s) |
| 2018 | mínimo | — | — | ❌ soft-block abort (~1m32s) |
| 2024 | mínimo | — | — | ❌ soft-block abort (~1m46s) |
| 2013 | mínimo | — | — | ❌ soft-block abort (~59s) |

**Docs visibles acumulados (workers activos):** ~9,000+
**Workers activos:** 10 de 20
**Workers fallidos:** 10 — todos por saturación de pool JSF (soft-block), no HTTP 429

### Observaciones técnicas
- Los 6 años que fallaron en < 3 min (2013, 2018, 2024, 2015, 2021, 2022) encontraron el pool JSF saturado antes de completar la primera página efectiva. Causa: 12 workers arrancando en paralelo compiten por ViewState slots.
- Los 4 años que fallaron a los 10-16 min (2010, 2025, 2016, 2017) alcanzaron ~900-1000 docs antes de ser bloqueados silenciosamente.
- El servidor usa **saturación silenciosa** (empty AJAX partial response) en lugar de HTTP 429 — por eso `total429: 0` en todas las ejecuciones.
- Los 10 años activos mantienen velocidad sostenida de 68–83 docs/min.

### Plan de retry post-run
Todos los años fallidos son reintentables con `--concurrency 1` para evitar competencia:
```bash
node scripts/parallel-suprema-years.mjs \
  --years 2013,2015,2016,2017,2018,2021,2022,2024,2025,2010 \
  --concurrency 1 \
  --resume
```

---

<!-- SNAPSHOTS SIGUIENTES SE AGREGAN ABAJO -->
