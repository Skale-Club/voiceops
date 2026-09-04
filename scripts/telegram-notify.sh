#!/usr/bin/env bash
#
# Pushes one ops alert to the Xphere Telegram chat from GitHub Actions.
#
# This is the OUTSIDE-the-server half of Xphere's alerting. The in-app half
# (src/lib/obs/alerts.ts, driven by /api/cron/obs-alerts) is richer — it can see
# cost, cron heartbeats, failed workflow runs and error spikes — but it dies
# with the process it is meant to report on. A container that is hung, OOM-
# killed or sitting on a dead host cannot tell anyone it is hung. Anything
# routed through this script runs on GitHub's infrastructure instead, so it
# survives the container, Coolify, the Hetzner box and the network path to it.
#
#   bash scripts/telegram-notify.sh "<b>Title</b>" "Body, \n for newlines"
#
# Reads TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID (repo secrets). The chat id
# variable deliberately matches the name src/lib/obs/alerts.ts already reads, so
# the in-app and out-of-app halves are configured from one pair of values rather
# than drifting into two. TELEGRAM_THREAD_ID (repo variable) is optional and
# only applies when the destination is a group with Topics enabled.
#
# ALWAYS EXITS 0. Callers are workflows whose red/green state means something
# specific — uptime.yml compares its own probe result against the previous run
# to decide whether this is a transition worth announcing — so a Telegram
# problem must never colour the run that carries it. A bad token would
# otherwise manufacture a fake "down" transition and then fail to report it.
# Failures surface as ::error:: annotations, visible in the run without
# changing its conclusion.
set -uo pipefail

TITLE="${1:?usage: telegram-notify.sh <title> [body]}"
BODY="${2:-}"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_ALERT_CHAT_ID:-}" ]; then
  echo "::warning::TELEGRAM_BOT_TOKEN/TELEGRAM_ALERT_CHAT_ID not set — '${TITLE}' was not delivered."
  exit 0
fi

# Strip surrounding whitespace, CR included. The token goes straight into the
# request PATH, so one stray character makes every call 404 — and the failure
# reads as "wrong token" rather than "trailing newline", which is a long way to
# travel for a fix. `gh secret set` piped from PowerShell stores exactly that
# trailing CR, and a token pasted into GitHub's web UI can pick up a space just
# as easily.
TOKEN=$(printf '%s' "${TELEGRAM_BOT_TOKEN}" | tr -d '[:space:]')
CHAT_ID=$(printf '%s' "${TELEGRAM_ALERT_CHAT_ID}" | tr -d '[:space:]')

# printf '%b' expands the \n the caller wrote; --data-urlencode must receive
# REAL newlines, because it escapes a literal '%0A' into '%250A' and the
# message then shows the escape sequence as text.
text=$(printf '%b' "${TITLE}\n\n${BODY}")

thread_arg=()
[ -n "${TELEGRAM_THREAD_ID:-}" ] && thread_arg=(-d "message_thread_id=${TELEGRAM_THREAD_ID}")

response=$(curl -sS --max-time 20 -X POST \
  "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  -d "parse_mode=HTML" \
  -d "disable_web_page_preview=true" \
  "${thread_arg[@]}" \
  --data-urlencode "text=${text}" 2>&1)

case "${response}" in
  *'"ok":true'*)
    echo "Telegram alert sent: ${TITLE}"
    ;;
  *)
    # Print Telegram's own explanation: the status code alone rarely says what
    # to fix. The one that matters most is the supergroup migration — when a
    # group is upgraded its chat id changes, every later alert fails, and ops
    # alerting dies silently unless the replacement id is surfaced. Telegram
    # returns that new id in the error body, so printing it raw is the whole
    # remedy.
    echo "::error::Telegram refused the alert: ${response}"
    ;;
esac

exit 0
