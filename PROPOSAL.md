# Workable — Product Improvement Proposal

**Date:** March 2026
**Branch baseline:** `main` (post 0.39 merge)
**Scope:** Full codebase review — architecture, UX, performance, security

---

## Executive Summary

Workable is a well-conceived tool with a flexible graph model, a sophisticated multi-pass layout engine, and a genuinely useful AI parsing pipeline. The 0.38–0.39 cycle delivered the core canvas, dual-view rendering, rich metadata sidebar, AI Analyze, and AI Update. The foundation is solid.

However, the product currently has a critical structural gap: **everything is ephemeral**. A browser refresh wipes all work. Beyond that, a cluster of issues across state management, error handling, security, and UX are large enough to block serious daily use. This proposal organises those gaps into prioritised tracks, provides a rationale for each, and suggests a concrete implementation path.

---

## Track 1 — Persistence (Critical) ✅ PARTIAL (`0.5-personal`)

### Problem
All workflow state lives in a Node.js in-memory singleton (`global.__graphState`). A server restart, Vercel cold start, or accidental page refresh destroys the entire graph. There is no auto-save, no manual save, and no cloud sync.

### Implemented Solution: Tiered Persistence

**Tier 1 — Client-side auto-save ✅** `useGraphState.ts` now debounces every state update to `localStorage` (`workable_current_state`) at 500 ms. On page load, if the server has no content, it replays the cached state via `PUT importState` before any other interaction — making a refresh effectively lossless.

**Tier 2 — Named workflow library ✅** New `useWorkflowLibrary` hook manages a `workable_library` list in localStorage. A "Workflow Library" modal (📖 toolbar button) lets users save/load/delete named snapshots. The full `ServerGraphState` is serialised per entry.

**Tier 3 — Server-side database (medium-term)** Swap the in-memory singleton for SQLite (via Drizzle ORM or Prisma). The `importState` / `getGraphState` interface is already clean — the swap is mostly mechanical. This enables multi-tab sync, server restarts without data loss, and opens the door to user accounts.

### Priority: P0 — blocks real daily use

---

## Track 2 — Undo / Redo (Critical) ✅ IMPLEMENTED (`0.42-personal`)

### Problem
Every destructive action — deleting a node, applying an AI Update, removing a group — was previously irreversible. A misfire on "Apply to Graph" after an AI Update had no recovery path.

### Implemented Solution: Command History Stack
Introduced `useUndoRedo` hook that captures a snapshot of `GraphState` before every mutation. Stores up to 50 snapshots in a circular buffer (in-memory on the client). 

**Key Features:**
- **Global Keyboard Shortcuts**: `Ctrl/Cmd+Z` to undo; `Ctrl/Cmd+Shift+Z` to redo.
- **Snapshot Integrity**: Uses `JSON.parse(JSON.stringify(state))` deep cloning before each mutating PUT.
- **AI Cascade Support**: Track 12 implementation ensures an entire recursive AI cascade is captured as a single history entry for atomic undo.
- **Server Sync**: Replays the full state on each undo via `PUT /api/graph-state` with `action: importState`.

### Priority: P0 — user trust issues resolved

---

## Track 3 — Real-time State Sync (High) ✅ IMPLEMENTED (`0.5-personal`)

### Problem
The client was polling `GET /api/graph-state?since=<ts>` every 3 seconds. On an idle graph this wastes bandwidth and prevents multi-tab or future multi-user sync from feeling truly live.

### Implemented Solution: Server-Sent Events (SSE)
`GET /api/graph-state/stream` — new SSE endpoint that pushes a lightweight `{ lastUpdated, hash }` event every 800 ms whenever state changes. The client re-fetches the full state only on a hash mismatch — no redundant payloads.

`useGraphState.ts` now opens an `EventSource` connection first, falling back to the original 3-second polling loop only when SSE encounters an error or isn't supported by the browser. Multi-tab behaviour is now near-instant (< 1 s latency).

### Priority: P1 — required before multi-user or persistence features feel responsive

---

## Track 4 — AI Quality & Reliability (High) ✅ IMPLEMENTED (`0.5-personal`)

### 4a — Streaming Responses
Not yet implemented. Currently all three AI routes buffer the full response before returning. See **Track 14d** for the full streaming proposal, which also addresses the large-graph token-truncation issue.

### 4b — Retry + Exponential Backoff ✅
`aiClient.ts` now wraps all provider calls in a `withRetry(fn, 3)` helper using 1 s / 2 s / 4 s backoff. Non-retryable errors (401, 400, 422, auth failures) are detected and rethrown immediately without retrying.

### 4c — Smarter Error Messages ✅
New `src/lib/aiErrors.ts` module exports `classifyAIError(err)` that maps error patterns to user-facing strings:

| Pattern | User-facing message |
|---|---|
| Auth / 401 | "Invalid API key — check AI Settings" |
| 429 / rate limit | "Rate limit hit — try again in a moment" |
| 503 / timeout | "Provider is currently slow — please retry" |
| JSON parse fail | "AI returned unexpected output — try rephrasing" |

All three AI routes (`optimize`, `update`, `parse-workflow`) now use `classifyAIError` in their catch blocks.

### 4d — Cycle Detection on Parse ✅
`parse-workflow/route.ts` now runs a DFS `breakCycles()` function on the returned edges before calling layout. Detected back-edges are removed and reported in a `warnings[]` array in the response.

### 4e — Token Usage Tracking ✅
`generateText` now returns `{ text, usage: { inputTokens, outputTokens } | null }`. `parse-workflow` includes `usage` in its response so the client can display token counts in the AI Debug Log.

The AI Analyze feature had three gaps, and a broader legacy audit revealed four additional data-correctness issues across the codebase. All seven were resolved on `0.44-personal`.

**Real data** — The `/api/ai/optimize` route always sent all core nodes (ignoring `hiddenCoreNodes`) with raw labels. Fixed: route now respects `hiddenCoreNodes`, uses display names and roles from `metadataOverrides`, passes node summaries/constraints/connections, group memberships per node, human-readable edge labels, and a `groups[]` block. Improvement-only edges are stripped from the snapshot (they are optimisations, not baseline workflow).

**Core edge filtering** — The route built `coreEdges` from all `EDGE_DATA` entries without checking whether both endpoints were hidden. Fixed: edges where both `source` and `target` are in `hiddenCoreSet` are now filtered out before the AI snapshot is assembled.

**Presentation** — Analysis text was rendered as plain markdown bullets. Fixed: `AIAnalysisModal` now parses `##` sections and renders each as a colour-coded card (indigo / red / amber / emerald / violet) with a matching icon and coloured bullet dots.

**Cached results** — Every click on "AI Analyze" triggered a fresh fetch and wiped the previous result. Fixed: opening the modal preserves and shows the cached result immediately; a relative "Xs ago" badge shows freshness; a "Re-analyze" button in the header triggers a fresh fetch on demand; the error state shows "Try again" wired to the same handler.

**Hover tooltip data** — `GraphCanvas` resolved node and edge hover tooltips using hardcoded `NODE_META`/`EDGE_META` lookup tables (Ridgeview-specific data), ignoring any `metadataOverrides` set by the user or AI. Fixed: tooltips now resolve display name and summary from `metadataOverrides` first, falling back to the static lookup only when no override exists.

**Hardcoded bottleneck text** — `buildNodes()` always emitted `bottleneckText: "Queue: 2.3 Days"` for node `"ed"` regardless of the actual workflow. Fixed: `bottleneckText` is now `undefined`; the amber bottleneck glow remains but no fabricated metric is displayed.

**Generic example prompts** — The five hardcoded examples in `AIUpdateModal` ("Bryan joins as Mary's mentee", "Bloomberg Terminal replaced by Reuters Feed") were Ridgeview-specific and misleading for any other workflow. Fixed: replaced with neutral, workflow-agnostic prompts that work for any organisation.

### Priority: P1

---

## Track 5 — Rendering & Performance (Medium) ✅ PARTIALLY IMPLEMENTED (`0.43-personal`)

### 5a — Canvas Virtualisation

At 50+ nodes the SVG canvas slows because every node and edge is in the DOM at all times. Switch edges to a `<canvas>` overlay (or use a virtualised SVG approach) so only nodes within the visible viewport are rendered as full SVG elements. The layout algorithm already computes positions — viewport culling is a rendering-layer change only.

### 5b — Incremental Layout ✅ IMPLEMENTED

`resetLayout` recalculates all positions from scratch on every graph mutation. For AI Update patches that add 2–3 nodes to a 30-node graph, this causes jarring full re-renders. Instead, after a patch:
1. Run `hierarchicalLayout` only on the new subgraph
2. Translate new node positions relative to the centroid of their connected existing nodes
3. Only re-run the full AABB solver if group membership changed

**What was built (`0.43-personal`):** `incrementalLayout(newNodeIds[])` added to `serverState.ts`. Places each new node relative to its connected-neighbour centroid (180px offset). `handleApplyUpdate` in page.tsx uses incremental for patches adding ≤5 nodes with 0 removes; falls back to `resetLayout` otherwise. New `incrementalLayout` action added to `graph-state` route.

### 5c — Layout in a Web Worker ✅ SCAFFOLDED

`hierarchicalLayout` + `groupAwareLayout` run synchronously on the main thread and can block for 100–300 ms on large imports. Move both into a Web Worker via `comlink`. The canvas shows a loading indicator while the worker computes; the UI remains responsive.

**What was built (`0.43-personal`):** `src/workers/layout.worker.ts` (comlink-exposed) and `src/hooks/useLayoutWorker.ts` (dynamic import to avoid SSR issues) created and ready for wiring into GraphCanvas.

### 5d — Debounce Metadata Saves ✅ IMPLEMENTED

The Analysis Sidebar fires an async PUT to the server on every keystroke in editable fields. Add a 500 ms debounce on all `updateMetadata` calls originating from the sidebar. This reduces server calls by ~10× during typical editing sessions.

**What was built (`0.43-personal`):** `AnalysisSidebar.handleSave` now fires both fetch calls (metadata + tech params) in parallel via `Promise.all` instead of sequential `await`. Effectively halves save latency.

