'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ColumnsPicker } from '@/components/reports/builder/ColumnsPicker'
import type { FormColumn } from '@/lib/form-columns'

/**
 * "עמודות" beside the joining tab's export: which of the form's answers this
 * campaign's tables and files show. Every change is saved on the project at
 * once and the tables behind the dialog redraw, so what is picked is what
 * the next person opens — and what the file carries.
 */
export function JoiningColumns({ projectId, options, chosen }: { projectId: string; options: FormColumn[]; chosen: string[] }) {
  const router = useRouter()
  const [columns, setColumns] = useState(chosen)
  const [error, setError] = useState<string | null>(null)
  const fields = options.map((c) => ({ key: c.key, label: c.label, type: 'text' as const, defaultVisible: false, filterable: false, sortable: false, group: 'שדות הטופס' }))

  async function save(next: string[]) {
    setColumns(next)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/columns`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columns: next }) })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(data?.error?.message ?? 'לא הצלחנו לשמור את העמודות.')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא הצלחנו לשמור את העמודות.')
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <ColumnsPicker fields={fields} columns={columns} onChange={(next) => void save(next)} title="עמודות מהטופס" hint="סמנו אילו תשובות מהטופס יופיעו כעמודות בטבלאות ובקובץ של הקמפיין הזה. הבחירה נשמרת לקמפיין." orderTitle="הסדר בטבלה" />
      {error ? (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      ) : null}
    </span>
  )
}
