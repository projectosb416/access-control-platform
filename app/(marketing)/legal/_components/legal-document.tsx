import type { ReactNode } from 'react'

/**
 * Shared renderer for legal documents.
 *
 * Content files export a Section[] array. This component renders it
 * with semantic HTML and no new dependency — no markdown parser, no
 * prose plugin.
 *
 * If we ever need richer formatting (footnotes, cross-references),
 * extend the Section union. Do not add a parser.
 */

export type Section =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; text: ReactNode }
  | { type: 'list'; items: ReactNode[] }
  | { type: 'table'; headers: string[]; rows: ReactNode[][] }

export function LegalDocument({
  title,
  effectiveDate,
  sections,
}: {
  title: string
  effectiveDate: string
  sections: Section[]
}) {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Effective {effectiveDate}
        </p>
      </header>

      <div className="flex flex-col gap-6 text-sm leading-relaxed">
        {sections.map((s, i) => (
          <SectionBlock key={i} section={s} />
        ))}
      </div>
    </article>
  )
}

function SectionBlock({ section }: { section: Section }) {
  switch (section.type) {
    case 'h2':
      return (
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          {section.text}
        </h2>
      )
    case 'h3':
      return (
        <h3 className="mt-2 text-base font-medium tracking-tight">
          {section.text}
        </h3>
      )
    case 'p':
      return <p className="text-muted-foreground">{section.text}</p>
    case 'list':
      return (
        <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5">
          {section.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b">
                {section.headers.map((h, i) => (
                  <th
                    key={i}
                    className="py-2 pr-4 text-left font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, i) => (
                <tr key={i} className="border-b border-border/40">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="text-muted-foreground py-2 pr-4 align-top"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}