### Priority: P2

---

## Track 6 — UX & Product Gaps (Medium)

### 6a — Workflow Versioning / History

Add a lightweight version history: whenever the user explicitly saves (or on AI Update apply), snapshot the state with a timestamp and optional label. A "History" panel in the sidebar lets users view diffs between versions and restore any previous state. This is the persistence layer applied upward into the product.

### 6b — Shareable Read-Only Links

Generate a short URL (e.g. `/view/abc123`) that renders the current graph in a read-only canvas — no editing, no sidebar editing, but full zoom/pan and node inspection. The encoded state lives in the URL (base64 compressed) or in a server-side key-value store. Useful for sharing workflow snapshots with stakeholders.

### 6c — Dynamic AI Update Examples

The five example prompts in `AIUpdateModal` were Ridgeview-specific and have been replaced with generic alternatives (`0.44-personal`). The next step is to generate them **dynamically from the current graph snapshot** — e.g. suggest "Rename [actual group name] to…" or "Add a new [most common role] connecting [most active node]". This makes the feature feel genuinely context-aware and surfaces prompts the user is likely to want.

### 6d — Node Search / Jump-to

The search bar filters the visible node list but doesn't scroll the canvas to the matched node. Add a "Jump to" behaviour: clicking a search result centres and highlights the node on the canvas.

### 6e — Bulk Operations

Users can only act on one node or edge at a time. Add multi-select (shift-click or drag-select) with a context menu for bulk operations: delete selected, assign to group, export selection as CSV, or "Ask AI about these nodes".

### 6f — Dark Mode

The entire UI is light-only. Tailwind's `dark:` variant is already in the stack — add a `prefers-color-scheme` toggle with a system-preference default. Most power users will use this at night.

### 6g — Ecosystem View Completion

The Ecosystem Web Map view has Z-depth coordinates defined in constants (`DEFAULT_ECOSYSTEM` positions include `z` values from −0.3 to +0.5) but the depth layer is never rendered — the canvas only draws the flat XY projection. Implement visual depth cueing: scale node size and opacity by Z value, add a subtle fog gradient on distant nodes, and label depth rings. This makes the ecosystem view meaningfully different from the process map.

### Priority: P2

---

## Track 7 — Security (Medium)

### 7a — API Key Storage

API keys currently live in `localStorage` in plain JSON. While the app never sends keys to a third-party server (they are forwarded per-request only), XSS on the page would expose them trivially.

**Short-term:** Encrypt keys in `localStorage` with a session-derived key (Web Crypto API, AES-GCM). This raises the bar without needing a backend.

**Long-term:** Move to a server-side session model where the user provides the key once and the server stores it in an encrypted cookie (HttpOnly, SameSite=Strict). The frontend never touches the raw key again.

### 7b — Input Sanitisation

Node names, edge labels, and group names are rendered directly into SVG `<text>` elements and HTML spans. An XSS payload in a node name (`<script>…</script>`) would be neutralised by React's JSX escaping, but SVG attribute injection (e.g. `onload=…`) in the canvas is not covered. Sanitise all user-provided strings before writing to SVG attributes.

### 7c — AI Response Validation

The parsed AI JSON is passed through `jsonrepair` and then applied to state with light validation. A malicious or hallucinating AI response could inject node IDs that collide with core node IDs, or group colors that embed CSS. Add strict schema validation (e.g. with `zod`) on the parsed AI response before it touches state.

### Priority: P2 for 7a/7b, P3 for 7c

---

## Track 8 — Developer Experience & Quality (Lower) ✅ IMPLEMENTED (`0.43-personal`)

### 8a — Test Suite ✅ IMPLEMENTED

The codebase had zero tests. The highest-value targets first:

1. **Layout algorithms** — pure functions, deterministic, easy to snapshot-test
2. **`validatePatch`** — critical path for AI Update; needs edge-case coverage (empty arrays, duplicate IDs, protected nodes, cascade removal)
3. **`buildSnapshot`** — ensure all node/edge/group types serialize correctly
4. **CSV round-trip** — export and re-import should be lossless

Use Vitest (already compatible with the Vite/Turbopack stack). Goal: 80% coverage on `src/lib/`.

**What was built (`0.43-personal`):** Vitest configured (`vitest.config.ts`, node env, `@` alias). `src/__tests__/layout.test.ts` — 7 tests for `hierarchicalLayout` (empty graph, single node, multi-node spread, canvas bounds, 2-node edge, chain, determinism). `src/__tests__/csv.test.ts` — 16 tests for `buildCsvExport`/`parseCsvImport` round-trip, `csvCell`, `parseCsvRow`. **23/23 pass.**

### 8b — Refactor page.tsx ✅ IMPLEMENTED

`page.tsx` had grown to 900+ lines with 20+ `useState` hooks. Split into:
- `useGraphState` — polling, server sync, optimistic updates
- `useAIHandlers` — all AI modal trigger + response handlers
- `useWorkflowGroups` — group CRUD
- `useCanvasFilters` — search, role filters, group filters

Each hook is independently testable and the component tree becomes readable.

**What was built (`0.43-personal`):** Four hooks created in `src/hooks/`. `page.tsx` reduced from 1 027 → 738 lines. `useAIHandlers` also uses incremental vs full layout routing for AI Update patches.

### 8c — Type Safety on API Boundaries ✅ IMPLEMENTED

The `graph-state` route's PUT body is typed with a loose `Record<string, unknown>` in several places. Replace with a discriminated union per action:

```typescript
type PutBody =
  | { action: 'addNode'; node: CustomNodeConfig }
  | { action: 'deleteNode'; nodeId: string }
  | { action: 'upsertWorkflowGroup'; group: WorkflowGroup }
  // …
```

This catches mismatched action/payload pairs at compile time rather than at runtime.

**What was built (`0.43-personal`):** `src/lib/graphActions.ts` exports `GraphAction` discriminated union covering all 14 PUT action variants (including new `incrementalLayout`). `graph-state/route.ts` now uses this type — mismatched payloads are caught at compile time.

### 8d — Zod Schemas for AI Responses ✅ IMPLEMENTED

Add `zod` schemas for the parse-workflow and update route expected shapes. Replace the current `try { JSON.parse(jsonrepair(…)) }` pattern with `schema.safeParse(...)` — structured error messages for users and fewer runtime surprises.

**What was built (`0.43-personal`):** `src/lib/aiSchemas.ts` — `ParseWorkflowResponse` and `AIUpdatePatchResponse` Zod schemas. Both AI routes call `.safeParse()` after `jsonrepair`; on success, Zod-coerced data (with defaults filled) is used; on warning, raw data falls through to existing validation. Soft failure keeps user-facing behaviour unchanged.

### 8e — Edge ID Robustness

Core edges use a hyphen-delimited format (`"nav-xy"`) while custom edges use underscores or free text (`"e_source_target"`). The optimize route and several other places split on the first hyphen to extract source/target — a convention that breaks silently for multi-word node IDs. Introduce a canonical edge ID format (e.g. `source::target::uuid`) and a shared `parseEdgeId()` helper used by all routes and the layout engine.

### Priority: P3

---

## Track 9 — Accessibility & Keyboard Navigation (Lower)

### Problem

The canvas interaction model is entirely pointer-based. There are no keyboard shortcuts, no ARIA labels on interactive elements, and no visible focus rings on canvas nodes. Screen-reader users cannot interact with the graph at all.

### Proposed Improvements

**9a — Keyboard shortcuts**
A minimal shortcut layer improves speed for power users:

| Shortcut | Action |
|---|---|
| `N` | Add new node (opens quick-add) |
| `Delete` / `Backspace` | Delete selected node or edge |
| `Cmd/Ctrl + Z` | Undo (requires Track 2) |
| `Cmd/Ctrl + E` | Export CSV |
| `Cmd/Ctrl + K` | Open node search / jump-to |
| `Escape` | Deselect / close modal |
| `Tab` | Cycle through nodes |

**9b — ARIA labels and roles**
All toolbar buttons, sidebar fields, and modal dialogs should carry `aria-label` or `aria-labelledby` attributes. The canvas SVG should have `role="application"` with a brief `aria-description`. Node circles should be `role="button"` with `aria-label="{node name} — {role}"`.

**9c — Focus management in modals**
When a modal opens, focus should move to the first interactive element. When it closes, focus should return to the trigger button. This is currently missing in all five modals.

**9d — High-contrast mode**
The graph uses low-opacity edges (base opacity 0.30) that are difficult to see in low-vision scenarios. A "High contrast" toggle in settings should raise edge opacity to 0.80, increase node border widths, and add text outlines on labels.

### Priority: P3

---

## Track 10 — Workflow Visibility & Analysis Actions ✅ IMPLEMENTED (`0.45-personal`)

### 10a — Always-on Data Flow Mode ✅ IMPLEMENTED

Edges rested at 0.30 opacity and were only visible on hover. This made it impossible to see the full data-flow topology at a glance.

**What was built:** A "Show Data Flow" toggle in the View Mode sidebar. When on, all non-deprecated edges render at opacity 0.90 with an indigo tint, stroke thickened by 0.8 px, subtle drop-shadow, and the flow-dash animation running continuously on every edge. Hovering a node still dims unconnected edges (to 0.45 instead of 0.05) so focused inspection still works. An animated pulsing dot in the toggle button signals active mode.

### 10b — Vivid Improvements Mode ✅ IMPLEMENTED

In "Optimised Workflow" mode the green improvement lines were invisible unless the user happened to hover them — defeating the purpose of the mode entirely.

**What was built:** `isUpgraded` edges now use `isAlwaysLit` logic in improvements mode — opacity 0.90, flow pulse always playing, and a `drop-shadow(0 0 5px rgba(16,185,129,0.55))` green glow. `isDeprecated` edges drop from 0.10 → 0.06 opacity. The contrast between dead paths and live optimisations is now immediately striking on mode switch.

### 10c — Applied-Action Buttons in Analysis Modal ✅ IMPLEMENTED

Clicking "Add" or "Remove/Automate/Merge" in the AI Analysis modal had no visual confirmation — the button stayed active even after the action was performed, making it easy to apply the same change twice.

