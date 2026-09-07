'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { DeleteDialog } from '@/components/deletion/DeleteDialog'
import { RowMenu } from '@/components/deletion/RowMenu'
import { currentUrlFor, withReturnTo } from '@/lib/return-to'

/** The campaign row's quiet corner: open, settings, archive in or out, and delete under the policy. */
export function ProjectRowMenu({ projectId, archived, isAdmin }: { projectId: string; archived: boolean; isAdmin: boolean }) {
  const router = useRouter()
  const here = currentUrlFor(usePathname(), useSearchParams())
  const [removing, setRemoving] = useState(false)

  async function toggleArchive() {
    await fetch(`/api/groups/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: archived ? 'unarchive' : 'archive' }),
    })
    router.refresh()
  }

  return (
    <>
      <RowMenu
        items={[
          { label: 'פתיחה', onSelect: () => router.push(withReturnTo(`/projects/${projectId}`, here)) },
          { label: 'הגדרות', onSelect: () => router.push(withReturnTo(`/projects/${projectId}?tab=settings`, here)) },
          { label: archived ? 'החזר לפעילים' : 'העבר לארכיון', onSelect: () => void toggleArchive() },
          { label: 'מחיקה', danger: true, onSelect: () => setRemoving(true) },
        ]}
      />
      <DeleteDialog
        type="project"
        id={projectId}
        noun="פרויקט"
        isAdmin={isAdmin}
        open={removing}
        onClose={() => setRemoving(false)}
        onDone={() => {
          setRemoving(false)
          router.refresh()
        }}
      />
    </>
  )
}
