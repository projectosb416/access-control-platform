/**
 * Minimal CSV parser for admin bulk-import flows.
 *
 * Scope:
 *   - Header row required.
 *   - Each subsequent non-blank line is a record.
 *   - Fields delimited by comma.
 *   - Fields may be quoted with double-quotes ("...").
 *   - Inside a quoted field, a literal double-quote is written as "".
 *   - CRLF or LF line endings both accepted.
 *   - UTF-8 BOM at start of file stripped.
 *   - Trailing newline tolerated.
 *
 * Explicitly NOT supported in v1:
 *   - Newlines inside quoted fields (would need multi-line record parsing).
 *   - Alternate delimiters (semicolon, tab).
 *   - Alternate quoting characters.
 *
 * If a future import needs these, replace this parser with papaparse
 * or extend the state machine here — do not silently add partial support.
 *
 * Errors thrown are Error with message:
 *   CSV_EMPTY                — input contains no non-blank lines.
 *   CSV_UNBALANCED_QUOTE     — a quoted field was not closed before end of line.
 */

export interface ParsedCsv {
  headers: string[]
  rows: Array<Record<string, string>>
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

  const rawLines = clean.split('\n')
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop()
  }

  if (rawLines.length === 0) {
    throw new Error('CSV_EMPTY')
  }

  const records = rawLines.map(parseLine)
  const headers = records[0].map((h) => h.trim())

  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw new Error('CSV_EMPTY')
  }

  const rows = records.slice(1).map((cells) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })

  return { headers, rows }
}

function parseLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  let i = 0

  while (i < line.length) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }

    if (ch === ',') {
      out.push(cur)
      cur = ''
      i++
      continue
    }

    cur += ch
    i++
  }

  if (inQuotes) {
    throw new Error('CSV_UNBALANCED_QUOTE')
  }

  out.push(cur)
  return out
}
