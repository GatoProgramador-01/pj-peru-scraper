import type { $Root, ParsedRow } from '../models/internalTypes.js';
import type { SiteConfig } from '../types.js';
import { parseJsfActionLink } from '../jsf/actionLink.js';

export const parseRows = ($: $Root, config: SiteConfig, baseUrl: string): ParsedRow[] =>
  $(config.selectors.rows)
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
