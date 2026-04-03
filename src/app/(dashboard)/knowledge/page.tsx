import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DocumentList } from '@/components/knowledge/document-list'
import { UploadForm } from '@/components/knowledge/upload-form'

export default async function KnowledgePage() {
  const user = await getUser()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const { data: documents, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Knowledge</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload documents to answer knowledge queries during live calls.
        </p>
      </div>
      <div className="space-y-5">
        <UploadForm />
        <DocumentList documents={documents ?? []} />
      </div>
    </div>
  )
}
