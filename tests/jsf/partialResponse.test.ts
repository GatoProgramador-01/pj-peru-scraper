import { describe, it, expect } from 'vitest';
import { extractPartialResponse } from '../../src/jsf/partialResponse.js';

const buildXml = (updates: { id: string; cdata: string }[]): string => {
  const blocks = updates
    .map(u => `<update id="${u.id}"><![CDATA[${u.cdata}]]></update>`)
    .join('\n');
  return `<partial-response><changes>\n${blocks}\n</changes></partial-response>`;
};

describe('extractPartialResponse', () => {
  it('returns html and newViewState from a well-formed partial-response', () => {
    const xml = buildXml([
      { id: 'formId:dataTable', cdata: '<table><tr><td>row</td></tr></table>' },
      { id: 'javax.faces.ViewState', cdata: 'vs-token' },
    ]);
    const result = extractPartialResponse(xml);
    expect(result.html).toBe('<table><tr><td>row</td></tr></table>');
    expect(result.newViewState).toBe('vs-token');
  });

  it('returns the longest CDATA block as html when multiple content blocks exist', () => {
    const short = '<table><tr><td>A</td></tr></table>';
    const long = '<table>' + '<tr><td>row</td></tr>'.repeat(10) + '</table>';
    const xml = buildXml([
      { id: 'meta', cdata: short },
      { id: 'formId:dataTable', cdata: long },
      { id: 'javax.faces.ViewState', cdata: 'vs-token' },
    ]);
    const result = extractPartialResponse(xml);
    expect(result.html).toBe(long);
    expect(result.newViewState).toBe('vs-token');
  });

  it('returns newViewState null when there is no ViewState update', () => {
    const xml = buildXml([
      { id: 'formId:dataTable', cdata: '<table><tr><td>row</td></tr></table>' },
    ]);
    const result = extractPartialResponse(xml);
    expect(result.newViewState).toBeNull();
    expect(result.html).not.toBeNull();
  });

  it('returns html null when there are no CDATA blocks with HTML tags', () => {
    const xml = `<partial-response><changes>
<update id="javax.faces.ViewState"><![CDATA[vs-token]]></update>
</changes></partial-response>`;
    const result = extractPartialResponse(xml);
    expect(result.html).toBeNull();
    expect(result.newViewState).toBe('vs-token');
  });

  it('treats a CDATA block containing <div> as a valid html block', () => {
    const xml = buildXml([
      { id: 'formId:panel', cdata: '<div class="results"><p>content</p></div>' },
      { id: 'javax.faces.ViewState', cdata: 'vs-div' },
    ]);
    const result = extractPartialResponse(xml);
    expect(result.html).toBe('<div class="results"><p>content</p></div>');
    expect(result.newViewState).toBe('vs-div');
  });

  it('returns html null and newViewState null when the XML is empty', () => {
    const result = extractPartialResponse('<partial-response></partial-response>');
    expect(result.html).toBeNull();
    expect(result.newViewState).toBeNull();
  });
});
