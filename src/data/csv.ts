/** Minimal quoted-CSV line splitter (handles "" as an escaped quote), same approach as the desktop app. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

/** Parses a full CSV file's text into an array of field->value records, keyed by the header row. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/);
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = parseCsvLine(headerLine);

  const records: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = parseCsvLine(line);
    const record: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      const key = headers[h];
      if (key !== undefined) record[key] = values[h] ?? "";
    }
    records.push(record);
  }
  return records;
}