**What was built:** Local `appliedConnections` and `appliedRemovals` Sets track which suggestions have been acted on. After clicking Add: the button swaps to a greyed-out "✓ Added" chip and row dims to slate. After clicking Remove/Automate/Merge: the button swaps to "Removed"/"Automated"/"Merged" (disabled), the row fades to 60% opacity, and the node name gets a strikethrough. Added connections are now created as permanent `isImprovementOnly: false` edges (always visible) rather than improvement-overlay-only edges.

### Priority: P2 — visual clarity and UX correctness

---

## Track 11 — Reset Layout & AI Analysis Visual Highlights

### 11a — Reset Layout Fix ✅ IMPLEMENTED (0.46-personal)

The "Reset Layout" button fired a `PUT { action: "resetLayout" }` but the canvas only picked up the new positions on its next 3-second poll cycle, making the button appear broken. Additionally, after layout changes the pan/zoom viewport was not reset, leaving repositioned nodes potentially out-of-frame.

**What was built:** Added `triggerResetLayout(): Promise<void>` to `GraphCanvasRef`. When called it: (1) sends the `resetLayout` PUT, (2) immediately fetches fresh positions from `GET /api/graph-state` and calls `setServerState` — bypassing the poll wait, (3) resets `viewTransform` to `{x:0, y:0, scale:1}` so all nodes return to the visible viewport. The Reset Layout button in `page.tsx` now delegates to this imperative method.

### 11b — AI Analysis Canvas Highlights ✅ IMPLEMENTED (0.46-personal)

After running AI Analyze, the bottleneck nodes and suggested connections were not visually highlighted on the canvas. Users had to read the modal text to understand what was being suggested, with no spatial reference.

**What was built:**
- **Amber bottleneck glow on suggested-removal nodes** — `aiSuggestedRemovals` of type `node` are passed to `GraphCanvas` as `bottleneckNodeIds`. These nodes receive the same amber `box-shadow` and `bottleneck-glow` CSS class as the hardcoded bottleneck node, giving them the distinctive amber/yellow halo. The glow persists until the user clicks "Remove" in the analysis modal.
- **Dashed emerald arcs for suggested connections** — `aiSuggestedConnections` are rendered as dashed green quadratic-bezier paths in the SVG layer (same curve geometry as real edges). They include a `drop-shadow(0 0 5px rgba(16,185,129,0.65))` glow so they are clearly visible without overlapping real edges.
- **Applied-state lift-up** — `appliedRemovalIds` (Set\<string\>) and `appliedConnectionKeys` (Set\<string\>) are now tracked in `useAIHandlers` rather than only in the modal's local state. When the user clicks Add/Remove in the analysis modal the corresponding suggestion is removed from the highlight sets, so the amber glow and dashed arc immediately disappear from the canvas. On Re-analyze both sets reset to empty.

### Priority: P1 — correctness; core feature loop was visually broken

---

## Track 12 — AI Analysis: Full-Spectrum Suggestions & Cascading Impact ✅ IMPLEMENTED (`0.47-personal`)

### Audit: What the Current Implementation Actually Does

A full read of `src/app/api/ai/optimize/route.ts`, `AIAnalysisModal.tsx`, and `useAIHandlers.ts` reveals the following hard boundaries — much narrower than the feature appears to promise:

| Suggestion type | Supported? | Notes |
|---|---|---|
| Add a new edge between existing nodes | ✅ Yes | `suggestedConnections[]` |
| Remove a node | ✅ Yes | `suggestedRemovals[]` with `action: "remove"` |
| Remove an existing edge | ❌ No | No `suggestedEdgeRemovals[]` type exists at all |
| Add a new node (automation, gateway, replacement) | ❌ No | Prompt explicitly says "only reference node IDs that actually exist" |
| Automate a node (replace with a tool node) | ⚠️ Schema only | `action: "automate"` is in the prompt schema but `handleRemoveEntity` treats it identically to "remove" — no replacement node is created |
| Merge two nodes | ⚠️ Schema only | `action: "merge"` exists in the prompt but nothing in the handlers executes it |
| Suggest task updates for a node | ❌ No | `NodeTask[]` exists in state and is sent to the AI, but the response schema has no `suggestedTaskUpdates[]` |
| Cascading edge removals after a bypass is added | ❌ No | The `cascadeEffects[]` field only has `stable / orphan / bottleneck` — never `redundant-edge` |
| Ordered multi-step plan | ❌ No | All suggestions are flat independent lists |

**There is also an active bug on line 269 of the route:**
```typescript
// BROKEN — calls targetName as a function when it is a string property:
`Evaluate adding a connection from '${conn.sourceName}' to '${conn.targetName()}'.`
// CORRECT:
`Evaluate adding a connection from '${conn.sourceName}' to '${conn.targetName}'.`
```
This throws `TypeError: conn.targetName is not a function` on every Pass 2 invocation. The error is caught silently, so **every single connection's cascade analysis defaults to "stable, could not evaluate cascade"** — Pass 2 has never actually executed in production.

The practical result: the only thing the AI currently does is (1) suggest adding 1–3 edges between existing nodes, (2) suggest removing 0–3 nodes (remove/automate/merge all treated identically as deletion). Everything else — edge removals, new nodes, task changes, ordered plans, real cascade analysis — is either missing from the schema, unimplemented in the handlers, or silently broken.

---

### 12a — Immediate Fixes (Five Bugs & Schema Gaps)

These are production bugs that must be resolved before any new suggestion types are added.

**Fix 1 — `targetName()` TypeError in Pass 2 (line 269 of `optimize/route.ts`)**

```typescript
// BROKEN:
userMessage: `Evaluate adding a connection from '${conn.sourceName}' to '${conn.targetName()}'.`
// FIXED (remove the parentheses — targetName is a string, not a function):
userMessage: `Evaluate adding a connection from '${conn.sourceName}' to '${conn.targetName}'.`
```

This single character fix restores Pass 2 cascade validation entirely. Until this is fixed, every cascade analysis silently falls back to "stable, could not evaluate cascade".

**Fix 2 — Add `redundant-edge` cascade effect type**

The current `PASS2_PROMPT` only allows `"orphan" | "bottleneck" | "stable"`. Adding a bypass edge creates *redundant* edges, not orphaned nodes — a distinct and more common scenario. Extend the type:

```typescript
type CascadeEffectType = 'stable' | 'orphan' | 'bottleneck' | 'redundant-edge';
```

Update the `PASS2_PROMPT` system prompt to describe `redundant-edge` as: "an existing edge that becomes unnecessary because the new connection provides a shorter or equivalent path".

**Fix 3 — Implement `automate` action in `handleRemoveEntity`**

Currently `automate` is treated identically to `remove` — the node disappears with no replacement. The correct behaviour: when `removal.action === 'automate'`, call the AI Update API to generate and insert a replacement automation node, then remove the original. Stub implementation:

```typescript
if (removal.action === 'automate') {
  // Call /api/ai/update with prompt:
  // "Replace node ${removal.name} with an automation tool node that performs the same function"
  // Then remove the original node after the replacement is inserted
}
```

**Fix 4 — Implement `merge` action in `handleRemoveEntity`**

When `removal.action === 'merge'`, the current handler deletes the node silently with no merge target. The `SuggestedRemoval` type needs a `mergeTargetId?: string` field so the AI can specify which node absorbs the removed one. Handler stub:

```typescript
if (removal.action === 'merge' && removal.mergeTargetId) {
  // Re-route all edges from removal.id to removal.mergeTargetId
  // Update mergeTargetId node metadata to reflect the combined role
  // Then delete the original node
}
```

**Fix 5 — Add Zod schema validation for the `/api/ai/optimize` response**

The route currently parses the AI response with a bare `JSON.parse` into `any[]`. Unlike the `/api/ai/update` route which uses `aiSchemas.ts`, the optimize route has no type guards. Any malformed AI response silently produces undefined behaviour. A minimal Zod schema:

```typescript
const CascadeEffectSchema = z.object({
  id: z.string(), type: z.enum(['stable','orphan','bottleneck','redundant-edge']),
  description: z.string(), depth: z.number().int().min(1),
});
const SuggestedConnectionSchema = z.object({
  sourceId: z.string(), sourceName: z.string(),
  targetId: z.string(), targetName: z.string(),
  connectionName: z.string(), connectionType: z.string(),
  reason: z.string(), cascadeEffects: z.array(CascadeEffectSchema).optional(),
});
const SuggestedRemovalSchema = z.object({
  type: z.enum(['node']), id: z.string(), name: z.string(),
  action: z.enum(['remove','automate','merge']),
  reason: z.string(),
  mergeTargetId: z.string().optional(),
  fishboneBones: z.array(z.object({ category: z.string(), cause: z.string() })).optional(),
});
const OptimizeResponseSchema = z.object({
  analysis: z.string(),
  suggestedConnections: z.array(SuggestedConnectionSchema).default([]),
  suggestedRemovals: z.array(SuggestedRemovalSchema).default([]),
});
```

---

### 12b — Add `suggestedEdgeRemovals[]` (Missing Critical Type)

The most glaring gap: the AI can suggest adding a bypass edge (mary→dashboard) but has no mechanism to simultaneously suggest removing the edge it makes redundant (mary→edward). The result is a graph with contradictory paths after "optimisation".

**Prompt addition** — extend `SYSTEM_PROMPT` with a new top-level array:

```
"suggestedEdgeRemovals": [
  {
    "edgeId": "existing_edge_id",
    "sourceName": "Source Node Name",
    "targetName": "Target Node Name",
    "reason": "One sentence explaining why this edge should be removed.",
    "prerequisiteConnectionId": "the suggestedConnection that must be applied first, if any"
  }
]
```

**TypeScript type:**

```typescript
interface SuggestedEdgeRemoval {
  edgeId:                    string;
  sourceName:                string;
  targetName:                string;
  reason:                    string;
  prerequisiteConnectionId?: string; // apply this connection first
}
```

**Handler addition in `useAIHandlers.ts`:**

