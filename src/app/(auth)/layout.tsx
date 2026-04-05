import { getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (user) redirect('/')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      {children}
    </div>
  )
}
