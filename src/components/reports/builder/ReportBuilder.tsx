'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PRESET_VIEWS, TOURISM_EXAMPLE_COLUMNS } from '@/lib/report-presets'
import { currentUrlFor } from '@/lib/return-to'
import { ENTITY_LABELS } from '@/server/reports/engine/types'
import type { FieldMeta, ReportDefinition, ReportEntity, ReportRow, RunRequest, RunResult, SavedReport } from '@/server/reports/engine/types'
import { BulkActionsBar } from './BulkActionsBar'
import { ColumnsPicker } from './ColumnsPicker'
import { ExportDialog } from './ExportDialog'
import { FilterBuilder } from './FilterBuilder'
import { ResultsTable } from './ResultsTable'
import { SaveReportDialog } from './SaveReportDialog'
import { SavedReportsList } from './SavedReportsList'
import { api, btnLink, btnPrimary, btnSecondary, conditionComplete, decodeRequest, definitionOf, emptyRequest, encodeRequest, ENTITIES, fetchAllRows, type TagOption, type TeamUser } from './shared'

type Tab = 'tracking' | 'builder'
type UrlPatch = { tab?: Tab | null; d?: RunRequest | null; saved?: string | null; preset?: string | null }

const withPaging = (definition: ReportDefinition): RunRequest => ({ ...definition, page: 1, pageSize: 25 })
const DEFAULT_DRAFT = emptyRequest('suppliers')

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      <p className="mt-0.5 text-sm text-muted">{hint}</p>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * דוחות ומעקב. Two tabs over one results area: מעקב offers the ready-made
 * views and the team's shared reports as cards; מחולל דוחות builds one from
 * scratch — what to see, conditions, columns, then "הצג דוח".
 *
 * The URL is what is shown: `?d=` (base64url JSON of the request, written
 * on "הצג דוח", sort and paging), `?saved=` a saved report, `?preset=` a
 * preset. Back, forward, refresh and a shared link all reproduce it. What is
 * being edited but not yet shown stays local to the screen.
 */
