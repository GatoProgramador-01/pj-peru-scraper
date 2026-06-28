import { describe, it, expect } from 'vitest';
import { parseJsfActionLink } from '../../src/jsf/actionLink.js';

describe('parseJsfActionLink', () => {
  it('returns componentId and paramUuid from a valid mojarra.jsfcljs onclick', () => {
    // The component ID key equals its own value (OEFA pattern: self-referencing key).
    const onclick =
      "mojarra.jsfcljs(document.getElementById('formBuscador')," +
      "{'formBuscador:j_idt100':'formBuscador:j_idt100','param_uuid':'abc-123-def'}," +
      "'')";
    const result = parseJsfActionLink(onclick);
    expect(result).not.toBeNull();
    expect(result!.componentId).toBe('formBuscador:j_idt100');
    expect(result!.paramUuid).toBe('abc-123-def');
  });

  it('returns null when onclick is undefined', () => {
    expect(parseJsfActionLink(undefined)).toBeNull();
  });

  it('returns null when onclick does not contain mojarra.jsfcljs', () => {
    const onclick = "window.open('/some/url')";
    expect(parseJsfActionLink(onclick)).toBeNull();
  });

  it('returns null when onclick has mojarra.jsfcljs but no param_uuid key', () => {
    const onclick =
      "mojarra.jsfcljs(document.getElementById('form')," +
      "{'form:btn':'form:btn'}," +
      "'')";
    expect(parseJsfActionLink(onclick)).toBeNull();
  });

  it('returns empty string for componentId when no self-referencing key exists', () => {
    const onclick =
      "mojarra.jsfcljs(document.getElementById('form')," +
      "{'keyA':'valueB','param_uuid':'uuid-999'}," +
      "'')";
    const result = parseJsfActionLink(onclick);
    expect(result).not.toBeNull();
    expect(result!.paramUuid).toBe('uuid-999');
    expect(result!.componentId).toBe('');
  });
});
