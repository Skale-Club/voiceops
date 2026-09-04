"use client";

import { useEffect, useMemo, useState } from "react";
import { Settings } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChannelDefaultsCard } from "@/components/agents/channel-defaults-card";
import { ChannelRoutingModesCard } from "@/components/agents/channel-routing-modes-card";
import { AGENT_CHANNELS, type AgentChannel } from "@/lib/agents/channels";
import type { ChannelRoutingMode } from "@/lib/agents/zod-schemas";

interface AgentSettingsButtonProps {
  defaults: Record<AgentChannel, string | null>;
  agents: Array<{ id: string; name: string; slug: string }>;
  modes: Record<AgentChannel, ChannelRoutingMode>;
}

export function AgentSettingsButton({
  defaults,
  agents,
  modes,
}: AgentSettingsButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const focusChannel = useMemo(() => {
    const raw = searchParams.get("channel");
    return AGENT_CHANNELS.includes(raw as AgentChannel)
      ? (raw as AgentChannel)
      : null;
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("settings") === "channels") {
      setOpen(true);
    }
  }, [searchParams]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && searchParams.get("settings") === "channels") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("settings");
      params.delete("channel");
      const qs = params.toString();
      router.replace(qs ? `/agents?${qs}` : "/agents", { scroll: false });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="h-8">
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-[760px] overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>Agent settings</DialogTitle>
          <DialogDescription>
            Manage defaults that apply across channels.
          </DialogDescription>
        </DialogHeader>

        <ChannelDefaultsCard
          defaults={defaults}
          agents={agents}
          surface="plain"
          focusChannel={focusChannel}
        />

        <div className="border-t pt-4">
          <ChannelRoutingModesCard modes={modes} surface="plain" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
