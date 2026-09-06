'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DeleteDialog } from '@/components/deletion/DeleteDialog'
import { RowMenu } from '@/components/deletion/RowMenu'

/** The row's quiet corner: open, archive in or out, and delete under the policy. */
export function ProjectRowMenu({ projectId, archived, isAdmin }: { projectId: string; archived: boolean; isAdmin: boolean }) {
  const router = useRouter()
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
          { label: 'פתיחה', onSelect: () => router.push(`/projects/${projectId}`) },
          { label: 'הגדרות', onSelect: () => router.push(`/projects/${projectId}?tab=settings`) },
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