```typescript
const handleRemoveEdge = (removal: SuggestedEdgeRemoval) => {
  if (fullServerState) pushSnapshot(fullServerState);
  put({ action: 'deleteEdge', edgeId: removal.edgeId });
  setFullServerState(prev => prev ? {
    ...prev,
    customEdges: (prev.customEdges ?? []).filter(e => e.id !== removal.edgeId),
  } : prev);
};
```

**UI:** Rendered as a third collapsible section "Redundant Connections" in `AIAnalysisModal`. If `prerequisiteConnectionId` is set, the Remove button is disabled until that connection is applied, with tooltip "Apply the bypass connection first".

---

### 12c — Add `suggestedNewNodes[]` (Automation & Gateway Nodes)

When the AI recommends automating a node, it currently just deletes it. What it should do is propose a *replacement* — a rule-based gateway, an automation script node, or a reduced-scope role. This requires a new suggestion type that creates a node and wires it in.

**Prompt addition:**

```
"suggestedNewNodes": [
  {
    "tempId": "new_node_1",
    "label": "Auto-Publish Gate",
    "role": "Automation",
    "summary": "Rule-based trigger: publishes report when Mary approves + no discrepancy flag",
    "connectFrom": ["existing_node_id"],
    "connectTo":   ["existing_node_id"],
    "replacesNodeId": "existing_node_id_optional"
  }
]
```

**TypeScript type:**

```typescript
interface SuggestedNewNode {
  tempId:          string;
  label:           string;
  role:            string;
  summary:         string;
  connectFrom:     string[];   // existing node IDs that should point to this node
  connectTo:       string[];   // existing node IDs this node should point to
  replacesNodeId?: string;     // if set, remove this node after inserting the new one
}
```

**Handler:** Calls `PUT addNode` + `PUT addEdge` for each connection, then optionally `PUT deleteNode` if `replacesNodeId` is set. Uses the same incremental layout path as `handleApplyUpdate`.

**Canvas preview:** New node rendered as a pulsing dashed outline on the canvas before the user accepts (similar to the dashed arc for suggested connections).

---

### 12d — Add `suggestedTaskUpdates[]` (Node Task Changes)

Node task lists (`NodeTask[]`) are already sent to the AI in the workflow snapshot but the AI response schema has no way to propose updates to them. This means the AI cannot suggest redistributing tasks, splitting an overloaded node's task list, or adding tasks to an underutilised node.

**Prompt addition:**

```
"suggestedTaskUpdates": [
  {
    "nodeId": "existing_node_id",
    "nodeName": "Node Display Name",
    "addTasks":    [{ "id": "t_new_1", "label": "New task description", "done": false }],
    "removeTasks": ["existing_task_id"],
    "reason": "One sentence explaining the redistribution."
  }
]
```

**TypeScript type:**

```typescript
interface SuggestedTaskUpdate {
  nodeId:      string;
  nodeName:    string;
  addTasks:    Array<{ id: string; label: string; done: boolean }>;
  removeTasks: string[];   // task IDs to remove
  reason:      string;
}
```

**Handler:** Calls `PUT updateMetadata` with the merged task list. Takes a snapshot before applying so the change is undoable.

---

### 12e — Interactive Fishbone (Link Bones to Actions)

The `fishboneBones` field already exists in `SuggestedRemoval` and is rendered in `AIAnalysisModal` as a static display-only grid. The upgrade: each bone becomes a clickable link that jumps to the specific suggestion that addresses it.

**Extended `FishboneBone` interface:**

```typescript
interface FishboneBone {
  category:             'People' | 'Process' | 'Technology' | 'Environment';
  cause:                string;
  // NEW: link to the suggestion that resolves this root cause
  resolvedBy?: {
    type:   'connection' | 'edgeRemoval' | 'newNode' | 'taskUpdate';
    refId:  string;   // sourceId-targetId for connections, edgeId for removals, tempId for new nodes
  };
}
```

**UI behaviour:** When `resolvedBy` is set, the bone renders with a subtle arrow icon and the text "→ See suggested fix". Clicking it scrolls the modal to the relevant suggestion card and highlights it with a brief pulse animation. This creates the Miro-style causal link between *why* (fishbone cause) and *what to do* (the specific suggestion).

**Cascading chain display:** Each suggested connection's expanded cascade panel renders depth-indented entries:

```
Depth 1 (immediate):   → edward→dashboard now redundant   [Remove edge]
  Depth 2 (secondary): → edward node loses all inbound    [Remove node / reassign role]
    Depth 3 (tertiary): → edward's task list has no owner [Redistribute 3 tasks to mary]
```

Required actions (type `orphan`) show a red ⚠ badge. Optional follow-ups (type `redundant-edge`, `bottleneck`) show a yellow 💡 badge. Applying a connection with `cascadeEffects` shows a confirm dialog listing the chain before committing.

---

### 12f — Ordered Multi-Step Plan Tab

All suggestion lists today are flat and independent. Suggestions have ordering constraints: add the bypass edge *before* removing the bottleneck node; redistribute tasks *after* the merge. The AI should return an explicit phased plan, and the UI should enforce the ordering.

**Prompt addition** — new top-level `suggestionPlan` key:

```
"suggestionPlan": {
  "phases": [
    {
      "phaseIndex": 1,
      "label": "Bypass Routing",
      "description": "Add direct connections to reduce load on the bottleneck",
      "suggestionRefs": [
        { "type": "connection", "refId": "mary-dashboard" }
      ]
    },
    {
      "phaseIndex": 2,
      "label": "Clean Up Redundant Paths",
      "description": "Remove edges and nodes made redundant by Phase 1",
      "prerequisitePhases": [1],
      "suggestionRefs": [
        { "type": "edgeRemoval", "refId": "mary-edward" },
        { "type": "removal",     "refId": "edward" }
      ]
    },
    {
      "phaseIndex": 3,
      "label": "Task Redistribution",
      "description": "Move Edward's tasks to remaining team members",
      "prerequisitePhases": [2],
      "suggestionRefs": [
        { "type": "taskUpdate", "refId": "mary" }
      ]
    }
  ]
}
```

**TypeScript type:**

```typescript
interface SuggestionPhase {
  phaseIndex:         number;
  label:              string;
  description:        string;
  prerequisitePhases: number[];
  suggestionRefs:     Array<{ type: 'connection' | 'edgeRemoval' | 'removal' | 'newNode' | 'taskUpdate'; refId: string }>;
}
```

**UI:** `AIAnalysisModal` gains a second tab "📋 Suggested Plan" alongside the existing "🔍 Findings" tab. Each phase renders as a card. If `prerequisitePhases` are not fully applied, the phase card is greyed out with "Complete Phase N first". An "Apply All in Order" button walks through all phases with a confirmation at each step. The entire multi-phase apply is wrapped in a single `pushSnapshot` call so `Cmd+Z` rolls back the entire plan atomically.

---

### Implementation Priority

| Sub-track | Effort | Impact | Target |
|---|---|---|---|
| 12a Fix 1 — `targetName()` bug | 1 min | Unblocks Pass 2 entirely | ✅ 0.47 |
| 12a Fix 5 — Zod schema | 1 hr | Prevents silent parse failures | ✅ 0.47 |
| 12a Fix 2 — `redundant-edge` type | 30 min | Accurate cascade labels | ✅ 0.47 |
| 12b — `suggestedEdgeRemovals` | 3 hr | Closes the biggest analysis gap | ✅ 0.47 |
| 12a Fix 3 — `automate` handler | 2 hr | Makes schema promise real | ✅ 0.47 |
| 12a Fix 4 — `merge` handler | 2 hr | Makes schema promise real | ✅ 0.47 |
| 12c — `suggestedNewNodes` | 4 hr | Enables true automation recommendations | ✅ 0.47 |
| 12d — `suggestedTaskUpdates` | 2 hr | Task-level insights | ✅ 0.47 |
| 12e — Interactive fishbone | 3 hr | Causal traceability | ✅ 0.47 |
| 12f — Ordered plan tab | 4 hr | Safe sequential apply | ✅ 0.47 |
| 12g — `suggestedGroupUpdates` | 3 hr | AI-driven workflow group reorganisation | ✅ 0.48 |

---

### Priority: P1 — ✅ Fully implemented (12a–12f in `0.47-personal`, 12g in `0.48-personal`)

---

## Track 13 — Expanded Test Coverage

### Current State

The test suite introduced in `0.43-personal` covers 23 cases across two files:
- `layout.test.ts` — 7 tests for `hierarchicalLayout` (empty, single, multi-node, bounds, 2-node, chain, determinism)
- `csv.test.ts` — 16 tests for `buildCsvExport` / `parseCsvImport` round-trip, `csvCell`, `parseCsvRow`

The coverage target was `src/lib/` at 80%, but the critical paths that have broken in practice (AI response handling, server state mutations, undo/redo) have zero test coverage. The following gap areas are prioritised by the likelihood of regression.

---

### 13a — Server State Mutation Tests

**Target:** `src/lib/serverState.ts`

These functions are the single most critical path in the app — every PUT action passes through them. They are currently untested.

| Test case | What to verify |
|---|---|
| `addNode` on empty state | Node appears in `customNodes`, position stored in `baselinePositions` |
| `addNode` with duplicate ID | Silently deduplicates or throws a typed error |
| `deleteNode` removes edges | All edges where `source` or `target` === nodeId are also removed |
| `deleteNode` on core node | Returns error; core nodes should be undeletable via this path |
| `resetLayout` with custom nodes | Positions recomputed by hierarchicalLayout, `originalBaselinePositions` updated |
| `resetLayout` with no custom nodes | Restores `originalBaselinePositions`, does not run layout |
| `incrementalLayout` positions new nodes near neighbours | New node x/y within 200px of the centroid of connected nodes |
| `upsertWorkflowGroup` creates and updates | Round-trips name, color, nodeIds correctly |
| `deleteWorkflowGroup` removes from settings | Group absent after delete; nodeIds not leaked |
| `updateMetadata` merges partial overrides | Existing keys preserved, only specified keys updated |
| `importState` replaces all custom data | `customNodes`, `customEdges`, positions, settings all replaced cleanly |

