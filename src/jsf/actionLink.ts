import type { JsfAction } from '../models/internalTypes.js';

export const parseJsfActionLink = (onclick: string | undefined): JsfAction | null => {
  if (!onclick || !onclick.includes('mojarra.jsfcljs')) return null;
  const m = onclick.match(/mojarra\.jsfcljs\s*\([^,]+,\s*\{([^}]+)\}/);
  if (!m) return null;
  const pairs = [...m[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)];
  const map: Record<string, string> = {};
  for (const [, k, v] of pairs) map[k] = v;
  const paramUuid = map['param_uuid'];
  if (!paramUuid) return null;
  const componentId = Object.entries(map).find(([k, v]) => k === v)?.[0] ?? '';
  return { componentId, paramUuid };
};
