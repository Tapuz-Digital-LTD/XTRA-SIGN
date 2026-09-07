'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ProjectRowMenu } from '@/components/projects/ProjectRowMenu'
import { currentUrlFor, withReturnTo } from '@/lib/return-to'
import { audienceLabel, entryLabel, goalLabel, type CampaignGoal, type CampaignKind, type EntryMethod } from '@/lib/campaigns'

/**
 * The campaigns screen: a plain list. A row answers "how is it going" in
 * one glance — kind, status, people, registrations when it has a door,
 * signed, when anything last moved — and opens on click. Anything rarer
 * lives behind the row's ⋯ menu.
 */

export type ProjectRow = {
  id: string
  name: string
  campaignKind: CampaignKind
  goal: CampaignGoal
  entry: EntryMethod
  /** Who it is for; null (or absent) means suppliers and customers alike. */
  kind?: 'supplier' | 'customer' | null
  companyCount: number
  registrations: number
  signed: number
  pending: number
  /** ISO string; null when nothing was ever sent. */
  lastActivityAt: string | null
  startsAt: string | null
  endsAt: string | null
  archived: boolean
}

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

function statusChip(project: ProjectRow) {
  const now = Date.now()
  if (project.archived) return <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">בארכיון</span>
  if (project.endsAt && new Date(project.endsAt).getTime() < now)
    return <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">הסתיים</span>
  if (project.startsAt && new Date(project.startsAt).getTime() > now)
    return <span className="whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">מתוכנן</span>
  if (project.signed + project.pending + project.registrations === 0)
    return <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">חדש</span>
  return <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">פעיל</span>
}

/** One badge, never wrapped: what the campaign is for. How people come in is a quiet line under the name. */
function kindChip(project: { goal: CampaignGoal; entry: EntryMethod }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${project.goal === 'signing' ? 'bg-blue-50 text-blue-800' : 'bg-emerald-50 text-emerald-800'}`}>{goalLabel(project.goal)}</span>
  )
}

export function ProjectsList({ projects, isAdmin }: { projects: ProjectRow[]; isAdmin: boolean }) {
  const router = useRouter()
  // The campaigns list as filtered: a campaign opened from it comes back here.
  const here = currentUrlFor(usePathname(), useSearchParams())

  return (
    <>
      {/* Phones get compact rows; the table needs eight columns. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {projects.map((project) => (
          <li
            key={project.id}
            onClick={() => router.push(withReturnTo(`/projects/${project.id}`, here))}
            className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-fg">{project.name}</span>
                {kindChip(project)}
              </div>
              <p className="mt-1 text-xs text-muted">
                {audienceLabel(project.kind ?? null)}
                {` · ${project.companyCount} ${project.campaignKind === 'public' ? 'ספקים' : 'נמענים'}`}
                {project.campaignKind === 'public' ? ` · ${project.registrations} הרשמות` : ''}
                {` · ${project.signed} חתמו`}
                {project.pending > 0 ? ` · ${project.pending} ממתינים` : ''}
              </p>
              <p className="mt-1 text-xs text-muted">{project.lastActivityAt ? `פעילות אחרונה ${dateFormat.format(new Date(project.lastActivityAt))}` : 'עדיין ללא פעילות'}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {statusChip(project)}
              <ProjectRowMenu projectId={project.id} archived={project.archived} isAdmin={isAdmin} />
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface sm:block">
        <table className="w-full min-w-[52rem] table-fixed text-start text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="w-[26%] px-4 py-3 text-start font-medium">קמפיין</th>
              <th className="w-[14%] px-3 py-3 text-start font-medium">סוג</th>
              <th className="w-[10%] px-3 py-3 text-start font-medium">סטטוס</th>
              <th className="w-[10%] px-3 py-3 text-center font-medium">נמענים</th>
              <th className="w-[9%] px-3 py-3 text-center font-medium">הרשמות</th>
              <th className="w-[9%] px-3 py-3 text-center font-medium">נחתמו</th>
              <th className="w-[12%] px-4 py-3 text-start font-medium">פעילות אחרונה</th>
              <th className="w-14 px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr
                key={project.id}
                onClick={() => router.push(withReturnTo(`/projects/${project.id}`, here))}
                className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-bg"
              >
                <td className="px-4 py-3" title={project.name}>
                  <span className="block truncate font-medium text-fg">{project.name}</span>
                  <span className="block truncate text-xs text-muted">{entryLabel(project.entry)} · {audienceLabel(project.kind ?? null)}</span>
                </td>
                <td className="px-3 py-3">{kindChip(project)}</td>
                <td className="px-3 py-3">{statusChip(project)}</td>
                <td className="px-3 py-3 text-center tabular-nums text-fg">{project.companyCount}</td>
                <td className="px-3 py-3 text-center tabular-nums text-fg">{project.campaignKind === 'public' ? project.registrations : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-3 text-center">
                  {project.signed > 0 ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{project.signed}</span>
                  ) : (
                    <span className="text-muted">0</span>
                  )}
                  {project.pending > 0 ? <span className="ms-1 text-xs text-muted">+{project.pending} ממתינים</span> : null}
                </td>
                <td className="truncate px-4 py-3 text-xs text-muted">
                  {project.lastActivityAt ? dateFormat.format(new Date(project.lastActivityAt)) : '—'}
                </td>
                <td className="px-2 py-3">
                  <ProjectRowMenu projectId={project.id} archived={project.archived} isAdmin={isAdmin} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