export function ReportBuilder() {
  const params = useSearchParams()
  const pathname = usePathname()
  const tab: Tab = params.get('tab') === 'builder' ? 'builder' : 'tracking'
  const dParam = params.get('d')
  const savedId = params.get('saved')
  const presetKey = params.get('preset')

  const [saved, setSaved] = useState<SavedReport[] | null>(null)
  const [fieldsByEntity, setFieldsByEntity] = useState<Partial<Record<ReportEntity, FieldMeta[]>>>({})
  const [fieldsError, setFieldsError] = useState<string | null>(null)
  const [team, setTeam] = useState<TeamUser[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [tourismCampaign, setTourismCampaign] = useState<string | null>(null)
  const [selected, setSelected] = useState<Map<string, ReportRow>>(new Map())
  const [allMatching, setAllMatching] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [saving, setSaving] = useState<{ existing: SavedReport | null } | null>(null)

  // What is shown, derived from the URL (a saved report waits for the list).
  const savedDefinition = !dParam && savedId ? saved?.find((r) => r.id === savedId)?.definition : undefined
  const savedJson = savedDefinition ? JSON.stringify(savedDefinition) : ''
  const ranKey = dParam ? `d:${dParam}` : savedId ? `saved:${savedId}` : presetKey ? `preset:${presetKey}` : ''
  const ran = useMemo<RunRequest | null>(() => {
    if (ranKey.startsWith('d:')) return decodeRequest(ranKey.slice(2))
    if (ranKey.startsWith('saved:')) return savedJson ? withPaging(JSON.parse(savedJson) as ReportDefinition) : null
    if (ranKey.startsWith('preset:')) {
      const preset = PRESET_VIEWS.find((p) => p.key === ranKey.slice(7))
      return preset ? withPaging(preset.definition) : null
    }
    return null
  }, [ranKey, savedJson])

  // The run: re-fetched when the URL's definition changes, or when a nonce says "again".
  const [nonce, setNonce] = useState(0)
  const runKey = `${ranKey}#${savedJson.length}#${nonce}`
  const [answer, setAnswer] = useState<{ key: string; result: RunResult | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!ran) return
    let cancelled = false
    api<RunResult>('/api/reports/run', ran)
      .then((r) => !cancelled && setAnswer({ key: runKey, result: r, error: null }))
      .catch((e: unknown) => !cancelled && setAnswer({ key: runKey, result: null, error: e instanceof Error ? e.message : 'הדוח לא נטען.' }))
    return () => {
      cancelled = true
    }
  }, [ran, runKey])
  const result = ran ? (answer?.result ?? null) : null
  const loading = ran !== null && answer?.key !== runKey
  const error = ran && answer?.key === runKey ? answer.error : null

  // What is being edited: starts from what is shown, and follows it when the URL changes from outside.
  const [draftState, setDraftState] = useState<RunRequest | null>(null)
  const [prevRanKey, setPrevRanKey] = useState(ranKey)
  const [pushedKey, setPushedKey] = useState<string | null>(null)
  if (ranKey !== prevRanKey) {
    setPrevRanKey(ranKey)
    if (ranKey !== pushedKey) setDraftState(null)
  }
  const draft = draftState ?? ran ?? DEFAULT_DRAFT

  // A different filter is a different selection.
  const filterKey = ran ? JSON.stringify([ran.entity, ran.clauses]) : ''
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setSelected(new Map())
    setAllMatching(false)
  }

  const writeUrl = useCallback(
    (patch: UrlPatch, mode: 'push' | 'replace') => {
      const next = new URLSearchParams(window.location.search)
      const set = (key: string, value: string | null | undefined) => (value ? next.set(key, value) : value === null ? next.delete(key) : undefined)
      set('tab', patch.tab === 'tracking' ? null : patch.tab)
      set('d', patch.d === null ? null : patch.d ? encodeRequest(patch.d) : undefined)
      set('saved', patch.saved)
      set('preset', patch.preset)
      const query = next.toString()
      window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', query ? `${pathname}?${query}` : pathname)
    },
    [pathname],
  )

  const clearSelection = useCallback(() => {
    setSelected(new Map())
    setAllMatching(false)
  }, [])

  /** Show a definition chosen from a card, a saved report or the example. */
  const load = useCallback(
    (patch: UrlPatch) => {
      setDraftState(null)
      writeUrl(patch, 'push')
    },
    [writeUrl],
  )

  /** Show `request`: it becomes the URL, and the draft keeps its half-written rows. */
  function showRequest(request: RunRequest, nextDraft: RunRequest, mode: 'push' | 'replace') {
    setDraftState(nextDraft)
    setPushedKey(`d:${encodeRequest(request)}`)
    writeUrl({ d: request }, mode)
  }

  function show() {
    const clauses = draft.clauses.map((c) => ({ any: c.any.filter((cond) => conditionComplete(fields ?? [], cond)) })).filter((c) => c.any.length > 0)
    showRequest({ ...draft, clauses, page: 1 }, { ...draft, page: 1 }, 'push')
  }

  function rerun(patch: Partial<RunRequest>) {
    if (!ran) return
    const next = { ...ran, ...patch }
    showRequest(next, { ...draft, sort: next.sort, page: next.page, pageSize: next.pageSize }, 'replace')
  }

  // The reference lists, once.
  useEffect(() => {
    void api<{ users: TeamUser[] }>('/api/team').then((d) => setTeam(d.users ?? [])).catch(() => setTeam([]))
    void api<{ tags: TagOption[] }>('/api/tags?kind=company').then((d) => setTags(d.tags ?? [])).catch(() => setTags([]))
    void api<{ campaigns: { id: string }[] }>('/api/campaigns/search?q=%D7%94%D7%AA%D7%99%D7%99%D7%A8%D7%95%D7%AA&limit=1').then((d) => setTourismCampaign(d.campaigns?.[0]?.id ?? null)).catch(() => setTourismCampaign(null))
  }, [])

  const loadSaved = useCallback(() => api<{ reports: SavedReport[] }>('/api/reports/saved').then((d) => setSaved(d.reports ?? [])).catch(() => setSaved([])), [])
  useEffect(() => void loadSaved(), [loadSaved])

  // Fields for the entity being built or shown.
  const needed = [draft.entity, ran?.entity].filter((e): e is ReportEntity => Boolean(e)).join(',')
  useEffect(() => {
    for (const entity of needed.split(',') as ReportEntity[]) {
      if (fieldsByEntity[entity]) continue
      void api<{ fields: FieldMeta[] }>(`/api/reports/fields?entity=${entity}`)
        .then((d) => setFieldsByEntity((current) => ({ ...current, [entity]: d.fields })))
        .catch((e: unknown) => setFieldsError(e instanceof Error ? e.message : 'לא הצלחנו לטעון את השדות.'))
    }
    // The cache itself is what the effect fills; re-running on its change would only loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed])

  const fields = fieldsByEntity[draft.entity] ?? null
  const ranFields = ran ? (fieldsByEntity[ran.entity] ?? []) : []
  const returnTo = currentUrlFor(pathname, params)
  const current = savedId ? (saved?.find((r) => r.id === savedId) ?? null) : null
  const dirty = ran ? JSON.stringify(definitionOf(draft)) !== JSON.stringify(definitionOf(ran)) : false
  const visibleColumns = draft.columns.length ? draft.columns : (fields ?? []).filter((f) => f.defaultVisible).map((f) => f.key)

  function loadExample() {
    if (!tourismCampaign) return
    const request: RunRequest = {
      entity: 'suppliers',
      clauses: [
        { any: [{ field: 'campaigns', op: 'one_of', value: [tourismCampaign] }] },
        { any: [{ field: 'data_source', op: 'is', value: 'xtra' }] },
        { any: [{ field: 'signature_status', op: 'is', value: 'signed' }] },
        { any: [{ field: 'task_status', op: 'not_one_of', value: ['done', 'not_needed'] }] },
      ],
      columns: TOURISM_EXAMPLE_COLUMNS,
      sort: null,
      page: 1,
      pageSize: 25,
    }
    load({ tab: 'builder', d: request, saved: null, preset: null })
  }

  const selectedCount = allMatching ? (result?.total ?? 0) : selected.size
  const resolveRows = useCallback(
    async (onProgress: (n: number) => void) => {
      if (allMatching && ran) return fetchAllRows(ran, onProgress)
      return { rows: [...selected.values()], capped: false }
    },
    [allMatching, ran, selected],
  )

  const card = (on: boolean) => `min-h-24 rounded-2xl border p-4 text-start transition hover:border-brand ${on ? 'border-brand bg-blue-50/60' : 'border-line bg-surface'}`

  const tabButton = (key: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === key} onClick={() => writeUrl({ tab: key }, 'push')} className={`inline-flex min-h-12 flex-1 items-center justify-center rounded-xl px-4 text-base font-semibold transition sm:flex-none sm:px-8 ${tab === key ? 'bg-slate-800 text-white' : 'border border-line bg-surface text-fg hover:border-brand'}`}>
      {label}
    </button>
  )

  const resultsArea = ran ? (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-fg">{ENTITY_LABELS[ran.entity].label}</h2>
        {tab === 'tracking' ? (
          <button type="button" onClick={() => writeUrl({ tab: 'builder' }, 'push')} className={btnSecondary}>
            פתח במחולל
          </button>
        ) : null}
        <button type="button" onClick={() => setExporting(true)} disabled={!result} className={btnSecondary}>
          ייצוא לאקסל
        </button>
        <button type="button" onClick={() => setSaving({ existing: tab === 'tracking' ? null : current })} disabled={!result} className={btnSecondary}>
          {tab === 'tracking' ? 'שמור בשם אחר' : 'שמור דוח'}
        </button>
        {dirty && tab === 'builder' ? <span className="text-sm text-amber-800">ההגדרות השתנו — לחצו ״הצג דוח״ לרענון.</span> : null}
      </div>
      <ResultsTable
        request={ran}
        result={result}
        loading={loading}
        error={error}
        fields={ranFields}
        selected={selected}
        allMatching={allMatching}
        onToggle={(row) =>
          setSelected((cur) => {
            const next = new Map(cur)
            if (next.has(row.id)) next.delete(row.id)
            else next.set(row.id, row)
            return next
          })
        }
        onTogglePage={(rows, on) =>
          setSelected((cur) => {
            const next = new Map(cur)
            for (const row of rows) if (on) next.set(row.id, row)
            else next.delete(row.id)
            return next
          })
        }
        onAllMatching={setAllMatching}
        onSort={(field) => rerun({ sort: { field, dir: ran.sort?.field === field && ran.sort.dir === 'asc' ? 'desc' : 'asc' }, page: 1 })}
        onPage={(page) => rerun({ page })}
        onPageSize={(pageSize) => rerun({ pageSize, page: 1 })}
        onRetry={() => setNonce((n) => n + 1)}
        returnTo={returnTo}
      />
    </div>
  ) : null

  return (
    <div className={`mt-5 flex flex-col gap-5 ${selectedCount > 0 ? 'pb-28' : ''}`}>
      <div role="tablist" aria-label="דוחות ומעקב" className="flex gap-2">
        {tabButton('tracking', 'מעקב')}
        {tabButton('builder', 'מחולל דוחות')}
      </div>

      {tab === 'tracking' ? (
        <>
          <Section title="תצוגות מעקב" hint="בחרו מה לבדוק הבוקר: כל כרטיס פותח רשימה מוכנה שאפשר לסנן ולפעול עליה.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PRESET_VIEWS.map((preset) => (
                <button key={preset.key} type="button" aria-pressed={presetKey === preset.key} onClick={() => load({ tab: null, preset: preset.key, saved: null, d: null })} className={card(presetKey === preset.key)}>
                  <span className="block text-base font-bold text-fg">{preset.label}</span>
                  <span className="mt-1 block text-sm text-muted">{preset.blurb}</span>
                </button>
              ))}
            </div>
          </Section>
          {saved && saved.some((r) => r.shared) ? (
            <Section title="הדוחות שלנו" hint="דוחות שחברי הצוות שמרו ושיתפו.">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {saved
                  .filter((r) => r.shared)
                  .map((report) => (
                    <button key={report.id} type="button" aria-pressed={savedId === report.id} onClick={() => load({ tab: null, saved: report.id, preset: null, d: null })} className={card(savedId === report.id)}>
                      <span className="block text-base font-bold text-fg">{report.name}</span>
                      <span className="mt-1 block text-sm text-muted">
                        {ENTITY_LABELS[report.definition.entity].label} · {report.ownerName ?? 'ללא שם'}
                      </span>
                    </button>
                  ))}
              </div>
            </Section>
          ) : null}
          {resultsArea}
        </>
      ) : (
        <>
          <Section title="מה רוצים לראות?" hint="כל דוח מתחיל מסוג אחד של שורות.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {ENTITIES.map((entity) => (
                <button key={entity} type="button" aria-pressed={draft.entity === entity} onClick={() => entity !== draft.entity && setDraftState({ ...emptyRequest(entity), pageSize: draft.pageSize })} className={`min-h-20 rounded-2xl border p-3 text-start transition hover:border-brand ${draft.entity === entity ? 'border-brand bg-blue-50/60' : 'border-line bg-surface'}`}>
                  <span className="block text-base font-bold text-fg">{ENTITY_LABELS[entity].label}</span>
                  <span className="mt-1 block text-xs text-muted">{ENTITY_LABELS[entity].blurb}</span>
                </button>
              ))}
            </div>
            {tourismCampaign ? (
              <button type="button" onClick={loadExample} className={`${btnLink} mt-3`}>
                הדוגמה של משרד התיירות
              </button>
            ) : null}
          </Section>

          <Section title="סינון" hint="הוסיפו תנאים; תנאים באותה מסגרת הם ״או״, מסגרות שונות הן ״וגם״. בלי תנאים — כל הרשומות.">
            {fields ? <FilterBuilder fields={fields} clauses={draft.clauses} onChange={(clauses) => setDraftState({ ...draft, clauses })} team={team} tags={tags} /> : <p className={`text-sm ${fieldsError ? 'text-danger' : 'text-muted'}`}>{fieldsError ?? 'טוען שדות…'}</p>}
          </Section>

          <Section title="עמודות" hint="מה יופיע בכל שורה, ובאיזה סדר.">
            {fields ? (
              <div className="flex flex-wrap items-center gap-2">
                <ColumnsPicker fields={fields} columns={visibleColumns} onChange={(columns) => setDraftState({ ...draft, columns })} />
                <span className="text-sm text-muted">{visibleColumns.map((key) => fields.find((f) => f.key === key)?.label ?? key).join(' · ')}</span>
              </div>
            ) : (
              <p className="text-sm text-muted">טוען שדות…</p>
            )}
          </Section>

          <button type="button" onClick={show} disabled={!fields || loading} className={`${btnPrimary} w-full sm:w-auto sm:min-w-48`} data-testid="run-report">
            {loading ? 'טוען…' : 'הצג דוח'}
          </button>

          {resultsArea}

          <Section title="דוחות שמורים" hint="דוחות שנשמרו — שלי ושל הצוות. לחיצה פותחת אותם כאן.">
            {saved ? <SavedReportsList reports={saved} currentId={savedId} onOpen={(report) => load({ tab: 'builder', saved: report.id, preset: null, d: null })} onChanged={() => void loadSaved()} /> : <p className="text-sm text-muted">טוען…</p>}
          </Section>
        </>
      )}

      {ran ? (
        <BulkActionsBar
          entity={ran.entity}
          count={selectedCount}
          allMatching={allMatching}
          resolveRows={resolveRows}
          fields={ranFields}
          team={team}
          onDone={() => {
            clearSelection()
            setNonce((n) => n + 1)
          }}
          onClear={clearSelection}
        />
      ) : null}
      {exporting && ran ? <ExportDialog open onClose={() => setExporting(false)} definition={definitionOf(ran)} total={result?.total ?? 0} selectedIds={allMatching ? [] : [...selected.keys()]} fields={ranFields} /> : null}
      {saving && ran ? (
        <SaveReportDialog
          open
          onClose={() => setSaving(null)}
          definition={definitionOf(ran)}
          existing={saving.existing}
          onSaved={(report) => {
            void loadSaved()
            writeUrl({ saved: report.id, preset: null }, 'replace')
          }}
        />
      ) : null}
    </div>
  )
}
