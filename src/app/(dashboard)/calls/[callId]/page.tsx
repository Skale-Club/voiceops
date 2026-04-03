import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { buildTimeline } from '@/lib/calls/timeline'
import { CallDetailHeader } from '@/components/calls/call-detail-header'
import { CallTranscript } from '@/components/calls/call-transcript'
import type { ArtifactMessage } from '@/types/vapi'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>
}) {
  const { callId } = await params
  const supabase = await createClient()

  const { data: call, error } = await supabase
    .from('calls')
    .select('*')
    .eq('id', callId)
    .single()

  if (error || !call) notFound()

  const { data: actionLogs } = await supabase
    .from('action_logs')
    .select('*')
    .eq('vapi_call_id', call.vapi_call_id)
    .order('created_at', { ascending: true })

  const turns = call.started_at
    ? buildTimeline(
        (call.transcript_turns as ArtifactMessage[]) ?? [],
        actionLogs ?? [],
        call.started_at
      )
    : []

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <Link
        href="/calls"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Calls
      </Link>
      <CallDetailHeader call={call} />
      <CallTranscript timeline={turns} />
    </div>
  )
}
