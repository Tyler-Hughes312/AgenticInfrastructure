# Frontend charcoal polish — design

**Date:** 2026-07-07  
**Status:** Approved for planning  
**Approach:** Token pass + targeted polish (Approach 1)

## Goal

Make the web UI production-ready: soft charcoal dark theme (not pure black), remove the large idle “Initializing supervisor…” status pill, and lightly upgrade Runs and Settings for clarity and consistency.

## Decisions locked

| Decision | Choice |
|----------|--------|
| Idle status pill | Remove entirely when idle / no events |
| Active-run status | Subtle compact inline chip only |
| Theme | Soft charcoal mid-grays |
| Scope depth | Visual polish + light UX (not deep redesign) |
| Implementation style | CSS/Tailwind tokens + targeted page updates |

## Theme tokens

| Token | Role | Hex |
|-------|------|-----|
| `--bg` / `charcoal.bg` | App background | `#1c1c1f` |
| `--surface` / `charcoal.surface` | Panels / cards | `#2a2a2e` |
| `--surface-raised` / `charcoal.raised` | Headers, inputs | `#323238` |
| `--border` / `charcoal.border` | Dividers | `#3f3f46` |
| `--text` / `charcoal.text` | Primary text | `#e4e4e7` |
| `--muted` / `charcoal.muted` | Secondary text | `#a1a1aa` |
| `--accent` / `charcoal.accent` | Focus / primary actions | `#5b8def` |

Wire tokens in `packages/web/app/globals.css` and extend `packages/web/tailwind.config.js` so components can use `bg-charcoal-bg`, `border-charcoal-border`, etc.

Replace hard-coded near-black (`zinc-950`, `#09090b`) on touched surfaces with these tokens. Keep zinc utility usage only where it maps cleanly to the new palette, or migrate those call sites to charcoal tokens.

## Status behavior

### Current problem

`StatusLog` always renders a large centered gradient pill. With no events it shows “Initializing supervisor...”, which dominates the Graph tab even when nothing is running.

### Target behavior

1. **Idle / empty events:** `StatusLog` returns `null` (no UI).
2. **Active run (events present or session running):** Compact, non-centered chip (small padding, quiet surface/border, no blue→purple gradient). Prefer placement above the graph content area, left-aligned or tucked under the tab strip — not a hero banner.
3. **Chat:** Existing in-chat status messages during runs remain; they must not compete with a large Graph banner.

## Pages

### Workspace (main `/`)

- Apply charcoal tokens to `IdeLayout`, `ActivityBar`, `ObservabilityTabs`, `OrchestratorChat`, graph node surfaces, loading fallbacks.
- StatusLog behavior as above.
- Tighten tab/header spacing slightly; keep Graph as default tab and existing panel structure.

### Runs (`/runs`)

- Shared page header: title, short subtitle, primary “New run” button (not a bare text link).
- Status column uses chips (`running`, `completed`, `error`, etc.) with muted charcoal backgrounds and clear color cues.
- Denser table rows; clearer empty state with CTA back to workspace.
- Keep existing columns, polling, and data fetching.

### Settings (`/settings`)

- Same page header pattern as Runs.
- Clearer section cards: Connection status → Credentials → Models/repo (existing fields, improved hierarchy/spacing).
- Inputs use raised surface + accent focus ring; keep simple save feedback.

### Shared shell

- `SecondaryPageShell` and activity bar match workspace charcoal.
- Suspense/loading fallbacks use charcoal bg (no black flash).

## In scope

- Token system + Tailwind extension
- `StatusLog` idle → null; active → compact chip
- Restyle: IdeLayout, ActivityBar, OrchestratorChat, ObservabilityTabs, GraphViewer node colors, SecondaryPageShell, loading fallbacks
- Runs and Settings light UX upgrades above
- Swap near-black backgrounds on touched surfaces

## Out of scope

- New product features or API changes
- Chat protocol / orchestrator behavior changes
- Full shared component library
- Deep layout redesign of observability panels
- Light mode

## Success criteria

1. No large “Initializing supervisor…” banner when idle.
2. UI reads as soft charcoal gray, not pure black.
3. Workspace, Runs, and Settings feel visually consistent and production-ready.
4. Active-run status remains discoverable without dominating the layout.

## Key files

- `packages/web/app/globals.css`
- `packages/web/tailwind.config.js`
- `packages/web/app/layout.tsx`
- `packages/web/components/StatusLog.tsx`
- `packages/web/components/ide/IdeLayout.tsx`
- `packages/web/components/ide/ActivityBar.tsx`
- `packages/web/components/ide/OrchestratorChat.tsx`
- `packages/web/components/ide/ObservabilityTabs.tsx`
- `packages/web/components/ide/SecondaryPageShell.tsx`
- `packages/web/components/ide/SettingsPanel.tsx`
- `packages/web/components/GraphViewer.tsx`
- `packages/web/app/runs/page.tsx`
- `packages/web/app/settings/page.tsx` (loading fallback only if needed)
- `packages/web/components/ide/IdeShell.tsx` (loading fallback)
