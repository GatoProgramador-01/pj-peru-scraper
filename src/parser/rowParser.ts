import type { $Root, ParsedRow } from '../models/internalTypes.js';
import type { SiteConfig } from '../types.js';
import { parseJsfActionLink } from '../jsf/actionLink.js';

/** Parse labeled div blocks like <div class="txtbold">Label:</div><div>Value</div>. */
const extractLabeledField = ($: $Root, container: ReturnType<$Root>, label: string): string => {
  const block = container.find('.txtbold').filter((_, el) => $(el).text().trim().startsWith(label));
  return block.next().text().trim();
};

/** pj-peru: results are RF repeat panels, not <tr> rows. Each panel has header + body divs.
 *  Selector uses div.rf-p class — stable across JSF sessions (j_idtXXX suffix changes per session).
 */
const parseRichFacesRepeatRows = ($: $Root, baseUrl: string): ParsedRow[] => {
  const panels = $('div.rf-p[id^="formBuscador:repeat:"]').toArray();
  return panels.map(panel => {
    const $el = $(panel);
    const headerSpans = $el.find('.rf-p-hdr span[style*="bold"]').toArray();
    const tipoRecurso = $(headerSpans[0])?.text().trim() ?? '';
    const expediente = $(headerSpans[1])?.text().trim() ?? '';

    const body = $el.find('.rf-p-b').first();
    const pretension     = extractLabeledField($, body, 'Pretensión');
    const tipoResolucion = extractLabeledField($, body, 'Tipo Resolución');
    const fechaResolucion = extractLabeledField($, body, 'Fecha Resolución');
    const sala           = extractLabeledField($, body, 'Sala');
    const sumilla        = extractLabeledField($, body, 'Sumilla');
    const palabrasClave  = extractLabeledField($, body, 'Palabras Clave');
    const fallo          = extractLabeledField($, body, 'Fallo de la Resolución');
    const juecesRaw      = extractLabeledField($, body, 'Jueces');
    const proceso        = extractLabeledField($, body, 'Proceso');
    const distritoJudicialProcedencia = extractLabeledField($, body, 'Distrito Judicial de Procedencia');
    const expedienteProcedencia       = extractLabeledField($, body, 'Expediente de Procedencia');
    const fechaResolucionProcedencia  = extractLabeledField($, body, 'Fecha de Resolución de Procedencia');
    // Exact match "Fallo:" from procedencia — avoids collision with "Fallo de la Resolución:"
    const falloProcedencia = body.find('.txtbold')
      .filter((_, el) => $(el).text().trim().replace(/:\s*$/, '') === 'Fallo')
      .first().next().text().trim();

    const pdfAnchor = $el.find('a[href*="ServletDescarga"]').first();
    const rawHref = pdfAnchor.attr('href') ?? null;
    const pdfUrl = rawHref
      ? (rawHref.startsWith('http') ? rawHref : `${baseUrl}${rawHref.startsWith('/') ? '' : '/'}${rawHref}`)
      : null;

    const cells = [tipoRecurso, expediente, pretension, tipoResolucion, fechaResolucion, sala, sumilla];
    return {
      cells, pdfUrl, pdfJsfAction: null,
      tipoRecurso, sumilla, palabrasClave,
      fallo, juecesRaw, proceso,
      distritoJudicialProcedencia, expedienteProcedencia,
      fechaResolucionProcedencia, falloProcedencia,
    } satisfies ParsedRow;
  }).filter(row => row.cells.some(c => c.length > 0));
};

export const parseRows = ($: $Root, config: SiteConfig, baseUrl: string): ParsedRow[] => {
  if (config.rowParser === 'richfacesRepeat') return parseRichFacesRepeatRows($, baseUrl);
  return ($(config.selectors.rows).length ? $(config.selectors.rows) : $('tr[data-ri]'))
    .toArray()
    .map(tr => {
      const cells = $(tr).find('td').toArray().map(td => $(td).text().trim());
      const pdfEl = $(tr).find(config.selectors.pdfLink).first();
      const rawHref = pdfEl.attr('href') ?? null;
      const isAnchorOrVoid = !rawHref || rawHref === '#' || rawHref.startsWith('javascript');
      const pdfUrl = isAnchorOrVoid
        ? null
        : rawHref.startsWith('http')
          ? rawHref
          : `${baseUrl}/${rawHref.replace(/^\//, '')}`;
      const pdfJsfAction = isAnchorOrVoid ? parseJsfActionLink(pdfEl.attr('onclick')) : null;
      return { cells, pdfUrl, pdfJsfAction } satisfies ParsedRow;
    })
    .filter(row => row.cells.some(c => c.length > 0));
};
