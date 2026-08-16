'use client'

// Registers the org's Vapi numbers locally (provider='vapi') so calls can be
// attributed to them and workflows can trigger on them. Idempotent — numbers
// already registered are skipped, so local edits survive a re-run.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { importVapiNumbers } from '@/app/(dashboard)/integrations/twilio/numbers-actions'

export function ImportVapiNumbersButton({ count }: { count: number }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await importVapiNumbers()
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (!result.imported) {
        toast.info('No new numbers to import.')
      } else {
        toast.success(
          `Imported ${result.imported} number${result.imported === 1 ? '' : 's'} from Vapi.`,
        )
      }
      if (result.skipped) {
        toast.info(
          `${result.skipped} number${result.skipped === 1 ? ' is' : 's are'} registered by another workspace and were skipped.`,
        )
      }
      router.refresh()
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {count > 0 ? `Import from Vapi (${count})` : 'Import from Vapi'}
    </Button>
  )
}