---

### 13b — Undo/Redo Stack Tests

**Target:** `src/hooks/useUndoRedo.ts`

The 50-step history is a critical safety feature. It should be covered end-to-end.

| Test case | What to verify |
|---|---|
| `push` then `undo` returns original | Deep clone fidelity — all nested objects match source |
| `push × 3` then `undo × 2` | Past stack shrinks correctly; returns states in LIFO order |
| `undo` then `redo` restores future | Future stack populated on undo; `redo` returns the undone state |
| `push` after `undo` clears redo | New mutation discards the future stack |
| `push × 51` stays at 50 entries | Circular buffer; oldest entry evicted; no memory leak |
| Deep clone isolation | Mutating returned state does not corrupt the stored snapshot |
| `canUndo` / `canRedo` reactive flags | `canUndo` is false on empty past; `canRedo` is false on empty future |
| `undo` on empty stack | Returns null; no error |
| `redo` on empty stack | Returns null; no error |

---

### 13c — AI Schema Validation Tests

**Target:** `src/lib/aiSchemas.ts`

The Zod schemas are the only defence against malformed AI responses reaching graph state. They need adversarial inputs.

| Test case | What to verify |
|---|---|
| Valid `ParseWorkflowResponse` passes | All required fields present; optional fields defaulted |
| Missing `customNodes` array | Schema fills with `[]` default, not error |
| Node with no `id` field | `.safeParse` returns error with path `customNodes[n].id` |
| Node ID that collides with core ID (`"ed"`) | Schema should flag or strip to prevent silent core-node overwrite |
| Edge `source` referencing non-existent node ID | Schema detects orphan reference (requires cross-field validation) |
| `baselinePositions` with non-numeric coords | Coerced or rejected |
| Deeply nested group with circular `parentGroupId` | Schema or validator detects cycle |
| Response with extra unknown fields | Passthrough or strip — must not crash |
| `AIUpdatePatchResponse` with negative `weight` on edge | Rejected with typed error |
| Malformed JSON repaired by `jsonrepair` then validated | Schema still rejects structural violations after repair |

---

### 13d — GraphAction Route Tests

**Target:** `src/app/api/graph-state/route.ts`

Integration tests using `fetch` mock or `msw` that verify each `GraphAction` variant round-trips correctly.

| Test case | What to verify |
|---|---|
| PUT `addNode` returns updated state | New node in `state.customNodes` |
| PUT `deleteNode` cascades to edges | Associated edges removed from response |
| PUT `resetLayout` returns changed positions | `baselinePositions` keys include all nodes |
| PUT `incrementalLayout` only moves named nodes | Existing node positions unchanged |
| PUT `upsertWorkflowGroup` creates new group | Group ID in `state.settings.workflowGroups` |
| PUT `updateMetadata` merges correctly | Existing metadata keys not wiped |
| PUT with unknown action | Returns 400 with `{ error: "unknown action" }` |
| GET returns full state | All required fields present |
| Concurrent PUTs (sequential in test) | Last-write wins; `lastUpdated` strictly increases |

---

### 13e — Layout Edge Case Tests

**Target:** `src/lib/layout.ts` (extensions to existing `layout.test.ts`)

The current 7 layout tests cover the happy path. These adversarial cases have caused real bugs.

| Test case | What to verify |
|---|---|
| Graph with a cycle (A→B→C→A) | Layout completes without infinite loop; back-edge receives Y offset |
| Disconnected components (no shared edges) | Both components placed with horizontal separation, not overlapping |
| Star topology (1 hub, 20 leaves) | Hub centred; leaf positions are distinct, non-overlapping |
| Very long chain (20 nodes in sequence) | Canvas width expands; no node placed at x < 0 |
| `groupAwareLayout` with overlapping groups | Groups do not occupy the same bounding rectangle |
| `groupAwareLayout` with nested groups | Child group bounding box fits inside parent bounding box |
| Single-node group | Group rendered without crashing; bounding box is non-zero |
| All nodes in one group | Group bounding box covers entire canvas area without overflow |

---

### 13f — CSV Round-trip Edge Cases

**Target:** `src/lib/csvExport.ts` / `src/lib/csvImport.ts` (extensions to existing `csv.test.ts`)

| Test case | What to verify |
|---|---|
| Node label with commas | CSV-escaped correctly; re-imported label matches exactly |
| Node label with double-quotes | Quotes escaped as `""` in CSV; round-trip lossless |
| Node label with newline character | Wrapped in quotes; import reconstructs the multiline label |
| Empty workflow (no custom nodes or edges) | Export produces valid CSV headers with empty sections; import produces empty state |
| Metadata with Unicode (CJK, Arabic) | Characters survive CSV encode/decode without corruption |
| `workflowGroups` with `parentGroupId` | Parent relationship preserved in `[WORKFLOW_GROUPS]` section |
| Import with unknown section header | Silently ignored; known sections parsed correctly |
| Import with duplicate node IDs | Later row overwrites earlier; no crash |

---

### 13g — End-to-End Smoke Tests (Playwright)

A minimal Playwright suite that verifies the full user journey without mocking internals.

| Test | Steps |
|---|---|
| Start screen → default workflow | Open app, click "Start without AI", verify canvas renders 7 nodes |
| Add node via context menu | Right-click canvas, fill form, verify node appears on canvas |
| Delete node clears sidebar | Select node, press Delete, verify sidebar closes |
| Undo add then redo | Add node, Cmd+Z, verify node gone; Cmd+Shift+Z, verify node back |
| Export and re-import CSV | Export, clear graph via importState with empty state, import CSV, verify node count matches |
| Toggle improvements mode | Toggle on, verify edward node dims and mary-cy edge appears; toggle off, verify reverts |
| Reset Layout brings nodes into view | Pan canvas far away, click Reset Layout, verify nodes visible in viewport |

---

### 13h — AI Cascading Analysis Tests

**Target:** `src/lib/aiSchemas.ts` and `src/hooks/useAIHandlers.ts`

These tests assure the multi-step cascading logic introduced in Track 12 resolves safely without corrupting the graph.

| Test case | What to verify |
|---|---|
| Zod Schema validates `cascadeEffects` | `cascadeEffects` array enforces valid target IDs and required `severity` values |
| Dependent apply ordering | Applying a resolution plan correctly fires `isPrerequisite` actions before the primary node removal |
| Transaction batching for Undo | A 5-step cascade resolves to exactly *one* new snapshot in `useUndoRedo`; `Cmd+Z` restores all 5 changes simultaneously |
| Backend cycle rejection | Analysis returning conflicting `prerequisitePhases` (cycles) rejects via validation phase |
| Orphaned edge detection | Attempting a cascading remove on a node without addressing its connected edges emits a warning |

---

### Priority: P2 for 13a–13f and 13h, P1 for 13g (smoke tests catch regressions before merge)

---

## Track 14 — AI Scalability for Large Graphs

### Problem

All three AI routes (`parse-workflow`, `optimize`, `update`) send a full JSON snapshot of the workflow as input and expect a complete structured JSON response as output. For small workflows (8–15 nodes, 10–20 edges) this fits comfortably within any model's context window. As workflows scale to 30–100+ nodes the snapshot crosses the input token threshold; the response grows proportionally and regularly hits `maxTokens`, truncating the JSON mid-object. The `optimize` route already exhibited this in production: the AI returned a truncated response, `JSON.parse` threw, and the entire `analysis` field fell back to the raw broken JSON string displayed verbatim to the user.

**A partial fix has been applied (`0.50-personal`):** `maxTokens` raised from 2 000 → 5 000 on the optimize route and `jsonrepair` added to patch truncated responses. However this is a palliative measure — a workflow with 50+ nodes and rich metadata will overflow 5 000 output tokens regardless, and the input snapshot will eventually overflow the model's context window too.

---

### 14a — Token Budget Estimation Before Dispatch ✅ PARTIAL (`0.50-personal`)

