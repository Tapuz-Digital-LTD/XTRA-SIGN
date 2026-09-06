import { EmptyState } from '@/components/EmptyState'

/**
 * "הפצות": every SMS/email send the campaign made through Inforu, and the
 * door to a new one. A campaign with none simply says so.
 */
export function DistributionsTab({ projectId }: { projectId: string }) {
  return (
    <EmptyState
      title="עדיין אין הפצות"
      description="הפצה היא שליחת SMS ו/או אימייל לקהל שבוחרים — קישור לעמוד הקמפיין, כתובת אחרת, קובץ או הסכם אישי לחתימה. לקמפיין יכולות להיות כמה הפצות, או אף אחת."
      actionIcon="+"
      actionLabel="הפצה חדשה"
      actionHref={`/projects/${projectId}?tab=distributions&new=1`}
    />
  )
}
