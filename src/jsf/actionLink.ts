import type { JsfAction } from '../models/internalTypes.js';

/**
 * mojarra.jsfcljs is the JSF client-side submit mechanism OEFA uses for PDF links.
 * Instead of a plain <a href>, each row renders an onclick that POSTs the enclosing
 * form with extra hidden parameters — there is no direct URL to follow.
 *
 * We extract two values from that call:
 *   - componentId: identifies the server-side JSF component that handles the PDF action.
 *   - paramUuid:   a per-row UUID that carries the reference to the actual file.
 *
 * Both are forwarded by pdf/downloader.ts as POST body fields when requesting the file.
 */
export const parseJsfActionLink = (onclick: string | undefined): JsfAction | null => {
  if (!onclick || !onclick.includes('mojarra.jsfcljs')) return null;
  const m = onclick.match(/mojarra\.jsfcljs\s*\([^,]+,\s*\{([^}]+)\}/);
  if (!m) return null;
  const pairs = [...m[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)];
  const map: Record<string, string> = {};
  for (const [, k, v] of pairs) map[k] = v;
  const paramUuid = map['param_uuid'];
  if (!paramUuid) return null;
  // In OEFA's pattern the component ID is self-referencing: the key equals its own value.
  const componentId = Object.entries(map).find(([k, v]) => k === v)?.[0] ?? '';
  return { componentId, paramUuid };
};
