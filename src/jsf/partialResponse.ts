export const extractPartialResponse = (xml: string): { html: string | null; newViewState: string | null } => {
  const vsMatch = xml.match(/<update[^>]+id="[^"]*javax\.faces\.ViewState[^"]*"[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/update>/);
  const newViewState = vsMatch ? vsMatch[1].trim() : null;
  const allCdata = [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)]
    .map(m => m[1])
    .filter(s => /<\s*(tr|table|tbody|div)\b/i.test(s));
  const html = allCdata.sort((a, b) => b.length - a.length)[0] ?? null;
  return { html, newViewState };
};