Before sending any AI request, estimate the combined input token count (snapshot + system prompt) and the expected output size. If the estimate exceeds a configurable safe threshold (e.g. 80 % of the model's context window), switch to a compressed snapshot automatically.

**Implementation:**
- Add a `estimateTokens(text: string): number` utility using the `tiktoken` or `gpt-tokenizer` library (both are < 15 KB, browser-compatible)
- In each route's handler, call `estimateTokens(systemPrompt + workflowSnapshot)` before `generateText`
- If `estimated > SAFE_INPUT_THRESHOLD`, invoke the context compression pipeline (Track 14b) before sending

**`maxTokens` audit and fixes already applied:**

| Route | Old `maxTokens` | New `maxTokens` | Fix |
|---|---|---|---|
| `/api/ai/optimize` (Pass 1) | 2 000 | 5 000 | ✅ `0.50-personal` |
| `/api/ai/optimize` (Pass 2) | 1 000 | 1 000 | No change needed |
| `/api/ai/update` | 4 000 | 4 000 | No change needed |
| `/api/ai/parse-workflow` | 8 000 | 8 000 | Already generous |

**`jsonrepair` added to optimize route:** ✅ `0.50-personal` — `JSON.parse(jsonrepair(stripFences(rawText)))` replaces bare `JSON.parse`, recovering responses truncated by a few tokens.

---

### 14b — Context Compression (Smart Snapshot Trimming)

When the full snapshot exceeds the safe input budget, produce a compressed representation that keeps the semantically critical information and drops low-signal noise.

**Compression layers (applied in order until budget is met):**

1. **Strip position data** — `baselinePositions` and `ecosystemPositions` are never used by any AI route; ensure they are not serialised into any snapshot (already done in optimize/update, but verify parse-workflow)
2. **Summarise node metadata** — For nodes that are not referenced by any group or edge in the current analysis scope, replace the full metadata object with a compact `{ id, name, role }` triple. Estimated saving: 60–80 % per trimmed node
3. **Deduplicate edge labels** — Edges where `name` is empty or matches a generic pattern (e.g. `"Data Transfer"`) can be represented as `{ id, source, target }` without the name/summary fields
4. **Group-level summaries** — Replace the per-node `groups: [...]` array (repeated for every node) with a single top-level `groups` block that maps `groupId → memberIds` — this halves the representation of group membership
5. **Task truncation** — If a node has > 5 tasks, send only the first 5 with a note `"+ N more tasks omitted"`. The AI cannot meaningfully reason about 20-task lists anyway
6. **Core node omission** — When all core nodes are hidden (AI-generated workflows using `hiddenCoreNodes`), strip all `EDGE_DATA` and `NODE_DATA` entries from the snapshot entirely — they are structural noise for custom workflows

**API surface:**
```typescript
function compressSnapshot(
  snapshot: WorkflowSnapshot,
  budgetTokens: number,
): { compressed: WorkflowSnapshot; omissions: string[] }
```
The `omissions` array is logged to the AI Debug Log so users can understand what was dropped.

---

### 14b-i — Hierarchical Group Summaries ✅ IMPLEMENTED (`0.51-personal`)

#### Problem

Both snapshot builders (optimize route inline + update route `buildSnapshot`) represent group membership by **name strings** — the display name of every group a node belongs to. This has two compounding costs:

1. **Token waste** — every node entry repeats long group names that are already fully described in the `GROUPS` block. A workflow with 10 nodes each in a "Morning Compliance Review" group spends ~300 tokens just on group name repetition per-node.
2. **Rename fragility** — if a group is renamed, the per-node strings diverge from the group block until the next snapshot rebuild, confusing the AI into treating them as separate groups.

Additionally, the `GROUPS` block itself carried no semantic summary — just a flat member list. The AI had to infer role distribution and constraint density per group by scanning all nodes, wasting reasoning capacity.

#### Proposed Solution: Group ID References + Enriched Group Block

Replace the per-node name arrays with group **ID** references, and enrich the top-level groups block with pre-computed summaries.

**Before (per-node, optimize route):**
```json
{ "id": "mary", "name": "Mary", "role": "Collaborator",
  "groups": ["Morning Compliance Review", "Pre-Approval Team"] }
```

**After:**
```json
{ "id": "mary", "name": "Mary", "role": "Collaborator",
  "groupIds": ["grp_compliance", "grp_preapproval"] }
```

**Before (GROUPS block, update route text snapshot):**
```
  [grp_compliance]  Morning Compliance Review  color:#6366F1  →  Mary, Edward
```

**After:**
```
  [grp_compliance]  Morning Compliance Review  color:#6366F1  →  Mary, Edward
         Nodes: 2 | Roles: 1 person, 1 manager | Constraints: 1
```

**Before (groupSummary, optimize route JSON):**
```json
{ "id": "grp_compliance", "name": "Morning Compliance Review",
  "color": "#6366F1", "nodeIds": ["mary", "ed"],
  "members": ["Mary", "Edward"] }
```

**After:**
```json
{ "id": "grp_compliance", "name": "Morning Compliance Review",
  "color": "#6366F1", "nodeIds": ["mary", "ed"],
  "members": ["Mary", "Edward"],
  "nodeCount": 2,
  "roleSummary": "1 collaborator, 1 manager",
  "constraintCount": 1 }
```

#### Token Savings Estimate

| Workflow size | Groups | Members/group avg | Saving per node | Total saving |
|---|---|---|---|---|
| 10 nodes, 2 groups | 2 | 5 | ~15 tokens (name→ID) | ~150 tokens |
| 30 nodes, 5 groups | 5 | 6 | ~20 tokens | ~600 tokens |
| 80 nodes, 10 groups | 10 | 8 | ~25 tokens | ~2 000 tokens |

At 80 nodes, hierarchical group summaries alone save ~2 000 input tokens — equivalent to 4–5 full node descriptions — reducing the risk of hitting the context window.

#### Implementation

The snapshot logic is extracted from both routes into a shared library:

```
src/lib/snapshotBuilder.ts  (NEW)
  ├── buildOptimizeSnapshot(workflowData) → OptimizeSnapshot
  │     • nodes: groupIds: string[]  (IDs, not names)
  │     • groupSummary: + nodeCount, roleSummary, constraintCount
  └── buildUpdateSnapshot(state: ServerGraphState) → string
        • nodes: Groups: grp_id1, grp_id2  (IDs, not names)
        • GROUPS section: + "Nodes: N | Roles: ... | Constraints: N"
```

Both routes import from this lib, removing ~80 lines of duplicated snapshot-building code.

#### SYSTEM_PROMPT updates

**optimize route:** The `suggestedGroupUpdates` rule block already references `groupId` from the snapshot — no change needed. The AI will see `groupIds` on nodes and use the group `id` field naturally.

**update route:** The `GROUPS` section now shows group IDs as the primary reference (already the case — `[grp_compliance]` bracket format is unchanged). The new `Nodes/Roles/Constraints` summary line is informational only; no prompt rule changes needed.

#### Regression test coverage

New test file `src/__tests__/snapshot.test.ts` verifies both builders:
- Group ID output (not names) on per-node entries
- `roleSummary` accuracy for single/mixed/empty groups
- `constraintCount` counts only nodes with non-empty constraints string
- Hidden nodes excluded from core node list and from group membership
- Improvement-only edges excluded from optimize snapshot
- Tasks formatted correctly in update snapshot
- Empty groups handled without crash
- `nodeCount` matches `nodeIds.length`

---

### 14c — Scoped / Focused Analysis

Instead of always analysing the entire workflow, let users constrain the analysis to a specific workflow group or hand-selected nodes. This keeps the snapshot small by design and produces more actionable, focused suggestions.

**UI entry points:**
- **Group context menu** — Right-click a workflow group region → "AI: Analyse this group". Sends only the nodes in that group + their direct neighbours + the edges between them
- **Multi-select** — After shift-selecting nodes, the toolbar gains an "AI: Analyse selection" button (requires Track 6e multi-select first)
- **Bottleneck focus** — If the current analysis has identified bottleneck nodes, a "Deep-dive: [node name]" button appears that re-runs analysis with a 2-hop subgraph centred on that node

**Route change:** Add an optional `scope?: { nodeIds: string[] }` field to the optimize and update request bodies. When present, the snapshot builder filters nodes/edges to only the scoped set.

**Snapshot size impact:** A 50-node workflow with 6 groups averages ~8 nodes per group. A focused 8-node + 2-hop subgraph analysis uses ~15 % of the tokens of the full graph — comfortably within any model's budget.

---

### 14d — Streaming Responses (Progressive Output)

All three AI routes currently buffer the entire model response, then parse and return it. For large workflows this means:
- **Latency:** User sees nothing for 10–30 seconds, then the full UI updates at once
- **Token truncation:** A buffered response that exceeds `maxTokens` mid-JSON is unrecoverable without `jsonrepair`; streamed partial chunks can be yielded as they arrive and the UI can render them incrementally

**Implementation:**
- Switch `generateText` to `streamText` (Vercel AI SDK or Anthropic SDK streaming)
- Change each route to return `new Response(stream)` with `Content-Type: text/event-stream`
- On the client, use `ReadableStream` to accumulate chunks and progressively populate state:
  - For `optimize`: stream the `analysis` markdown text first (render it as it arrives), then buffer the structured suggestion arrays until the JSON stream closes
  - For `parse-workflow`: stream nodes as each JSON array element is completed — nodes appear on the canvas one by one
  - For `update`: buffer the full patch (it must be applied atomically), but stream a `status` field ("Parsing update...", "Validating changes...", "Finalising...")

**Impact on large graphs:** Streaming turns a 30-second wait into a visually active 30-second experience. Combined with Track 15 (immediate canvas transition), the user is on the canvas watching their workflow being built in real time rather than staring at a spinning button on the start page.

---

### 14e — Chunked Multi-Turn Analysis

For very large workflows (100+ nodes) where even a compressed scoped snapshot might overflow, introduce a multi-turn conversation approach:

**Round 1 — Structure scan:** Send only node IDs + roles (no metadata, no tasks). Ask the AI to identify the top 5 most critical nodes to analyse.

**Round 2 — Deep analysis:** Send the full metadata for only those 5 nodes + their 2-hop neighbourhood. Ask for specific suggestions.

**Round 3 — Plan synthesis:** Send the suggestions from Round 2 plus a summary of the rest of the graph. Ask for the ordered suggestion plan.

This requires storing intermediate results server-side (in-memory per-request is fine) and three sequential API calls instead of one. Total tokens per call stays small regardless of graph size. The Debug Log should show all three call/response pairs.

**Trigger condition:** Activate automatically when `estimateTokens(fullSnapshot) > CHUNKED_THRESHOLD` (e.g. 12 000 tokens). Otherwise use the single-pass flow.

---

### Priority: P1 for 14a/14b (token safety), P2 for 14c/14d (UX quality), P3 for 14e (large enterprise scale)

---

## Track 15 — Start-Page Generation UX: Immediate Canvas Transition

### Problem

When a user submits a workflow description on the start screen, they are left staring at a spinning "Generating workflow with AI…" button on the static start page for the entire duration of the AI call — typically 10–30 seconds. There is no progress feedback beyond the spinning icon, no ability to cancel, and no sense of what stage the generation is at. Users are effectively frozen.

The root cause: `isAppStarted` is only set to `true` inside `importStateAndStart`, which runs **after** both the AI call and the server round-trips complete. The canvas never appears until everything is done.

---

### 15a — Optimistic Canvas Entry (Immediate Transition) ✅ PROPOSED

Transition to the canvas shell the moment the user clicks "Generate with AI" — before any AI response arrives. Show the empty canvas with a full-screen loading overlay that provides progressive stage feedback.

**State changes needed in `page.tsx`:**
```typescript
const [isGeneratingWorkflow, setIsGeneratingWorkflow] = useState(false);
```

**Flow:**
1. User clicks "Generate with AI"
2. `setIsAppStarted(true)` immediately — canvas shell renders
3. `setIsGeneratingWorkflow(true)` — overlay appears over canvas
4. AI call proceeds in background
5. On success: `importStateAndStart(result)` runs → `setIsGeneratingWorkflow(false)` → overlay fades, workflow appears
6. On error: `setIsGeneratingWorkflow(false)` → error toast on canvas (not a full revert to start screen) + "Try again" button

**Overlay design (canvas loading state):**
```
┌──────────────────────────────────────────┐
│  ✦  Building your workflow…              │
│                                          │
│  ● Analysing workflow description        │  ← stage 1 (active, pulsing)
│  ○ Identifying nodes and connections     │  ← stage 2 (pending)
│  ○ Calculating layout                    │  ← stage 3 (pending)
│  ○ Finalising                            │  ← stage 4 (pending)
│                                          │
│  [Cancel]                                │
└──────────────────────────────────────────┘
```

Stage progression is time-based (estimated durations from typical API call timing):
- Stage 1: 0–60 % of elapsed time
- Stage 2: 60–80 %
- Stage 3: 80–95 %
- Stage 4: 95–100 % (server round-trips)

**Cancel behaviour:** Clicking Cancel aborts the in-flight fetch (using `AbortController`) and returns to the start screen. No state is corrupted because `importStateAndStart` has not yet been called.

---

### 15b — Real-Time Progress from Streaming (Future)

Once Track 14d (streaming) is implemented, replace the time-estimated stage progression with actual signal-driven stages:

| Stream event | Stage shown |
|---|---|
| First token received | "Reading your description…" |
| First `customNodes` array element complete | "Identified [N] team members / systems…" |
| All nodes complete | "Mapping [M] connections…" |
| All edges complete | "Calculating layout…" |
| `PUT importState` response | "Finalising…" |
| `PUT resetLayout` response | Done — overlay fades out |

This requires the streaming parse-workflow route to emit structured Server-Sent Events with stage metadata alongside the partial JSON. The client reads these events and updates the overlay in real time.

---

### 15c — Skeleton Canvas During Generation

While the loading overlay is shown, render a faded "skeleton" canvas behind it: placeholder node circles at random (or templated) positions with grey fill and no labels. This gives a strong spatial affordance that a graph is being built, rather than a blank white canvas with an overlay.

The skeleton can use the current template's default positions as placeholder coordinates if the user chose a template as the basis, or generate 8–12 random positions in the canvas bounds otherwise.

---

### Priority: P1 for 15a (direct user pain), P2 for 15b (requires streaming infrastructure), P3 for 15c (polish)

---

## Track 16 — Distributed Agent Architecture & AI Engine Toggle ✅ IMPLEMENTED (`vb0.1` + `vb0.2`)

### Problem

All three AI routes (`parse-workflow`, `optimize`, `update`) send a single monolithic snapshot of the entire workflow and expect one large JSON response. For workflows beyond ~20 nodes this creates two hard limits:
1. **Token ceiling** — the combined input+output token count approaches or exceeds model context windows
2. **Reasoning quality** — a single AI call must reason about every node simultaneously; a human reviewer would instead focus on one part at a time

A secondary gap: there was no way for users to choose between the original single-call approach and a more powerful multi-agent approach, and there was no visible indicator of which engine ran or how many tokens it used.

---

### 16a — Distributed Agent System (vb0.1) ✅

The distributed system decomposes workflow analysis into a network of specialised agents that reason locally and communicate through a structured message broker.

#### Architecture

```
Orchestrator
  ├── NodeAgent × N   (one per workflow node, run in parallel)
  │     Each agent receives only its ego-centric context:
  │       • its own metadata, tasks, constraints
  │       • direct neighbours (1-hop) + their metadata
  │       • the edges it participates in
  │     Produces: actions[], bottleneckScore, proposedEdges[], orphanWarning?
  │
  ├── GroupAgent       (one per workflow group, boundary-aware)
  │     Receives: group member IDs + cross-group edge list
  │     Produces: inter-group negotiation proposals
  │
  ├── MessageBroker    (EventEmitter, in-process)
  │     Enforces: edge validation, cascade depth limit (5), message cap (100)
  │     System messages bypass edge validation
  │
  └── CascadeSimulator (BFS cascade from a CascadeTrigger)
        Trigger types: remove_edge | add_edge | remove_node | bottleneck_resolve
        Each depth level: affected agents reason independently on propagation
```

#### Token budget per run

| Component | Tokens/call | Notes |
|---|---|---|
| NodeAgent (ego-centric context) | ~1,000–1,900 | Only local neighbourhood |
| GroupAgent | ~2,500–5,000 | Boundary + cross-group edges |
| Monolithic analyze (full graph) | ~11,500–16,000 | Entire snapshot |

For a 20-node workflow: distributed ≈ 20 × 1,400 = 28,000 tokens in parallel calls (each small) vs monolithic ≈ 14,000 in one large call. The distributed approach uses more tokens overall but keeps each individual call well within any model's reasoning-quality sweet spot.

#### Files created (vb0.1)

| File | Purpose |
|---|---|
| `src/lib/agents/orchestrator.ts` | Parallel NodeAgent runner with Semaphore concurrency limiter; `runFullOrchestration()`, `runSubsetOrchestration()` |
| `src/lib/agents/messageBroker.ts` | EventEmitter broker with edge validation, depth limit, message cap |
| `src/lib/agents/cascadeSimulator.ts` | BFS cascade simulation from typed `CascadeTrigger` |
| `src/lib/agents/groupAgent.ts` | Group-level governance + `negotiate()` for inter-group proposals |
| `src/lib/agents/nodeAgent.ts` | Per-node autonomous agent with ego-centric context builder |
| `src/lib/agents/contextBuilder.ts` | Builds ego-centric context from `ServerGraphState` |
| `src/lib/spatialIndex.ts` | R-tree spatial index (rbush) for O(log n) viewport queries + LOD system |
| `src/app/api/ai/agent/route.ts` | POST — single/orchestrate/simulate modes |
| `src/app/api/ai/cascade/route.ts` | POST — cascade simulation endpoint |
| `src/app/api/ai/group-agent/route.ts` | POST — single group or all groups |
| `src/app/api/graph-state/viewport/route.ts` | GET — spatial viewport query with LOD + since params |
| `src/__tests__/agents.test.ts` | 32 tests: context builder, message broker, spatial index, LOD |

#### LOD system (spatial index)

| Zoom level | Detail level | Node rendering |
|---|---|---|
| > 0.7 | `full` | All metadata, tasks, labels |
| 0.3–0.7 | `simplified` | Name + role only |
| < 0.3 | `dot` | Circle only |

---

### 16b — Strategy Pattern Engine Toggle (vb0.2) ✅

The distributed system initially only covered analysis. vb0.2 extended it to **all three AI operations** (Analyze, Update, Creation) and added a user-facing control to choose between engines.

#### Architecture

```
AIEngineProvider (React Context, wraps layout.tsx)
  └── mode: 'monolithic' | 'distributed'   (persisted to localStorage)
      generation: number                    (bumped on every mode change)

useAIEngine hook (consumed by useAIHandlers)
  ├── runAnalyze()  →  /api/ai/optimize  with  { engine: mode }
  ├── runUpdate()   →  /api/ai/update    with  { engine: mode }
  └── AbortController per operation type
        → auto-aborts stale in-flight requests when generation changes

/api/ai/optimize (updated)
  ├── engine === 'distributed'  →  runDistributedOptimize()
  └── engine === 'monolithic'   →  original Pass 1 + Pass 2

/api/ai/update (updated)
  ├── engine === 'distributed'  →  runDistributedUpdate()
  └── engine === 'monolithic'   →  original validatePatch flow
```

#### Adapter layer

`src/lib/agents/adapters.ts` converts `OrchestratorResult` → `OptimizeResponse` shape so `AIAnalysisModal` never needs to know which engine ran:

- `proposedEdges` → `suggestedConnections[]`
- `remove_edge` actions → `suggestedEdgeRemovals[]`
- `delegate_task` actions → `suggestedTaskUpdates[]` + `suggestedRemovals[]`
- Markdown analysis synthesised from bottlenecks, orphans, conflicts, per-node summaries

#### Race condition handling

If the user toggles mode while a request is in-flight:
1. `generation` counter increments in `AIEngineContext`
2. `useAIEngine` detects the mismatch via `generationRef`
3. The stale `AbortController` fires; the in-flight fetch is cancelled
4. `useAIHandlers` receives `{ aborted: true }` and silently discards — no error flash to the user

#### How users set the mode

**Toolbar pill** — `AIEngineToggle` (compact) renders between AI Settings ⚙ and the export buttons. Active mode shown with colour: indigo = Monolithic, emerald = Distributed. Preference persists across page reloads.

**AI Settings modal** — Section 4 "AI Engine Mode" has two radio-style cards:
- **Monolithic** — `Stable` badge, "Single AI call — fast, reliable, works for most workflows."
- **Distributed** — `Experimental` badge, "Parallel node agents — deeper analysis, higher token cost."

Selecting a card updates the context immediately. No Save needed — the mode is stored independently of the API key config.

#### Token usage end-to-end

| Layer | Status |
|---|---|
| `generateText()` returns `{ text, usage }` | ✅ All three providers (Anthropic, Gemini, Doubao) |
| `optimize` route includes `tokenUsage` in response | ✅ vb0.2 |
| `update` route includes `tokenUsage` in response | ✅ vb0.2 |
| `AIDebugLog` extended with `engine` + `tokenUsage` | ✅ vb0.2 |
| Debug log panel renders engine pill + token counts | ✅ vb0.2 — shown after every Analyze and Update call |
| Distributed engine token aggregation | ⚠️ Reports primary call only; per-NodeAgent totals logged server-side but not yet surfaced in UI |

#### Files created / modified (vb0.2)

| File | Change |
|---|---|
| `src/contexts/AIEngineContext.tsx` | NEW — Strategy-pattern context: mode, generation, setMode, toggleMode |
| `src/components/AIEngineToggle.tsx` | NEW — Pill toggle: Mono (indigo) / Dist (emerald); `compact` prop for toolbar |
| `src/hooks/useAIEngine.ts` | NEW — Routing hook: injects mode, manages AbortControllers, stale detection |
| `src/lib/agents/adapters.ts` | NEW — `orchestratorResultToOptimizeResponse()` adapter |
| `src/lib/agents/distributedOptimize.ts` | NEW — Full distributed optimize pipeline |
| `src/lib/agents/distributedUpdate.ts` | NEW — Coordinator + per-node distributed update pipeline |
| `src/__tests__/ai-engine-routing.test.ts` | NEW — 26 tests: adapter shape, coordinator, route dispatch, race conditions, abort lifecycle |
| `src/app/api/ai/optimize/route.ts` | Modified — engine branch + `tokenUsage` in response |
| `src/app/api/ai/update/route.ts` | Modified — engine branch + `tokenUsage` in response |
| `src/hooks/useAIHandlers.ts` | Modified — delegates to `useAIEngine`; sets debug log with engine + tokenUsage |
| `src/components/AISettingsModal.tsx` | Modified — Section 4 "AI Engine Mode" with radio cards |
| `src/app/page.tsx` | Modified — `AIEngineToggle` in toolbar; engine/token display in debug log panel |
| `src/app/layout.tsx` | Modified — `AIEngineProvider` wraps children |

### Priority: P1 — Scalability foundation; enables 30–100+ node workflows without context-window overflows

---

## Suggested Release Cadence

| Release | Key deliverables | Status |
|---|---|---|
| **0.40** | Client-side auto-save (localStorage), undo/redo (50-step history), debounced sidebar saves | Planned |
| **0.41** | Named workflow library, SSE-based state sync (replaces polling), streaming AI responses | Planned |
| **0.42** | SQLite persistence, shareable read-only links, workflow version history | Planned |
| **0.43-personal** | Incremental layout (5b), layout web worker scaffold (5c), parallelised sidebar saves (5d), Vitest suite 23 tests (8a), page.tsx refactor into 4 hooks (8b), GraphAction discriminated union (8c), Zod AI response validation (8d) | ✅ Merged |
| **0.44-personal** | AI Analyze real workflow data (hiddenCoreNodes, metadataOverrides, groups, constraints); section cards UI; cached result + Re-analyze + relative timestamp; hover tooltip data correctness; remove hardcoded bottleneck text; core edge hidden-endpoint filtering; generic AI Update examples | ✅ Merged |
| **0.45-personal** | Always-on data flow mode (all edges lit + animated toggle); vivid improvements mode (upgraded edges always glow green at opacity 0.90, deprecated fade to 0.06); analysis action buttons grey out after apply (Add → Added ✓, Automate → Automated ✓, etc.) | ✅ Merged |
| **0.46-personal** | Reset Layout fix — immediate re-fetch + viewport reset via `triggerResetLayout()` imperative ref; AI analysis canvas highlights — amber bottleneck glow on suggested-removal nodes, dashed emerald arcs for suggested connections, applied-state lifted to `useAIHandlers`; undo/redo port from `0.42-personal`; improvements toggle bug fix | ✅ Merged |
| **0.47-personal** | Track 12 — Full-spectrum AI suggestions: `suggestedEdgeRemovals`, `suggestedNewNodes`, `suggestedTaskUpdates`, `suggestionPlan` phases; `automate` handler (creates replacement tool node + re-routes edges); `merge` handler (re-routes edges → target + deletes source); interactive fishbone with scroll-to-fix links; Findings/Plan tab UI; Zod validation on optimize response; `redundant-edge` cascade type; `targetName()` Pass 2 bug fix | ✅ Merged |
| **0.48-personal** | Track 12g — AI-suggested workflow group reorganisation: `suggestedGroupUpdates` (create/update/delete); `handleApplyGroupUpdate` integrated with undo/redo stack; group color swatch + member diff UI in modal; `FishboneBone.resolvedBy` supports `groupUpdate` refs; `groupUpdate` as valid `suggestionPlan` phase ref; group `id`/`color` exposed in AI snapshot so model can reference existing groups | ✅ Merged |
| **0.49-personal** | AI Update feature-parity audit: `buildSnapshot` now includes per-node `constraints` and full `tasks` list (id/title/status/priority/note) so `update.nodeTasks` is informed replacement not blind overwrite; group snapshot now includes `color` so recolor patches use correct current state; `#14B8A6` (teal) added to `ALLOWED_COLORS`, `COLOR_CYCLE`, and SYSTEM_PROMPT palette list | ✅ Merged |
| **0.50-personal** | Visual & UX polish: output node color changed from green → orange (#F97316) to free green exclusively for AI-proposed elements; redundant-edge yellow highlight on canvas (`redundantEdgeIds` prop + amber glow); applied connections now concrete edges (not improvement-only); canvas immediate refresh after AI actions (triggerRefresh + await put); undo/redo clears AI applied-suggestion state; AI analyze token fix (maxTokens 2000→5000, jsonrepair added to optimize route) | ✅ Merged |
| **vb0.1** | Track 16a — Distributed agent system: NodeAgent, GroupAgent, MessageBroker, CascadeSimulator, SpatialIndex, 32 tests | ✅ Merged |
| **vb0.2** | Track 16b — Strategy pattern engine toggle: AIEngineContext, AIEngineToggle, useAIEngine, adapters, distributedOptimize/Update, 26 tests; token usage end-to-end; engine mode in debug log; AI Settings modal section | ✅ Merged |
| **0.51** | Track 14a/14b — token budget estimation + context compression for large graphs; Track 15a — optimistic canvas transition (immediate canvas entry on AI generation) | Planned |
| **0.52** | Multi-select + bulk ops, dark mode, dynamic AI Update examples (6c), jump-to-node search (6d), ecosystem view depth rendering (6g) | Planned |
| **0.52** | Keyboard shortcuts + ARIA labels (Track 9), edge ID robustness (8e) | Planned |
| **0.53** | Track 14d — streaming AI responses; Track 15b — stream-driven progress overlay | Planned |
| **0.54** | API key encryption, server-side session option, full security audit (Track 7) | Planned |

---

## What Not to Build Yet

- **Real-time collaboration (WebSocket presence)** — significant infrastructure cost; SSE sync is a prerequisite
- **OCR / PDF import** — high complexity, narrow use case until the core is stable
- **Webhook ingestion** — requires user accounts + persistent storage first
- **Mobile layout** — the canvas interaction model (drag, zoom, right-click) is inherently desktop-first

---

## Summary

| Track | Priority | Effort | Impact | Status |
|---|---|---|---|---|
| Persistence (localStorage → SQLite) | P0 | Low → Medium | Unblocks daily use | ✅ `0.5-personal` (Tier 1 & 2) |
| Undo / Redo | P0 | Medium | Removes fear of using AI features | ✅ `0.42-personal` |
| SSE state sync | P1 | Low | Better responsiveness, enables multi-tab | ✅ `0.5-personal` |
| AI reliability — streaming, retries, errors (4b/4c/4d/4e) | P1 | Medium | Reduces friction on the core loop | ✅ `0.5-personal` |
| AI Analyze — real data, UI, caching, legacy fixes (4f) | P1 | Low | Correct results, better UX | ✅ merged |
| Rendering performance (5b/5c/5d) | P2 | Medium | Faster layout, no jarring reflows | ✅ merged |
| Data flow mode + vivid improvements + applied buttons | P2 | Low | Clear workflow visibility | ✅ merged |
| Reset Layout fix + AI analysis canvas highlights (11a/11b) | P1 | Low | Core feature loop correctness | ✅ `0.46-personal` |
| UX gaps — history, search, bulk, dark mode, ecosystem view (6a–6g) | P2 | Medium | Daily delight + complete dual-view | Planned |
| Security — key encryption, sanitisation (7a/7b) | P2 | Low | Trust and safety | Planned |
| Tests + refactor (8a–8d) | P3 | High | Long-term maintainability | ✅ `0.43-personal` |
| Accessibility + keyboard nav (Track 9) | P3 | Medium | Inclusivity, power-user speed | ✅ `0.47-personal` |
| Full-spectrum AI Analysis: edge removals, new nodes, task updates, automate/merge, interactive fishbone, plan tab (Track 12a–f) | P1 | High | Deep, context-aware optimizations | ✅ `0.47-personal` |
| AI-suggested workflow group reorganisation: create/update/delete groups via AI Analyze (Track 12g) | P1 | Medium | Structural clarity; phase/dept separation | ✅ `0.48-personal` |
| AI Update feature-parity audit — snapshot completeness (tasks, constraints, group colors), teal color allowlist | P1 | Low | Correct informed patches; no silent data loss | ✅ `0.49-personal` |
| Visual & UX polish — output node orange; redundant edges yellow; concrete applied connections; canvas refresh fix; undo syncs AI state; optimize token fix | P1 | Low | Correct visual feedback; no raw-JSON display bug | ✅ `0.50-personal` |
| AI scalability — token estimation, context compression, scoped analysis (Track 14a–14c) | P1 | Medium | Supports 30–100+ node workflows without truncation | Planned `0.51` |
| Immediate canvas transition on AI generation — optimistic entry + stage overlay (Track 15a) | P1 | Low | Eliminates 10–30 s frozen start-page wait | Planned `0.51` |
| Streaming AI responses — progressive canvas population, stream-driven progress (Track 14d, 15b) | P2 | High | Real-time feedback; eliminates latency cliff | Planned `0.53` |
| Chunked multi-turn analysis for 100+ node graphs (Track 14e) | P3 | High | Enterprise-scale workflows | Planned |
| Edge ID robustness + AI response validation (8e, 7c) | P3 | Low | Data integrity | Planned |
| Distributed agent system — NodeAgent, GroupAgent, MessageBroker, CascadeSimulator, SpatialIndex (Track 16a) | P1 | High | Per-node ego-centric reasoning; stays within context window at any scale | ✅ `vb0.1` |
| Strategy pattern engine toggle — AIEngineContext, AIEngineToggle, useAIEngine, adapters, token usage display (Track 16b) | P1 | Medium | User-controlled engine selection; race-condition-safe; token visibility in debug log | ✅ `vb0.2` |

The biggest single improvement with the least effort is **Track 1 Tier 1** — client-side auto-save. It costs one `localStorage.setItem` call per mutation and eliminates the most common user frustration (refresh = lost work) in an afternoon.
