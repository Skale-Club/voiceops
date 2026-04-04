import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getKnowledgeSources, hasOpenAiIntegration } from '@/actions/knowledge'
import { DocumentList } from '@/components/knowledge/document-list'
import { UploadForm } from '@/components/knowledge/upload-form'
import { OpenAiBanner } from '@/components/knowledge/openai-banner'

export default async function KnowledgePage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const [sources, hasOpenAi] = await Promise.all([
    getKnowledgeSources(),
    hasOpenAiIntegration(),
  ])

  const fileCount = sources.filter((s) => s.source_type !== 'url').length
  const urlCount = sources.filter((s) => s.source_type === 'url').length

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Knowledge</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload documents to answer knowledge queries during live calls.
        </p>
      </div>
      {!hasOpenAi && <OpenAiBanner />}
      <div className="space-y-5">
        <UploadForm
          disabled={!hasOpenAi}
          fileCount={fileCount}
          urlCount={urlCount}
        />
        <DocumentList sources={sources} />
      </div>
    </div>
  )
}
