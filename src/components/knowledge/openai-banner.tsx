'use client'

import Link from 'next/link'

export function OpenAiBanner() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span className="font-medium">OpenAI integration required.</span>{' '}
      To process documents, configure your OpenAI API key in{' '}
      <Link href="/integrations" className="underline underline-offset-2 font-medium hover:text-amber-900">
        Integrations
      </Link>
      .
    </div>
  )
}
