# Telegram alerts

Xphere reports its own problems to a Telegram chat: the site going down, a cron
that stopped ticking, workflows failing, agent cost running toward the cap, and
a sudden jump in the error rate.

The bot is **@xphereoppsbot** ("Xphere | Opps"), created for this project only.
Do not reuse a bot from another project: one bot per project keeps a revoked or
rotated token from silencing everything at once.

## Setting it up

The pair is already configured. This section is for rotating it or pointing it
somewhere new.

1. Message **@BotFather**, `/newbot`, follow the prompts. It replies with a
   token like `8123456789:AAF...`.
2. Send the bot any ordinary text message. Telegram refuses to let a bot open a
   conversation, so an unmessaged bot fails with `403 Forbidden` — the single
   most common setup mistake. The **Start** button does not always produce an
   update in the API; a plain text message does.
3. Read the chat id from
   `https://api.telegram.org/bot<TOKEN>/getUpdates` → `result[0].message.chat.id`.
   If that comes back `{"ok":true,"result":[]}`, check
   `getWebhookInfo` first: a registered webhook suppresses `getUpdates`
   entirely, and updates older than 24h are dropped.
4. Put the pair in **two** places:
   - **GitHub repository secrets** `TELEGRAM_BOT_TOKEN` and
     `TELEGRAM_ALERT_CHAT_ID` — for the external uptime probe.
   - **Coolify environment variables**, same two names — for the in-app alerts.
     `coolify-set-envs.yml` upserts them from the GitHub secrets, so setting the
     secrets and running that workflow covers both.

Both places are needed because the alerts come from two different machines, on
purpose — see below.

> **Set the secret without a trailing newline.** `gh secret set` piped from
> PowerShell stores the CR, the token goes straight into the request *path*, and
> every call 404s while reading like "wrong token". Use
> `printf '%s' '<token>' | gh secret set TELEGRAM_BOT_TOKEN` from Git Bash. Both
> `scripts/telegram-notify.sh` and `src/lib/obs/alerts.ts` strip whitespace
> defensively, but the secret is easier to fix than to diagnose.

## What you get told

| Alert | Source | When |
| --- | --- | --- |
| 🔴 Xphere is DOWN / ✅ back UP | GitHub Actions (`uptime.yml`) | every ~5 min, transition only |
| 🔴 Unreachable from outside the VPS | GitHub Actions (`obs-alerts.yml`) | hourly, also files a GitHub issue |
| 🟠 Agent cost near daily cap (≥80%) | in-app cron | re-alerts every 6h |
| 🔴 Google Reviews scrape failed | in-app cron | once per failure per 24h |
| 🟠 Workflow runs failing, grouped by cause | in-app cron | once per distinct cause per 24h |
| 🔴 Cron heartbeat stale | in-app cron | every 3h while stale |
| 🔴 Error spike | in-app, in-process | ≥10 errors in 5 min, then 30 min quiet |

## Why the monitoring lives in three places

This is the part worth understanding, because it is what makes the system
trustworthy rather than merely reassuring.

**A server that is down cannot tell you it is down.** Everything in-app —
`/api/cron/obs-alerts`, the error-spike detector, the heartbeat table — runs on
the Hetzner box and goes silent at exactly the moment it matters most. So the
uptime check runs on **GitHub Actions**, outside the container, outside Coolify,
outside Hetzner and outside the network path to it. If the box disappears,
GitHub still notices and still has a route to Telegram.

This deliberately swims against the 2026-08-21 migration that moved every
scheduled tick off GitHub Actions onto the `skale-cron` service on the VPS.
That migration was right for the ticks: GitHub throttled `*/5` schedules into
28–37 minute gaps and billed a full runner-minute per curl. Both complaints
apply to `uptime.yml` too, and it stays on GitHub Actions anyway — a liveness
check hosted on the machine it checks is not a liveness check. Expect its
cadence to drift well past five minutes; a probe that drifts to 30 minutes still
beats one that dies with the host.

**But an HTTP probe from outside is nearly blind.** It sees "the page loads" and
stays green while a workflow fails on every run, a token quietly expires, or
cost climbs toward the cap. The **in-app cron** catches those, because it can
query the database the probe cannot see.

**And neither can see a burst.** A specific signal only fires for a failure
someone thought to instrument. The **error-spike detector** is the net under all
of them: it lives inside `logger.emit()` and reports a change in the error
*rate*, whatever the cause.

Three vantage points, three blind spots, deliberately overlapping.

## Alert fatigue is a failure mode

An alerting system people mute is worse than none, so:

- **Uptime alerts fire on transitions only.** One message when it goes down, one
  when it comes back — never one per check. State is carried between runs in the
  Actions cache.
- **The first uptime run after a cache reset stays quiet.** `unknown → up` is a
  cold start, not a recovery, and announcing it would cry wolf. `unknown → down`
  still alerts: a real outage on a cold start is a real outage.
- **In-app alerts dedupe** through the `obs_alert_log` table, per alert key, with
  a per-signal window (6h for cost, 24h for scrape and workflow failures, 3h for
  a stale cron).
- **The error spike goes quiet for 30 minutes** after firing. An outage lasts
  longer than one window, and repeating "still broken" every five minutes is how
  a channel trains people to ignore it.
