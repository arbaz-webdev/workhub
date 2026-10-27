/**
 * Parses CSV text (RFC 4180: quoted fields, doubled quotes, newlines inside quotes, CRLF).
 * Excel in some locales saves with semicolons, and tab-separated files are common too,
 * so the delimiter is whichever of the three the header line uses most.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines (often at the end) aren't rows.
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** "E-mail Address" → "emailaddress", for matching headers to fields. */
export const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
