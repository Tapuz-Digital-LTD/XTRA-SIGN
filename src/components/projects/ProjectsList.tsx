'use client'

import { useRouter } from 'next/navigation'
import { ProjectRowMenu } from '@/components/projects/ProjectRowMenu'

/**
 * The projects screen: a plain list. A row answers "how is it going" in one
 * glance — suppliers, signed, waiting, when anything last moved — and opens
 * on click. Anything rarer lives behind the row's ⋯ menu.
 */

export type ProjectRow = {
  id: string
  name: string
  companyCount: number
  signed: number
  pending: number
  /** ISO string; null when nothing was ever sent. */
  lastActivityAt: string | null
  archived: boolean
}

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

function statusChip(project: ProjectRow) {
  if (project.signed + project.pending === 0)
    return <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">חדש</span>
  if (project.pending > 0)
    return <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">בתהליך</span>
  return <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">הושלם</span>
}

export function ProjectsList({ projects }: { projects: ProjectRow[] }) {
  const router = useRouter()

  return (
    <>
      {/* Phones get compact rows; the table needs six columns. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {projects.map((project) => (
          <li
            key={project.id}
            onClick={() => router.push(`/projects/${project.id}`)}
            className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-fg">{project.name}</span>
                {statusChip(project)}
              </span>
              <span className="mt-1 block text-xs text-muted">
                {project.companyCount} ספקים · {project.signed} נחתמו · {project.pending} ממתינים
                {project.lastActivityAt ? ` · ${dateFormat.format(new Date(project.lastActivityAt))}` : ''}
              </span>
            </span>
            <ProjectRowMenu projectId={project.id} archived={project.archived} />
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface sm:block">
        <table className="w-full min-w-[44rem] table-fixed text-start text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="w-[34%] px-4 py-3 text-start font-medium">פרויקט</th>
              <th className="w-[11%] px-3 py-3 text-center font-medium">ספקים</th>
              <th className="w-[11%] px-3 py-3 text-center font-medium">נחתמו</th>
              <th className="w-[11%] px-3 py-3 text-center font-medium">ממתינים</th>
              <th className="w-[15%] px-4 py-3 text-start font-medium">פעילות אחרונה</th>
              <th className="w-[12%] px-4 py-3 text-start font-medium">סטטוס</th>
              <th className="w-14 px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr
                key={project.id}
                onClick={() => router.push(`/projects/${project.id}`)}
                className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-bg"
              >
                <td className="truncate px-4 py-3 font-medium text-fg" title={project.name}>
                  {project.name}
                </td>
                <td className="px-3 py-3 text-center tabular-nums text-fg">{project.companyCount}</td>
                <td className="px-3 py-3 text-center">
                  {project.signed > 0 ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{project.signed}</span>
                  ) : (
                    <span className="text-muted">0</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {project.pending > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{project.pending}</span>
                  ) : (
                    <span className="text-muted">0</span>
                  )}
                </td>
                <td className="truncate px-4 py-3 text-xs text-muted">
                  {project.lastActivityAt ? dateFormat.format(new Date(project.lastActivityAt)) : '—'}
                </td>
                <td className="px-4 py-3">{statusChip(project)}</td>
                <td className="px-2 py-3">
                  <ProjectRowMenu projectId={project.id} archived={project.archived} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
