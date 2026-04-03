'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, ChevronsUpDown, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { switchOrganization, createOrganization, getUserOrgs } from '@/app/(dashboard)/organizations/actions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

interface OrgSwitcherProps {
  currentOrgId: string | null
  currentOrgName: string | null
}

interface Org {
  id: string
  name: string
}

const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(100, 'Max 100 characters.'),
})
type CreateOrgValues = z.infer<typeof createOrgSchema>

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const form = useForm<CreateOrgValues>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: '' },
  })

  function onSubmit(values: CreateOrgValues) {
    startTransition(async () => {
      const result = await createOrganization({ name: values.name })
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Organization created.')
      onOpenChange(false)
      form.reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Organization</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 pt-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Alpha Home Improvements" disabled={isPending} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : 'Create'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function OrgSwitcher({ currentOrgId, currentOrgName }: OrgSwitcherProps) {
  const [isSwitching, startSwitchTransition] = useTransition()
  const [createOpen, setCreateOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false)
  const router = useRouter()

  async function handleDropdownOpen(open: boolean) {
    setDropdownOpen(open)
    // Lazy-load org list only on first open
    if (open && orgs === null && !isLoadingOrgs) {
      setIsLoadingOrgs(true)
      try {
        const list = await getUserOrgs()
        setOrgs(list)
      } finally {
        setIsLoadingOrgs(false)
      }
    }
  }

  function handleSwitch(orgId: string) {
    if (orgId === currentOrgId || isSwitching) return
    startSwitchTransition(async () => {
      const result = await switchOrganization(orgId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={handleDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 font-medium text-sm"
            disabled={isSwitching}
          >
            {isSwitching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="max-w-[160px] truncate">
              {currentOrgName ?? 'Select organization'}
            </span>
            <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {isLoadingOrgs ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </div>
          ) : (
            (orgs ?? []).map(org => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                className="cursor-pointer gap-2"
              >
                <Check
                  className={`h-3.5 w-3.5 shrink-0 ${org.id === currentOrgId ? 'opacity-100' : 'opacity-0'}`}
                />
                <span className="truncate">{org.name}</span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => { setDropdownOpen(false); setCreateOpen(true) }}
            className="cursor-pointer gap-2 text-muted-foreground"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            Add organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
