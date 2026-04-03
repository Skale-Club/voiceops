'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { Database } from '@/types/database'
import { createOrganization, updateOrganization, toggleOrganizationStatus } from '@/app/(dashboard)/organizations/actions'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

type Organization = Database['public']['Tables']['organizations']['Row']

const organizationSchema = z.object({
  name: z
    .string()
    .min(1, 'Organization name is required.')
    .max(100, 'Name must be 100 characters or fewer.'),
  is_active: z.boolean(),
})

type OrganizationFormValues = z.infer<typeof organizationSchema>

interface OrganizationFormProps {
  mode: 'create' | 'edit'
  organization?: Organization
  onSuccess: () => void
}

export function OrganizationForm({ mode, organization, onSuccess }: OrganizationFormProps) {
  const [isPending, setIsPending] = useState(false)
  const [isDeactivateDialogOpen, setIsDeactivateDialogOpen] = useState(false)

  const form = useForm<OrganizationFormValues>({
    resolver: zodResolver(organizationSchema),
    mode: 'onSubmit',
    defaultValues: {
      name: organization?.name ?? '',
      is_active: organization?.is_active ?? true,
    },
  })

  async function onSubmit(values: OrganizationFormValues) {
    setIsPending(true)
    try {
      let result: { error?: string } | void = undefined

      if (mode === 'create') {
        result = await createOrganization({ name: values.name })
      } else if (organization) {
        result = await updateOrganization(organization.id, {
          name: values.name,
          is_active: values.is_active,
        })
      }

      if (result && 'error' in result && result.error) {
        toast.error('Failed to save organization. Try again.')
        return
      }

      toast.success('Organization saved.')
      onSuccess()
    } catch {
      toast.error('Failed to save organization. Try again.')
    } finally {
      setIsPending(false)
    }
  }

  async function handleDeactivate() {
    if (!organization) return
    setIsPending(true)
    try {
      const result = await toggleOrganizationStatus(organization.id, false)
      if (result && 'error' in result && result.error) {
        toast.error('Failed to save organization. Try again.')
        return
      }
      toast.success('Organization saved.')
      onSuccess()
    } catch {
      toast.error('Failed to save organization. Try again.')
    } finally {
      setIsPending(false)
      setIsDeactivateDialogOpen(false)
    }
  }

  async function handleReactivate() {
    if (!organization) return
    setIsPending(true)
    try {
      const result = await toggleOrganizationStatus(organization.id, true)
      if (result && 'error' in result && result.error) {
        toast.error('Failed to save organization. Try again.')
        return
      }
      toast.success('Organization saved.')
      onSuccess()
    } catch {
      toast.error('Failed to save organization. Try again.')
    } finally {
      setIsPending(false)
    }
  }

  const isActive = organization?.is_active ?? true

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">
          {mode === 'create' ? 'New Organization' : 'Edit Organization'}
        </h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Organization Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Alpha Home Improvements"
                    disabled={isPending}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {mode === 'edit' && (
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select
                    disabled={isPending}
                    onValueChange={(value) => field.onChange(value === 'active')}
                    defaultValue={field.value ? 'active' : 'inactive'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="deactivated">Deactivated</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : mode === 'create' ? (
                'Create Organization'
              ) : (
                'Save Changes'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={onSuccess}
            >
              {mode === 'create' ? 'Back to Organizations' : 'Discard Changes'}
            </Button>
          </div>
        </form>
      </Form>

      {mode === 'edit' && (
        <>
          <Separator />
          {isActive ? (
            <AlertDialog open={isDeactivateDialogOpen} onOpenChange={setIsDeactivateDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isPending} type="button">
                  Deactivate
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deactivate Organization</AlertDialogTitle>
                  <AlertDialogDescription>
                    This organization&apos;s data will remain intact. Vapi webhooks for its assistants
                    will stop resolving until reactivated.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Organization</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeactivate}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Deactivate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              variant="outline"
              disabled={isPending}
              type="button"
              onClick={handleReactivate}
            >
              Reactivate
            </Button>
          )}
        </>
      )}
    </div>
  )
}
