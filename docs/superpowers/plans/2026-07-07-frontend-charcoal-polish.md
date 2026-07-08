# Frontend Charcoal Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soft charcoal dark theme, remove idle StatusLog banner, light UX polish on Runs and Settings.

**Architecture:** Extend Tailwind with a `charcoal` color scale from CSS design tokens; migrate shell/pages off near-black zinc; StatusLog returns null when idle and a compact chip when active.

**Tech Stack:** Next.js App Router, React, Tailwind CSS

## Global Constraints

- Palette hex values from spec: bg `#1c1c1f`, surface `#2a2a2e`, raised `#323238`, border `#3f3f46`, text `#e4e4e7`, muted `#a1a1aa`, accent `#5b8def`
- No pure black backgrounds on touched surfaces
- Idle StatusLog: render nothing; active: compact chip only
- No new features / API changes; no light mode
- Skip git commits unless the user explicitly asks (repo may have no history)

---

### Task 1: Charcoal tokens

**Files:**
- Modify: `packages/web/app/globals.css`
- Modify: `packages/web/tailwind.config.js`
- Modify: `packages/web/app/layout.tsx`

- [ ] **Step 1:** Add CSS variables on `:root` / `html` and set `html, body` to charcoal bg/text
- [ ] **Step 2:** Extend Tailwind `theme.extend.colors.charcoal` with bg, surface, raised, border, text, muted, accent
- [ ] **Step 3:** Update root layout body classes to `bg-charcoal-bg text-charcoal-text`

### Task 2: StatusLog

**Files:**
- Modify: `packages/web/components/StatusLog.tsx`

- [ ] **Step 1:** If `events.length === 0`, return `null`
- [ ] **Step 2:** Replace gradient pill with compact left-friendly chip (`bg-charcoal-raised border-charcoal-border text-sm`)

### Task 3: Shell + workspace chrome

**Files:**
- Modify: `packages/web/components/ide/IdeLayout.tsx`
- Modify: `packages/web/components/ide/ActivityBar.tsx`
- Modify: `packages/web/components/ide/SecondaryPageShell.tsx`
- Modify: `packages/web/components/ide/OrchestratorChat.tsx`
- Modify: `packages/web/components/ide/ObservabilityTabs.tsx`
- Modify: `packages/web/components/ide/IdeShell.tsx`
- Modify: `packages/web/app/settings/page.tsx` (loading fallback)

- [ ] **Step 1:** Replace zinc-950/900/800 shell colors with charcoal tokens
- [ ] **Step 2:** Accent focus rings / active tabs use `charcoal-accent` (or soft blue derived from it)
- [ ] **Step 3:** Loading fallbacks use charcoal bg

### Task 4: Graph + secondary panels

**Files:**
- Modify: `packages/web/components/GraphViewer.tsx` (node idle bg/border)
- Modify: other high-traffic panels as needed for consistency (`AgentDebugPanel`, `ChatMessage`, etc. if still near-black)

- [ ] **Step 1:** Idle graph nodes use charcoal surface/border instead of zinc-900/700
- [ ] **Step 2:** Quick pass on remaining workspace panels that flash black

### Task 5: Runs page UX

**Files:**
- Modify: `packages/web/app/runs/page.tsx`

- [ ] **Step 1:** Page header with title, subtitle, primary New run button
- [ ] **Step 2:** Status chips by status
- [ ] **Step 3:** Denser rows + empty state with CTA

### Task 6: Settings page UX

**Files:**
- Modify: `packages/web/components/ide/SettingsPanel.tsx`

- [ ] **Step 1:** Page header pattern matching Runs
- [ ] **Step 2:** Split into clearer section cards (status, credentials groups)
- [ ] **Step 3:** Inputs/buttons use charcoal raised + accent focus

### Task 7: Verify

- [ ] **Step 1:** Confirm StatusLog idle path returns null (code review)
- [ ] **Step 2:** Smoke-check pages load if dev server available
