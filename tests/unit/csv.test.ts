import { describe, it, expect } from 'vitest'
import { parseCsv } from '@/lib/admin/csv'

describe('parseCsv', () => {
  it('throws CSV_EMPTY on empty input', () => {
    expect(() => parseCsv('')).toThrow('CSV_EMPTY')
  })

  it('returns no rows for a header-only file', () => {
    const result = parseCsv('label,notes\n')
    expect(result.headers).toEqual(['label', 'notes'])
    expect(result.rows).toEqual([])
  })

  it('parses a simple two-row file', () => {
    const result = parseCsv('label,notes\nHouse 1,corner\nHouse 2,')
    expect(result.rows).toEqual([
      { label: 'House 1', notes: 'corner' },
      { label: 'House 2', notes: '' },
    ])
  })

  it('handles quoted fields containing commas', () => {
    const result = parseCsv('label,notes\n"Flat 3, Block B",top floor')
    expect(result.rows[0].label).toBe('Flat 3, Block B')
    expect(result.rows[0].notes).toBe('top floor')
  })

  it('unescapes double-quotes inside quoted fields', () => {
    const result = parseCsv('label,notes\n"Say ""hi""",ok')
    expect(result.rows[0].label).toBe('Say "hi"')
  })

  it('strips a UTF-8 BOM from the first header', () => {
    const result = parseCsv('\uFEFFlabel,notes\nA,')
    expect(result.headers).toEqual(['label', 'notes'])
    expect(result.rows[0].label).toBe('A')
  })

  it('normalizes CRLF line endings', () => {
    const result = parseCsv('label,notes\r\nA,x\r\nB,y\r\n')
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ label: 'A', notes: 'x' })
    expect(result.rows[1]).toEqual({ label: 'B', notes: 'y' })
  })

  it('tolerates a missing trailing newline', () => {
    const result = parseCsv('label,notes\nA,x')
    expect(result.rows).toEqual([{ label: 'A', notes: 'x' }])
  })

  it('fills missing trailing cells with empty strings', () => {
    const result = parseCsv('label,notes\nA')
    expect(result.rows[0]).toEqual({ label: 'A', notes: '' })
  })

  it('throws CSV_UNBALANCED_QUOTE on unclosed quoted field', () => {
    expect(() => parseCsv('label,notes\n"unclosed,ok')).toThrow(
      'CSV_UNBALANCED_QUOTE',
    )
  })
})
