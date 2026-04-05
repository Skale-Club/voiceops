# Phase 6 — Chat Inbox UI Review

**Audited:** 2026-04-05
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md for this phase)
**Screenshots:** Not captured — dev server not running on ports 4267, 3000
**Files audited:** Code-only review

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Visual Hierarchy & Layout | 7/10 | Good two-panel structure; empty state and selected-item actions are underpowered |
| 2. Spacing & Density | 8/10 | Consistent scale used throughout; one arbitrary value in compose area |
| 3. Typography | 7/10 | Two-size palette works well; text scale collapses to xs in too many places |
| 4. Color & Contrast | 5/10 | Hard-coded `bg-blue-600`, `bg-white`, and `bg-slate--*` bypass the design token system |
| 5. Component Consistency | 6/10 | Native `<input type="checkbox">` breaks shadcn pattern; slate overrides differ from app accent |
| 6. Responsiveness & Mobile UX | 8/10 | Slide animation is correct; `h-full` chain relies on parent having an explicit height |

**Overall: 41/60**

---

## Priority Fix List

### P0 — Breaking / Design System Violations

**P0-A: Visitor bubble uses raw `bg-blue-600` instead of a semantic token**
`chat-area.tsx:233`
The visitor bubble is `bg-blue-600 text-white`. In light mode this is acceptable contrast, but the value is a hardcoded Tailwind color that has no relationship to the app's design token system (`--primary`, `--accent`, etc.). If the theme palette ever shifts, this bubble will not follow.
Fix: replace with `bg-primary text-primary-foreground`. In the current dark-mode-only deploy this resolves to `hsl(0 0% 98%) / hsl(240 5.9% 10%)`, which is the correct inversion — flip if the intent is that the visitor bubble is distinctly colored, in which case define a `--chat-visitor` CSS variable.

**P0-B: Assistant bubble is `bg-white dark:bg-slate-800` — breaks in dark mode if `slate-800` drifts from `--card`**
`chat-area.tsx:246`
`bg-white` is a light-mode literal. The dark counterpart `dark:bg-slate-800` maps to approximately `hsl(215 28% 17%)`, which is not the same as `--card` (`hsl(240 10% 3.9%)`) or `--secondary` (`hsl(240 3.7% 15.9%)`). The value is close but will diverge if the design token is adjusted.
Fix: replace with `bg-card text-card-foreground border` or `bg-muted`.

**P0-C: Selected conversation item uses `bg-slate-100/800` instead of `bg-accent`**
`conversation-list.tsx:149-150`
```
bg-slate-100 border-slate-300 dark:bg-slate-800/80 dark:border-slate-700
hover:bg-slate-100 dark:hover:bg-slate-800/70
```
The app's design tokens define `--accent` and `--accent-foreground` for exactly this purpose (hover / selected backgrounds). Using raw slate values creates a divergence from every other selected/hover item in the sidebar (which uses `sidebar-accent`).
Fix: `bg-accent border-border` for selected; `hover:bg-accent` for hover.

### P1 — Notable UX / Accessibility Gaps

**P1-A: "Show debug" uses a native `<input type="checkbox">` at 12px × 12px**
`chat-area.tsx:152-159`
The rest of the app uses shadcn primitives. A bare `<input type="checkbox" className="h-3 w-3" />` at 12 × 12 px has a touch target of 12px — well below the 44px minimum recommended by WCAG 2.5.5 (and even the 24px minimum). In a dense header it is nearly impossible to tap accurately on mobile.
Fix: Replace with shadcn `<Checkbox>` + `<Label>` or a `<Switch>` labeled "Debug". Both are already available in the project's shadcn install.

**P1-B: Icon-only buttons have no accessible label**
`chat-area.tsx:127-134` (back button), `chat-area.tsx:164-167` (more-options button), `chat-area.tsx:269-274` (send button)
None of the icon-only `<Button size="icon">` elements carry an `aria-label`. Screen readers will announce them as unlabeled buttons.
Fix: Add `aria-label` to each:
- Back button: `aria-label="Back to conversations"`
- More options: `aria-label="Conversation options"`
- Send: `aria-label="Send message"`

**P1-C: Loading state is text-only ("Loading messages..."); no skeleton or indicator**
`chat-area.tsx:200-202`
The conversations list has no loading state at all — it simply renders an empty div during the initial fetch. The messages area shows a centered text string. Both are perceptible gaps: the user sees a blank column on first load and a disembodied string in the chat area.
Fix: Use a `Skeleton` component (shadcn) for conversation list rows and a `Spinner` or skeleton bubbles for the message area. At minimum, add a `Loader2` spinner from lucide for the message area.

