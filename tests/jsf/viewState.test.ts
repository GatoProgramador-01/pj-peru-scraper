import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractViewState, extractFormId } from '../../src/jsf/viewState.js';

describe('extractViewState', () => {
  it('returns the ViewState value when the input is present', () => {
    const $ = cheerio.load(
      '<form id="myForm"><input name="javax.faces.ViewState" value="token123" /></form>',
    );
    expect(extractViewState($)).toBe('token123');
  });

  it('throws when there is no javax.faces.ViewState input', () => {
    const $ = cheerio.load('<form id="myForm"><input name="other" value="x" /></form>');
    expect(() => extractViewState($)).toThrow(
      'javax.faces.ViewState not found — page may require JS rendering',
    );
  });
});

describe('extractFormId', () => {
  it('returns the form id when a form element has one', () => {
    const $ = cheerio.load('<form id="myForm"><input name="x" /></form>');
    expect(extractFormId($)).toBe('myForm');
  });

  it('returns "form" as the default when there is no form element', () => {
    const $ = cheerio.load('<div>no form here</div>');
    expect(extractFormId($)).toBe('form');
  });

  it('returns "form" as the default when the form element has no id', () => {
    const $ = cheerio.load('<form><input name="x" /></form>');
    expect(extractFormId($)).toBe('form');
  });
});
