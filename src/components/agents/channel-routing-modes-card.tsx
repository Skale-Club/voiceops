"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  PUBLIC_AGENT_CHANNELS,
  AGENT_CHANNEL_LABELS,
  type AgentChannel,
} from "@/lib/agents/channels";
import type { ChannelRoutingMode } from "@/lib/agents/zod-schemas";
import { setChannelRoutingMode } from "@/app/(dashboard)/agents/actions";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ChannelRoutingModesCardProps {
  modes: Record<AgentChannel, ChannelRoutingMode>;
  surface?: "card" | "plain";
}

export function ChannelRoutingModesCard({
  modes,
  surface = "card",
}: ChannelRoutingModesCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(channel: AgentChannel, mode: ChannelRoutingMode) {
    startTransition(async () => {
      const result = await setChannelRoutingMode(channel, mode);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${AGENT_CHANNEL_LABELS[channel]} routing set to ${
          mode === "specialist" ? "Specialist mesh" : "Legacy"
        }.`,
      );
      router.refresh();
    });
  }

  const content = (
    <>
      <CardHeader className={surface === "plain" ? "px-0 pt-0" : undefined}>
        <CardTitle className="text-base">Channel Routing</CardTitle>
        <CardDescription>
          Choose, per channel, whether calls route through the legacy
          entry-agent flow or the specialist mesh.
        </CardDescription>
      </CardHeader>
      <CardContent className={surface === "plain" ? "px-0 pb-0" : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          {PUBLIC_AGENT_CHANNELS.map((ch) => {
            const currentMode = modes[ch] ?? "legacy";
            return (
              <div
                key={ch}
                className="flex min-w-0 flex-col gap-2 rounded-md border bg-background/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <Label
                  htmlFor={`channel-routing-${ch}`}
                  className="text-sm font-medium shrink-0"
                >
                  {AGENT_CHANNEL_LABELS[ch]}
                </Label>
                <Select
                  value={currentMode}
                  disabled={isPending}
                  onValueChange={(v) => handleChange(ch, v as ChannelRoutingMode)}
                >
                  <SelectTrigger
                    id={`channel-routing-${ch}`}
                    className="h-8 w-full min-w-0 text-xs sm:w-[220px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="legacy">Legacy (default)</SelectItem>
                    <SelectItem value="specialist">Specialist mesh</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </CardContent>
    </>
  );

  if (surface === "plain") {
    return <div>{content}</div>;
  }

  return <Card>{content}</Card>;
}