**P1-D: Errors are silently swallowed — user receives no feedback on failure**
`admin-chat-layout.tsx:29` (fetch conversations), `admin-chat-layout.tsx:44` (fetch messages), `admin-chat-layout.tsx:102-104` (send), `admin-chat-layout.tsx:120-122` (status change), `admin-chat-layout.tsx:132-134` (delete)
Every `catch` block is commented "silently fail." For polling this is acceptable, but for user-initiated actions (send, archive, delete) the user gets no confirmation that their action failed. The optimistic send is rolled back, which is correct, but there is no toast or error indicator.
Fix: On user-initiated mutations (send, status change, delete) call `toast.error(...)` from `sonner` inside the catch block. The `Toaster` is already mounted globally in `layout.tsx`.

### P2 — Polish / Minor Issues

**P2-A: `h-full` on `ChatPage` and `AdminChatLayout` depends on parent having an explicit height**
`chat/page.tsx:7`, `admin-chat-layout.tsx:141`
`<main className="flex-1 overflow-auto">` in `dashboard/layout.tsx:58` is a flex child of `SidebarInset`. `flex-1` on a flex child expands to fill the remaining height only if the parent (`SidebarInset`) is itself height-constrained. If the SidebarInset is not `h-screen` or has no explicit height, the `h-full` chain in the chat components resolves to 0 and the panel collapses.
Recommendation: Verify `SidebarInset` from shadcn sets `display: flex; flex-direction: column; height: 100%` (or similar). If not, add `h-screen` or `h-[calc(100vh)]` to the `<main>` wrapper, or change `flex-1 overflow-auto` to `flex-1 min-h-0 overflow-hidden` so the chat layout's `h-full` resolves correctly.

**P2-B: Conversation list tab triggers use `text-xs` (12px) — below recommended minimum**
`conversation-list.tsx:125-127`
Tab labels "Open", "Archived", "All" are all `text-xs`. At 12px on a retina display this is legible, but it is smaller than the rest of the app's navigation text and conflicts with WCAG SC 1.4.4 (Resize Text) targets. Consider `text-sm` for tab trigger text.

