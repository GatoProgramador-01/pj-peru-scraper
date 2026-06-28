# Codex Task — pj-peru full extraction (continuación)

**Repo:** GatoProgramador-01/pj-peru-scraper  
**Branch:** feat/pj-peru-full-extraction  
**Último commit:** cb2e3c0

---

## Contexto crítico (lee esto primero)

Portal: jurisprudencia.pj.gob.pe — RichFaces 4.2.2, requiere **VPN a Perú** (CyberGhost u otro).  
Sin VPN → 403 en todos los workers → los JSONL se crean vacíos.  
Esto ya pasó: un run con `--fresh-output` + VPN apagada destruyó todos los JSONL previos.  
Los 6,221 PDFs sobrevivieron en `output/pjperu-districts/pdfs/`.

### Cambios de esta sesión que debes conocer

| Commit | Qué hace |
|--------|----------|
| `72a16bc` | Docs se acumulan en memoria → un solo `writeFileSync` al final. Elimina duplicados por crash. |
| `33a4411` | maxSockets 64 (era 5 → 15 workers bloqueados). Resume solo usa `completed=true`. |
| `cb2e3c0` | Cada run → carpeta `output/runs/YYYY-MM-DD-HHMM/`. PDFs en `output/pdfs/` compartido. `--fresh-output` eliminado. |

---

## Tu trabajo

### 1. Verificar VPN antes de cualquier cosa
```bash
curl -s https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml \
  -o /dev/null -w "%{http_code}\n"
```
- `200` → continuar
- `403` → **detente**, conecta VPN a Perú, repite

### 2. Correr la extracción completa
```bash
cd C:\Users\lanitaEmperadora\Desktop\pj-peru-scraper
npm run build
npm run scrape:pjperu:districts
```
Esto lanza 20 workers en paralelo, 34 distritos (buCorte=2 = Superior, ~458,909 docs).  
Cada run crea su propia carpeta `output/runs/YYYY-MM-DD-HHMM/`.  
Los PDFs van a `output/pdfs/` (compartido, idempotente).

> Si quieres PDFs desde cero en el nuevo run, los 6,221 ya descargados se reutilizan automáticamente (skip por nombre de archivo).

### 3. Monitorear
Señales de run sano:
```
[18=LIMA] {"message":"Page scraped","page":"1/?","docsThisPage":10,...}
```
Señales de problema:
- `ERR 403` en todos → VPN caída, matar y reconectar
- `soft_block_abort` → distrito terminó temprano por páginas vacías con hasNextPage=true
- `exit 1` en un distrito → revisar stderr, relanzar ese distrito solo (ver paso 5)

### 4. Validar al terminar
```bash
node -e "
const fs = require('fs');
const runs = fs.readdirSync('output/runs').sort();
const lastRun = 'output/runs/' + runs[runs.length - 1];
const files = fs.readdirSync(lastRun).filter(f => f.endsWith('.jsonl'));
let total = 0;
for (const f of files) {
  const n = fs.readFileSync(lastRun+'/'+f,'utf8').trim().split('\n').filter(Boolean).length;
  total += n;
  console.log(n.toString().padStart(7), f);
}
console.log('TOTAL:', total, '/ esperado ~458909');
"
```

### 5. Relanzar distritos fallidos
```bash
# Reemplaza <ID> y <NAME> con los valores del distrito fallido
node dist/cli.js --site pj-peru --sector 2 --district <ID> \
  --out output/runs/<CARPETA-RUN>/district-<ID>-<NAME>.jsonl \
  --pdfs --pdf-dir output/pdfs --pdf-concurrency 5
```

### 6. Merge final
`parallel-districts.mjs` hace el merge automático a `all-districts.jsonl` al terminar.  
Verificar tamaño y hacer commit de los checkpoints como evidencia.

---

## Lo que NO debes hacer
- `--fresh-output` en ningún comando
- Tocar `src/scraper/scraper.ts`, `src/scraper/sectorScraper.ts`, `src/session/session.ts` — estables
- Borrar `output/pjperu-districts/pdfs/` — son los 6,221 PDFs previos (usa `output/pdfs/` para los nuevos)
- Correr sin VPN

---

## Mapa de distritos (34 total)
Ver `scripts/parallel-districts.mjs` → const DISTRICTS. IDs: 1-18, 19-29, 30-31, 38, 39, 41.
