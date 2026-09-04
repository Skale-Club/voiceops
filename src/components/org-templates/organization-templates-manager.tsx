'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Boxes,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Rocket,
  Loader2,
  CheckCircle2,
  Circle,
  History,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ASSET_GROUPS,
  ASSET_GROUP_LABELS,
  type InstallSummary,
  type OrgTemplateAssetGroup,
  type OrgTemplateStatus,
} from '@/lib/org-templates/types'
import { switchOrganization } from '@/app/(dashboard)/organizations/actions'
import {
  createTemplateFromCurrentOrg,
  updateOrgTemplate,
  refreshTemplateSnapshot,
  deleteOrgTemplate,
  createOrgFromTemplate,
  type OrgTemplateListItem,
  type OrgTemplateInstallItem,
} from '@/app/(dashboard)/settings/organization-templates/actions'

const STATUS_VARIANT: Record<OrgTemplateStatus, 'success' | 'warning' | 'outline'> = {
  active: 'success',
  draft: 'warning',
  archived: 'outline',
}

interface Props {
  initialTemplates: OrgTemplateListItem[]
  initialInstalls: OrgTemplateInstallItem[]
}

export function OrganizationTemplatesManager({ initialTemplates, initialInstalls }: Props) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<OrgTemplateListItem | null>(null)
  const [installTarget, setInstallTarget] = React.useState<OrgTemplateListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<OrgTemplateListItem | null>(null)
  const [result, setResult] = React.useState<
    { summary: InstallSummary; orgId: string; orgName: string } | null
  >(null)
  const [pending, startTransition] = React.useTransition()

  function refresh() {
    router.refresh()
  }

  function handleRefreshSnapshot(t: OrgTemplateListItem) {
    startTransition(async () => {
      const res = await refreshTemplateSnapshot(t.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Snapshot refreshed from current organization.')
        refresh()
      }
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const res = await deleteOrgTemplate(deleteTarget.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Template deleted.')
        setDeleteTarget(null)
        refresh()
      }
    })
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Capture current organization
        </Button>
      </div>

      {initialTemplates.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {initialTemplates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              pending={pending}
              onInstall={() => setInstallTarget(t)}
              onEdit={() => setEditTarget(t)}
              onRefresh={() => handleRefreshSnapshot(t)}
              onDelete={() => setDeleteTarget(t)}
            />
          ))}
        </div>
      )}

      {initialInstalls.length > 0 && <InstallHistory installs={initialInstalls} />}

      {createOpen && (
        <CreateTemplateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            refresh()
          }}
        />
      )}

      {editTarget && (
        <EditTemplateDialog
          template={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            refresh()
          }}
        />
      )}

      {installTarget && (
        <CreateOrgDialog
          template={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={(r) => {
            setInstallTarget(null)
            setResult(r)
            refresh()
          }}
        />
      )}

      {result && (
        <InstallResultDialog
          result={result}
          onClose={() => setResult(null)}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the template &ldquo;{deleteTarget?.name}&rdquo; and its captured
              snapshot. Organizations already created from it are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-subtle bg-bg-secondary/40 px-6 py-12 text-center">
      <Boxes className="h-8 w-8 text-text-tertiary" />
      <div className="space-y-1">
        <p className="text-[13.5px] font-medium text-text-primary">No templates yet</p>
        <p className="max-w-sm text-[12.5px] text-text-tertiary">
          Configure this organization the way you want, then capture its structure as a reusable
          template for an industry.
        </p>
      </div>
      <Button variant="outline" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        Capture current organization
      </Button>
    </div>
  )
}

function TemplateCard({
  template,
  pending,
  onInstall,
  onEdit,
  onRefresh,
  onDelete,
}: {
  template: OrgTemplateListItem
  pending: boolean
  onInstall: () => void
  onEdit: () => void
  onRefresh: () => void
  onDelete: () => void
}) {
  const c = template.counts
  const summaryParts = [
    c.pipelines && `${c.pipelines} pipeline${c.pipelines === 1 ? '' : 's'}`,
    c.custom_fields && `${c.custom_fields} custom field${c.custom_fields === 1 ? '' : 's'}`,
    c.tags && `${c.tags} tag${c.tags === 1 ? '' : 's'}`,
    c.message_templates &&
      `${c.message_templates} message template${c.message_templates === 1 ? '' : 's'}`,
    c.workflows && `${c.workflows} workflow${c.workflows === 1 ? '' : 's'}`,
    c.agents && `${c.agents} agent${c.agents === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[]

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-medium text-text-primary">{template.name}</h3>
            <Badge variant={STATUS_VARIANT[template.status]}>{template.status}</Badge>
          </div>
          {template.industry && (
            <p className="mt-0.5 text-[12px] text-text-tertiary">{template.industry}</p>
          )}
        </div>
      </div>

      {template.description && (
        <p className="line-clamp-2 text-[12.5px] leading-snug text-text-secondary">
          {template.description}
        </p>
      )}

      <p className="text-[12px] text-text-tertiary">
        {summaryParts.length ? summaryParts.join(' · ') : 'Empty snapshot'}
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onInstall}>
          <Rocket className="h-3.5 w-3.5" />
          Create organization
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={pending}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh snapshot
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          className="text-text-tertiary hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function AssetGroupPicker({
  selected,
  onToggle,
}: {
  selected: Set<OrgTemplateAssetGroup>
  onToggle: (g: OrgTemplateAssetGroup, on: boolean) => void
}) {
  return (
    <div className="space-y-2">
      <Label>Asset groups to include</Label>
      <div className="space-y-2 rounded-md border border-border-subtle p-3">
        {ASSET_GROUPS.map((g) => (
          <label key={g} className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <Checkbox
              checked={selected.has(g)}
              onCheckedChange={(v) => onToggle(g, v === true)}
            />
            <span className="text-text-secondary">{ASSET_GROUP_LABELS[g]}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function CreateTemplateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = React.useState('')
  const [industry, setIndustry] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [selected, setSelected] = React.useState<Set<OrgTemplateAssetGroup>>(
    () => new Set(ASSET_GROUPS)
  )
  const [pending, startTransition] = React.useTransition()

  function toggle(g: OrgTemplateAssetGroup, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(g)
      else next.delete(g)
      return next
    })
  }

  function submit() {
    if (!name.trim()) return toast.error('Name is required.')
    if (selected.size === 0) return toast.error('Select at least one asset group.')
    startTransition(async () => {
      const res = await createTemplateFromCurrentOrg({
        name,
        industry,
        description,
        asset_groups: Array.from(selected),
      })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Template captured from current organization.')
        onCreated()
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Capture current organization as a template</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] text-text-tertiary">
          Only the selected structural assets are captured. Live data and credentials are never
          included.
        </p>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-name">Name</Label>
            <Input
              id="tmpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Carpet Cleaning Template"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-industry">Industry</Label>
            <Input
              id="tmpl-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Carpet Cleaning"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-desc">Description</Label>
            <Textarea
              id="tmpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this template sets up and who it's for."
              rows={3}
            />
          </div>
          <AssetGroupPicker selected={selected} onToggle={toggle} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Capture template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditTemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: OrgTemplateListItem
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = React.useState(template.name)
  const [industry, setIndustry] = React.useState(template.industry ?? '')
  const [description, setDescription] = React.useState(template.description ?? '')
  const [status, setStatus] = React.useState<OrgTemplateStatus>(template.status)
  const [pending, startTransition] = React.useTransition()

  function submit() {
    if (!name.trim()) return toast.error('Name is required.')
    startTransition(async () => {
      const res = await updateOrgTemplate(template.id, { name, industry, description, status })
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Template updated.')
        onSaved()
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-industry">Industry</Label>
            <Input
              id="edit-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Description</Label>
            <Textarea
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as OrgTemplateStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateOrgDialog({
  template,
  onClose,
  onInstalled,
}: {
  template: OrgTemplateListItem
  onClose: () => void
  onInstalled: (r: { summary: InstallSummary; orgId: string; orgName: string }) => void
}) {
  const [name, setName] = React.useState('')
  const [pending, startTransition] = React.useTransition()

  function submit() {
    if (!name.trim()) return toast.error('Organization name is required.')
    startTransition(async () => {
      const res = await createOrgFromTemplate(template.id, { name })
      if (res.error) toast.error(res.error)
      else if (res.summary && res.orgId && res.orgName) {
        toast.success('Organization created from template.')
        onInstalled({ summary: res.summary, orgId: res.orgId, orgName: res.orgName })
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization from &ldquo;{template.name}&rdquo;</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] text-text-tertiary">
          A new organization will be created and pre-loaded with this template&apos;s structure.
          Workflows arrive as inactive drafts.
        </p>
        <div className="space-y-1.5 py-1">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Carpet Cleaning"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create organization'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InstallResultDialog({
  result,
  onClose,
}: {
  result: { summary: InstallSummary; orgId: string; orgName: string }
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const { counts, checklist } = result.summary

  const countParts = [
    [counts.pipelines, 'pipeline'],
    [counts.stages, 'stage'],
    [counts.custom_fields, 'custom field'],
    [counts.tags, 'tag'],
    [counts.message_templates, 'message template'],
    [counts.workflows, 'workflow'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}${(n as number) === 1 ? '' : 's'}`)

  function switchTo() {
    startTransition(async () => {
      const res = await switchOrganization(result.orgId)
      if (res?.error) toast.error(res.error)
      else {
        router.push('/settings')
        router.refresh()
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>&ldquo;{result.orgName}&rdquo; is ready</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <p className="text-[12.5px] font-medium text-text-secondary">Copied structure</p>
            <p className="mt-1 text-[12.5px] text-text-tertiary">
              {countParts.length ? countParts.join(' · ') : 'Nothing was copied.'}
            </p>
          </div>
          <div>
            <p className="text-[12.5px] font-medium text-text-secondary">Post-install checklist</p>
            <ul className="mt-2 space-y-2">
              {checklist.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-[12.5px] text-text-secondary">
                  {item.done ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  )}
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Close
          </Button>
          <Button onClick={switchTo} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Switch to new organization'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InstallHistory({ installs }: { installs: OrgTemplateInstallItem[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-text-tertiary" />
        <h2 className="text-[13px] font-semibold text-text-secondary">Recent installs</h2>
      </div>
      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <table className="w-full text-[12.5px]">
          <thead className="bg-bg-secondary/60 text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Organization</th>
              <th className="px-3 py-2 text-left font-medium">Template</th>
              <th className="px-3 py-2 text-left font-medium">Copied</th>
              <th className="px-3 py-2 text-left font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {installs.map((i) => {
              const c = i.counts
              const copied = c
                ? [
                    c.pipelines && `${c.pipelines}p`,
                    c.custom_fields && `${c.custom_fields}cf`,
                    c.tags && `${c.tags}t`,
                    c.message_templates && `${c.message_templates}mt`,
                    c.workflows && `${c.workflows}wf`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '—'
              return (
                <tr key={i.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2 text-text-primary">{i.target_org_name ?? '—'}</td>
                  <td className="px-3 py-2 text-text-secondary">{i.template_name ?? '—'}</td>
                  <td className="px-3 py-2 text-text-tertiary">{copied || '—'}</td>
                  <td className="px-3 py-2 text-text-tertiary">
                    {new Date(i.installed_at).toLocaleDateString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
