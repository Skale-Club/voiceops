# Cloudflare CDN — xphere.app

Cutover: 2026-08-06. Zone `xphere.app` (id `5bbf90ae55e2aca632e1c8e63813d2c1`),
Cloudflare account **Skale Club**, **Free** plan.

Before this, the zone used Cloudflare only for DNS — every record was grey
(DNS-only) and all traffic went straight to the Hetzner box. Now `xphere.app`
and `www.xphere.app` are proxied.

## What this does and does not buy

Xphere is an authenticated multi-tenant dashboard. Nearly every page response
already carries `Cache-Control: private, no-cache, no-store`, so **the CDN does
not make the app broadly faster** — HTML and API responses still reach the
origin on every request, which is exactly what we want with RLS.

The real wins are narrow:

| Surface | Benefit |
|---|---|
| `/_next/static/*` | Immutable JS/CSS/fonts served from the edge instead of one box in Germany |
| `/widget/*` | Public embeddable widget, cross-origin, on customer sites |
| Everything | Edge TLS, DDoS absorption, origin shielded from direct hits |

## Proxied vs. not

**Proxied (orange):** `xphere.app`, `www.xphere.app`.

**Deliberately DNS-only (grey) — do not proxy:**

- `send.xphere.app` (MX → Amazon SES) and its SPF TXT
- `resend._domainkey.xphere.app` (DKIM)
- `_vercel` and Google site-verification TXT records
- `origin.xphere.app` — see [The 100-second ceiling](#the-100-second-ceiling)

Proxying any mail record breaks outbound email.

## Zone settings changed

| Setting | Was | Now | Why |
|---|---|---|---|
| `ssl` | `full` | `strict` | Origin already presents a publicly valid Let's Encrypt cert via Traefik. `full` does not validate it. |
| `browser_check` | `on` | `off` | Browser Integrity Check challenges requests without browser-like headers. That is *every* webhook sender (34 routes across Vapi, Meta, Twilio, Stripe, Telegram, ManyChat, Zernio, GHL…) and all 11 GitHub Actions, which call with `curl`. Leaving it on would have silently broken every integration. |
| `email_obfuscation` | `on` | `off` | It rewrites email addresses in HTML into a `/cdn-cgi/l/email-protection` link plus injected JS. Xphere is a CRM that renders email addresses throughout contacts, inbox and prospects — that rewrite causes React hydration mismatches. |

`rocket_loader` was already `off` and must stay off: it reorders/defers JS and
breaks Next.js hydration.

## Cache rules

Three rules in the `http_request_cache_settings` phase:

1. **`/_next/static/*`** → cache, edge TTL 1 year, browser TTL 1 year.
   Filenames are content-hashed, so they are safe to cache forever.
2. **`/widget/*`** → cache, edge TTL 300s, browser TTL 60s.
   Public per-token content; short TTL so review updates surface quickly.
3. **`/api/*` and `/auth/*`** → **bypass cache.**

Rule 3 is a guard-rail, not redundancy. Xphere is multi-tenant with RLS, so a
mis-aimed cache rule could serve one tenant's data to another. The origin's
`Cache-Control` headers already say not to cache these, but we do not want the
correctness of tenant isolation resting solely on an origin header.

**When adding a cache rule, allow-list specific paths. Never write a rule that
caches by file extension or by a broad prefix.**

## The 100-second ceiling

Cloudflare's proxy drops any origin request that takes longer than **100
seconds** and returns **524**. Measured GitHub Actions durations before the
cutover:

| Workflow | Max observed | Status |
|---|---|---|
| `global-knowledge-notion` | **103s** | Was already over the limit |
| `scrape-reviews` | 95s | About 5s of headroom |
| `calendar-tick` | 74s | Next closest |
| everything else | ≤26s | Comfortable |

`global-knowledge-notion` and `scrape-reviews` therefore call the origin
directly, bypassing the edge:

```bash
HOST=$(echo "$URL" | sed -E 's#^https?://([^/]+).*#\1#')
ORIGIN_IP=$(getent hosts origin.xphere.app | awk '{print $1; exit}')
curl --resolve "${HOST}:443:${ORIGIN_IP}" "$URL"
```

The Host header and TLS SNI stay `xphere.app`, so Traefik routes normally and
the existing certificate validates. Only the DNS lookup is redirected.

`campaigns/[id]/start` declares `maxDuration = 300` but is **not** affected: it
does its heavy work inside `after()`, so the HTTP response returns immediately.

**If you add a job that can exceed 100s, point it at `origin.xphere.app` the
same way — or restructure it to respond immediately and work in `after()`.**

Tradeoff worth knowing: `origin.xphere.app` publishes the origin IP, which
partly undercuts the "shield the origin" benefit. The IP was already
discoverable through historical DNS (the zone was grey until this cutover), so
the marginal exposure is small — but if origin hiding ever becomes a real
requirement, move the IP into a GitHub Actions secret and drop the DNS record.

## Delayed failure mode — read this before debugging a 524 storm

`Full (strict)` requires a valid, unexpired certificate on the origin. If
Let's Encrypt renewal breaks inside Coolify, **nothing happens for up to 90
days** — and then every proxied hostname starts serving 526 at once, long after
whatever change caused it.

If you see zone-wide 526: **the problem is certificate renewal on Coolify, not
Cloudflare.** Check Traefik's certificate resolver on the Hetzner box first.

Similarly, a sudden 524 on one endpoint means that endpoint crossed 100s — look
at what got slower, not at the CDN.

## Rollback

Fastest rollback is to un-proxy the two records (back to grey); traffic returns
to the origin within the 300s TTL. The zone settings and cache rules can stay —
they have no effect while grey.

```bash
# DNS record ids
#   xphere.app       ab05745363488b535977461853a4608c
#   www.xphere.app   15bc48ef7e0c6285762bd88953c8523e
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$RECORD" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  --data '{"proxied":false}'
```

## Verified at cutover

- All of `/`, `/login`, `/api/health`, `/api/v1/contacts` → 200 via the edge,
  `cf-cache-status: DYNAMIC`, no challenge
- `/_next/static/…` → `MISS` then `HIT`
- `POST /api/vapi/tools` with a `curl` User-Agent → 200, not challenged
- `Full (strict)` validated the origin certificate (no 526)
- `curl --resolve` against `origin.xphere.app` → 200 with no `cf-ray`

**Not verified, needs a human:** authenticated SSE streaming (the copilot at
`/api/copilot/turn` and chat at `/api/chat/[token]`). Cloudflare passes SSE
through and these paths bypass cache, but token-by-token delivery was not
observed end to end. If streaming ever feels buffered or stalls, that is the
first suspect.