**P2-C: `min-h-[44px]` and `max-h-[150px]` are arbitrary Tailwind values**
`chat-area.tsx:266`
These use the arbitrary bracket syntax rather than design-token-aware spacing. `44px` is a magic touch-target value and `150px` is an uncalibrated cap. These are fine pragmatically but should be documented or replaced with named tokens if the spacing system is ever formalized (e.g., `min-h-11` = 44px in Tailwind's default scale).

**P2-D: "No conversation selected" empty state could be more informative for a cold start**
`chat-area.tsx:107-115`
The copy reads "Select a conversation from the list to view details." This is functional but says nothing about what the inbox is for or what to expect when there are no conversations at all. If the conversations list is also empty (a new org), the user sees two blank panels with no call to action.
Fix: Check if `conversations.length === 0` in `AdminChatLayout` and show a higher-level empty state ("No conversations yet. Conversations from your chat widget will appear here.") centered in the full viewport.

---

## Detailed Findings

### Pillar 1: Visual Hierarchy & Layout (7/10)

The two-panel ResizablePanelGroup is the correct structural pattern for an inbox. The hierarchy within each panel is sound: search + tabs + list on the left, header + message thread + compose on the right.

Issues:
- The selected-conversation action strip (Archive/Delete buttons) appearing inline within the list item disrupts the scanning pattern. A user trying to read the list will see these buttons appear and disappear as they click. Consider moving these to the ChatArea header (which already has a DropdownMenu for the same actions), removing the duplication.
- The empty state icon (`MessageSquare h-16 w-16 opacity-20`) is undersized for a 75% panel. At full desktop width the icon sits in the upper quarter of a tall column. Consider centering it vertically and increasing to `h-24 w-24`.
- The "Show debug" checkbox is placed in the conversation header between the visitor name and the more-options menu. For a tool used by developers only, this placement is prominent. It would be better tucked into the DropdownMenu as a toggle item.

### Pillar 2: Spacing & Density (8/10)

The spacing scale is consistent and uses standard Tailwind steps (2, 3, 4, 8). Conversation list items use `p-3` with `space-y-1` gaps, which gives a comfortable density without being sparse. The compose area uses `px-4 py-3` matching the header.

Issues:
- `min-h-[44px] max-h-[150px]` in `chat-area.tsx:266` — arbitrary values (see P2-C above). Minor.
- The tab bar uses `px-3 pt-2 pb-1` which is asymmetric (2 top, 1 bottom). This is intentional to reduce the gap to the list below but could be `py-2` with a visual separator instead for clarity.

### Pillar 3: Typography (7/10)

Font sizes in use: `text-xs` (12px), `text-sm` (14px), `text-lg` (18px — empty state heading only).
Font weights in use: `font-medium` (500), `font-mono` (monospace — debug messages only).

This is a tight, appropriate type scale for a dense data application. No runaway heading sizes.

Issues:
- `text-xs` is overused: tab triggers, relative timestamps, last-message previews, action buttons, avatar fallbacks, and the compose textarea placeholder label — all at 12px. The net effect is that most of the conversation list renders at the same small size, reducing hierarchy between name (should be primary), last message (secondary), and timestamp (tertiary).
- Suggestion: bump conversation list item names to `text-sm font-medium` (already done), preview text to `text-xs` (already done) — this part is correct. The fix needed is the tab triggers and action buttons, both currently `text-xs`. Tab triggers should be `text-sm` per P2-B.

### Pillar 4: Color & Contrast (5/10)

This is the weakest pillar. The implementation bypasses the Tailwind 4 design token system in multiple places.

Hardcoded values found:
- `chat-area.tsx:233`: `bg-blue-600 text-white` — visitor bubble
- `chat-area.tsx:246`: `bg-white dark:bg-slate-800` — assistant bubble
- `chat-area.tsx:51-58`: `bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-300` — tool_call debug style
- `chat-area.tsx:53-55`: green and red variants for tool_result and error debug styles
- `conversation-list.tsx:149-150`: `bg-slate-100 border-slate-300 dark:bg-slate-800/80 dark:border-slate-700`

The debug message color-coding (blue/green/red for tool_call/tool_result/error) is a legitimate exception — these are semantic status colors and there are no equivalent design tokens for them. Documenting this exception is appropriate.

However, the visitor bubble (`bg-blue-600`) and assistant bubble (`bg-white/dark:bg-slate-800`) are not exceptions — they are conversation UI chrome that should respect the theme. In dark mode, `bg-white` is explicitly wrong (it flips the bubble to a bright white rectangle on a near-black background). The `dark:bg-slate-800` override corrects this but diverges from `--card`/`--muted` tokens.

Contrast ratios (estimated from CSS variables):
- Visitor bubble dark mode: `hsl(221 83% 53%)` text on `hsl(221 83% 53%)` bg — this is not the case since text is `text-white`. Blue-600 on white text is approximately 4.5:1, which passes AA. In dark mode the bubble stays blue-600 (no dark variant), which is still acceptable contrast for white text but stands out as a bright saturated island on a desaturated dark UI.

### Pillar 5: Component Consistency (6/10)

The implementation is largely consistent with the shadcn component set: `Button`, `Textarea`, `Avatar`, `ScrollArea`, `Tabs`, `Badge`, `DropdownMenu`, `AlertDialog`, `Input` — all from shadcn.

Issues:
- `chat-area.tsx:153`: Native `<input type="checkbox">` with `className="h-3 w-3"`. The shadcn `Checkbox` component exists in this project. This single native element breaks the consistency contract and the touch target (see P1-A).
- `conversation-list.tsx:149`: Selected state uses `bg-slate-800/80` while the rest of the sidebar navigation uses `sidebar-accent` (which is `hsl(240 3.7% 15.9%)` in dark mode — visually similar but semantically different). Unifying these would ensure the behavior matches if the theme tokens are updated.
- The duplicate action buttons are a consistency issue: Archive/Delete live in both the ConversationList item (as ghost buttons revealed on selection) and in the ChatArea header DropdownMenu. These two surfaces need to stay in sync and represent redundant code paths that could diverge.

### Pillar 6: Responsiveness & Mobile UX (8/10)

The CSS-transform slide approach (`translate-x-0` / `-translate-x-full` / `translate-x-full`) is the correct pattern for a native-feeling mobile transition without JavaScript layout thrashing. The 300ms ease-in-out timing is appropriate.

Issues:
- The `h-full` height chain (see P2-A) is the primary risk. If `SidebarInset` does not propagate an explicit height, the mobile layout's `flex-1 overflow-hidden` wrapper on the mobile container (`admin-chat-layout.tsx:184`) will not fill the viewport. This should be load-tested on an actual device.
- The `ResizablePanel` is hidden on mobile via `hidden md:flex` and the mobile layout is shown via `flex md:hidden`. This is the correct utility pattern and will not cause double-render issues since both panels share the same React state in `AdminChatLayout`.
- There is no tablet breakpoint consideration. The layout jumps from mobile slide (< 768px) to two-panel ResizablePanelGroup (>= 768px). At 768px the left panel is `minSize={20}` of the panel group width, which at 768px viewport (minus sidebar ~220px) = ~110px — below the `min-w-[280px]` constraint. The `min-w-[280px]` CSS constraint will override the `minSize={20}` percentage, potentially causing the ResizablePanelGroup to clip. Recommend testing at 768px–900px.

---

## Files Audited

- `src/app/(dashboard)/chat/page.tsx`
- `src/components/chat/admin-chat-layout.tsx`
- `src/components/chat/chat-area.tsx`
- `src/components/chat/conversation-list.tsx`
- `src/components/layout/app-sidebar.tsx`
- `src/app/(dashboard)/layout.tsx`
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/types/chat.ts`
- `.planning/phases/06-chat-inbox/06-CONTEXT.md`
- `.planning/phases/06-chat-inbox/06-05-SUMMARY.md`