- **Failures are grouped by cause, not by occurrence.** Digits are masked before
  grouping, so 90 SMS rejections to 90 different phone numbers are one alert,
  not 90.

## The error-spike threshold, and how to re-derive it

**10 errors in 5 minutes**, then 30 minutes of silence. Override with
`ERROR_SPIKE_THRESHOLD` / `ERROR_SPIKE_COOLDOWN_MS`.

That number was measured against this project, not inherited. Over the 30 days
to 2026-08-30, from `event_logs` where `severity = 'error'`:

```
143 errors / 30d        = 4.8/day = 0.20/hour
5-min windows w/ error  = 59 of 8,640 (0.7%)
errors per active window: median 3 · p90 3 · max 6
```

10 is roughly 3x the worst burst actually observed, and **would have fired zero
times across those 30 days**. That silence is the point: the signal is the jump,
not the errors. Re-measure before changing it:

```sql
select date_trunc('hour', created_at) as hour, count(*)
from event_logs
where severity = 'error' and created_at > now() - interval '30 days'
group by 1 order by 2 desc limit 20;
```

Note that state is per-process and in memory. A restart resets it — correct, since
a fresh process has no history to compare against — and each container in a
rolling deploy counts independently, so the threshold is effectively per-instance.

## Failure is always silent

Every path no-ops when `TELEGRAM_BOT_TOKEN` or `TELEGRAM_ALERT_CHAT_ID` are
unset, and none of them ever throws. A notification is not worth failing a
request over: if Telegram is down, the webhook still returns 200 and the order
still goes through.

`scripts/telegram-notify.sh` **always exits 0**, deliberately. Its callers are
workflows whose red/green state means something specific — `uptime.yml` compares
its own probe result against the previous run to decide whether this is a
transition worth announcing. A bad token must not manufacture a fake "down"
transition and then fail to report it. Delivery problems surface as `::error::`
annotations, visible in the run without changing its conclusion.

The trade-off is that a misconfigured bot fails quietly. To check: run the
**Uptime** workflow manually and read the step log, or
`curl https://xphere.app/api/cron/obs-alerts -H "Authorization: Bearer $CRON_SECRET"`
and look at the `channels` field in the JSON response, which reports which
channels were armed.

Email is the floor, not a second copy. `deliverAlert()` tries Telegram first and
falls through to `PLATFORM_ADMIN_EMAIL` only when Telegram is absent or failed —
delivering through both would page twice for every alert.

## Changing where the alerts go

The destination today is a **private chat** (`8664810189`). Moving to a group is
a configuration change only — no code change:

1. Create the group and add **@xphereoppsbot** to it.
2. Send any message in the group, then read the chat id from
   `https://api.telegram.org/bot<TOKEN>/getUpdates`. **Group ids are negative**
   (`-1001234567890` for a supergroup); keep the minus sign.
3. Replace `TELEGRAM_ALERT_CHAT_ID` in both places — GitHub secrets and Coolify
   env — and redeploy so the container picks it up.

If the group has **Topics** enabled and you want the alerts in a specific topic
rather than General, also set `TELEGRAM_THREAD_ID` to that topic's id (visible in
the topic's message link, as the number after the group id). Leave it unset
otherwise; the parameter is omitted entirely when empty, and it is ignored by a
private chat.

There is also an **ops-wide** pair, `TELEGRAM_BOT_TOKEN_OPS` /
`TELEGRAM_ALERT_CHAT_ID_OPS`. Cron-heartbeat alerts prefer it, because
`cron_heartbeats` is fed by several apps sharing this ops hub (xphere, skaleclub,
xtimator, vitacell, obigode, rwmgmt, websites) and a stale job there may not be
Xphere's. Set it when you want one shared ops group across all of them; it falls
back to this app's own pair when unset.

### The failure mode to know about

When a regular group is upgraded to a **supergroup** — which Telegram does
automatically when you add certain features — **the chat id changes**, and every
alert after that silently fails. Nothing looks broken; the messages simply stop.

Both halves handle this as well as they can: on rejection they log Telegram's
own explanation rather than just the status code, and that body contains the
replacement id in `parameters.migrate_to_chat_id`:

```text
::error::Telegram refused the alert: {"ok":false,"error_code":400,
"description":"Bad Request: group chat was upgraded to a supergroup chat",
"parameters":{"migrate_to_chat_id":-1001234567890}}
```

Set `TELEGRAM_ALERT_CHAT_ID` to that id in both places to restore alerting.

## Where each piece lives

| Path | Role |
| --- | --- |
| `.github/workflows/uptime.yml` | Layer 1 — external probe, transition-only |
| `.github/workflows/obs-alerts.yml` | Layer 1 — hourly trigger + unreachable-VPS issue |
| `scripts/telegram-notify.sh` | Sender for anything running in GitHub Actions |
| `src/app/api/cron/obs-alerts/route.ts` | Layer 2 — the five in-app signals |
| `src/lib/obs/alerts.ts` | Delivery, dedupe, Telegram + email channels |
| `src/lib/obs/error-spike.ts` | Layer 3 — rate-change detector |
| `src/lib/obs/logger.ts`, `src/lib/logger.ts` | Where errors fan out to Sentry, `event_logs` and the spike detector |
