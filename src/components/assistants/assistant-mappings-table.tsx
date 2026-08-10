"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, ExternalLink, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AssistantMappingForm } from "./assistant-mapping-form";
import {
  toggleAssistantMappingStatus,
  deleteAssistantMapping,
  syncVapiAssistantsAction,
} from "@/app/(dashboard)/assistants/actions";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type AssistantMapping =
  Database["public"]["Tables"]["assistant_mappings"]["Row"];

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getVapiAssistantUrl(assistantId: string) {
  return `https://dashboard.vapi.ai/assistants/${assistantId}`;
}

interface AssistantMappingsTableProps {
  mappings: AssistantMapping[];
}

export function AssistantMappingsTable({
  mappings: initialMappings,
}: AssistantMappingsTableProps) {
  const router = useRouter();
  const [optimisticMappings, setOptimisticMappings] = useState(initialMappings);
  const [syncing, setSyncing] = useState(false);
  const [editMapping, setEditMapping] = useState<AssistantMapping | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssistantMapping | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);

  async function handleToggle(id: string, newValue: boolean) {
    setOptimisticMappings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, is_active: newValue } : m)),
    );
    const result = await toggleAssistantMappingStatus(id, newValue);
    if (result?.error) {
      setOptimisticMappings((prev) =>
        prev.map((m) => (m.id === id ? { ...m, is_active: !newValue } : m)),
      );
      toast.error("Failed to update mapping. Try again.");
    } else {
      toast.success("Mapping updated.");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsLoading(true);
    const id = deleteTarget.id;
    setOptimisticMappings((prev) => prev.filter((m) => m.id !== id));
    setDeleteTarget(null);
    const result = await deleteAssistantMapping(id);
    if (result?.error) {
      setOptimisticMappings(initialMappings);
      toast.error("Failed to remove mapping. Try again.");
    } else {
      toast.success("Assistant mapping removed.");
    }
    setIsLoading(false);
  }

  async function handleSync() {
    setSyncing(true);
    const result = await syncVapiAssistantsAction();
    setSyncing(false);
    if (!result.ok) {
      toast.error(result.error ?? "Sync failed. Try again.");
      return;
    }
    // A skipped assistant is one another workspace already routes through.
    // Saying so out loud matters: silence here reads as "everything imported",
    // and the person would go looking for an assistant that is deliberately
    // still pointed somewhere else.
    const skippedNote = result.skipped
      ? ` ${result.skipped} left with another workspace that already uses ${result.skipped === 1 ? "it" : "them"}.`
      : "";
    toast.success(
      (result.imported
        ? `Synced ${result.imported} assistant${result.imported === 1 ? "" : "s"} from Vapi.`
        : "No new assistants to import.") + skippedNote,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 pb-4">
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync from Vapi"}
        </Button>
      </div>

      <div className="pb-8">
        {optimisticMappings.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center rounded-[8px] border border-dashed border-border bg-bg-secondary/30 px-4 py-16 text-center">
            <Bot className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="text-base font-semibold mb-1">
              No assistants synced yet
            </h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm">
              Connecting your Vapi key imports assistants automatically. Use Sync
              to pull the latest from your Vapi account.
            </p>
            <Button size="sm" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync from Vapi"}
            </Button>
          </div>
        ) : (
          <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
            {/* Header */}
            <div
              className="hidden items-center gap-3 px-4 py-2.5 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary md:grid"
              style={{ gridTemplateColumns: "2fr 2fr 140px 100px 48px" }}
            >
              <div>Assistant Name</div>
              <div>Vapi Assistant ID</div>
              <div>Status</div>
              <div className="text-right">Added</div>
              <div />
            </div>

            {/* Rows */}
            <div className="divide-y divide-border-subtle">
              {optimisticMappings.map((m) => {
                const isActive = m.is_active;
                return (
                  <div key={m.id}>
                    <div className="md:hidden px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-text-primary">
                            {m.name || "Unnamed assistant"}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-2">
                            <span className="truncate font-mono text-[11.5px] text-text-secondary">
                              {m.vapi_assistant_id}
                            </span>
                            <a
                              href={getVapiAssistantUrl(m.vapi_assistant_id)}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-text-tertiary hover:text-text-primary underline-offset-2 hover:underline"
                              aria-label="Open in Vapi"
                            >
                              Open
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              aria-label="Row actions"
                            >
                              <MoreHorizontal className="h-4 w-4 text-text-tertiary" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link
                                href={getVapiAssistantUrl(m.vapi_assistant_id)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLink className="h-3.5 w-3.5 mr-2" />{" "}
                                Open in Vapi
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditMapping(m)}>
                              Edit Mapping
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteTarget(m)}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Remove
                              Mapping
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={isActive}
                            onCheckedChange={(checked) =>
                              handleToggle(m.id, checked)
                            }
                            className="data-[state=checked]:bg-primary"
                          />
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10.5px] font-medium",
                              isActive
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
                            )}
                          >
                            {isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <div className="text-[11.5px] text-text-tertiary">
                          {relativeTime(m.created_at)}
                        </div>
                      </div>
                    </div>

                    <div
                      className={cn(
                        "hidden items-center gap-3 px-4 py-3 md:grid",
                        "transition-all duration-200 ease-out hover:bg-bg-tertiary/40",
                      )}
                      style={{
                        gridTemplateColumns: "2fr 2fr 140px 100px 48px",
                      }}
                    >
                      {/* Name */}
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-text-primary">
                          {m.name || "Unnamed assistant"}
                        </div>
                      </div>

                      {/* Vapi ID */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[12px] text-text-secondary truncate">
                          {m.vapi_assistant_id}
                        </span>
                        <a
                          href={getVapiAssistantUrl(m.vapi_assistant_id)}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-text-tertiary hover:text-text-primary underline-offset-2 hover:underline"
                          aria-label="Open in Vapi"
                        >
                          Open
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>

                      {/* Status */}
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={isActive}
                          onCheckedChange={(checked) =>
                            handleToggle(m.id, checked)
                          }
                          className="data-[state=checked]:bg-primary"
                        />
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10.5px] font-medium",
                            isActive
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
                          )}
                        >
                          {isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>

                      {/* Added */}
                      <div className="text-right text-[11.5px] text-text-tertiary">
                        {relativeTime(m.created_at)}
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Row actions"
                            >
                              <MoreHorizontal className="h-4 w-4 text-text-tertiary" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link
                                href={getVapiAssistantUrl(m.vapi_assistant_id)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLink className="h-3.5 w-3.5 mr-2" />{" "}
                                Open in Vapi
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditMapping(m)}>
                              Edit Mapping
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteTarget(m)}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Remove
                              Mapping
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {editMapping && (
        <AssistantMappingForm
          mode="edit"
          mapping={editMapping}
          open={!!editMapping}
          onOpenChange={(open) => {
            if (!open) setEditMapping(null);
          }}
          onSuccess={() => {
            setEditMapping(null);
            router.refresh();
          }}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Assistant Mapping</AlertDialogTitle>
            <AlertDialogDescription>
              This assistant ID will no longer route webhooks to this
              organization. A future sync from Vapi will re-import it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Mapping</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
