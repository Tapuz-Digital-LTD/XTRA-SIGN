import { redirect } from 'next/navigation'

/** מעקב moved into דוחות ומעקב; old links land there. */
export default function TrackingPage() {
  redirect('/reports')
}
