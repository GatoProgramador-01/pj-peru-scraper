/**
 * JSF AJAX responses arrive as a partial-response XML envelope:
 *
 *   <partial-response>
 *     <changes>
 *       <update id="formId:dataTable"><![CDATA[<table>...</table>]]></update>
 *       <update id="javax.faces.ViewState"><![CDATA[token...]]></update>
 *     </changes>
 *   </partial-response>
 *
 * Two things are extracted:
 *   - newViewState: the refreshed server-side state token — must be sent with every
 *     subsequent request or the server will reject it as a stale session.
 *   - html: the data table fragment to parse for rows. A page can have multiple
 *     <update> CDATA blocks (metadata, hidden fields, etc.); the longest one is
 *     always the data table.
 */
export const extractPartialResponse = (xml: string): { html: string | null; newViewState: string | null } => {
  const vsMatch = xml.match(/<update[^>]+id="[^"]*javax\.faces\.ViewState[^"]*"[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/update>/);
  const newViewState = vsMatch ? vsMatch[1].trim() : null;
  const allCdata = [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)]
    .map(m => m[1])
    .filter(s => /<\s*(tr|table|tbody|div)\b/i.test(s));
  // Multiple CDATA blocks may exist; the data table is always the largest one.
  const html = allCdata.sort((a, b) => b.length - a.length)[0] ?? null;
  return { html, newViewState };
};
