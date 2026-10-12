// Pure text helper shared by the server (/api/append) and the page: add one line at the end of a "## Heading" section of a markdown file.
// No imports on purpose. Line endings of the file are kept (CRLF files get CRLF), code blocks are never mistaken for headings.

const FENCE = /^\s*(```|~~~)/;
// an empty list item a template leaves behind ("- [ ] " or "- ") is replaced by the first real line
const EMPTY_ITEM = /^\s*[-*+]\s*(\[ \])?\s*$/;

export function appendUnder(text: string, heading: string, line: string): string {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const want = heading.trim().toLowerCase();
  let fence = '', start = -1, level = 0, end = lines.length;
  // frontmatter is skipped so a "## x" inside it is never matched
  let i = 0;
  if (lines[0] === '---') { const close = lines.indexOf('---', 1); if (close > 0) i = close + 1; }
  for (; i < lines.length; i++) {
    const f = lines[i].match(FENCE);
    if (f) { if (!fence) fence = f[1]; else if (f[1] === fence) fence = ''; continue; }
    if (fence) continue;
    const h = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!h) continue;
    if (start < 0 && h[2].trim().toLowerCase() === want) { start = i; level = h[1].length; continue; }
    if (start >= 0 && h[1].length <= level) { end = i; break; }
  }
  if (start < 0) {
    // no such section yet: add it at the end of the file
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join(eol) + `${eol}${eol}## ${heading.trim()}${eol}${eol}${line}${eol}`;
  }
  let last = end - 1;
  while (last > start && lines[last].trim() === '') last--;
  if (last > start && EMPTY_ITEM.test(lines[last])) { lines[last] = line; return lines.join(eol); }
  // directly under the heading there is one blank line, then the items
  const insertAt = last + 1;
  const add = last === start ? ['', line] : [line];
  lines.splice(insertAt, 0, ...add);
  // keep a blank line before the next heading
  if (last === start && insertAt + add.length < lines.length && lines[insertAt + add.length].trim() !== '' && end < lines.length) lines.splice(insertAt + add.length, 0, '');
  return lines.join(eol);
}
