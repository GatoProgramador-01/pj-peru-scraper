import type { $Root } from '../models/internalTypes.js';

export const extractViewState = ($: $Root): string => {
  const vs = $('input[name="javax.faces.ViewState"]').first().val();
  if (!vs) throw new Error('javax.faces.ViewState not found — page may require JS rendering');
  return String(vs);
};

export const extractFormId = ($: $Root): string =>
  $('form').first().attr('id') ?? 'form';
