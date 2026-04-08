import { redirect } from 'next/navigation'

export default function OutboundPage() {
  redirect('/phone?tab=campaigns')
}
