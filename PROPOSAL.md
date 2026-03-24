# Workable — Product Improvement Proposal

**Date:** March 2026
**Branch baseline:** `main` (post 0.39 merge)
**Scope:** Full codebase review — architecture, UX, performance, security

---

## Executive Summary

Workable is a well-conceived tool with a flexible graph model, a sophisticated multi-pass layout engine, and a genuinely useful AI parsing pipeline. The 0.38–0.39 cycle delivered the core canvas, dual-view rendering, rich metadata sidebar, AI Analyze, and AI Update. The foundation is solid.

However, the product currently has a critical structural gap: **everything is ephemeral**. A browser refresh wipes all work. Beyond that, a cluster of issues across state management, error handling, security, and UX are large enough to block serious daily use. This proposal organises those gaps into prioritised tracks, provides a rationale for each, and suggests a concrete implementation path.

---

## Track 1 — Persistence (Critical)

### Problem
All workflow state lives in a Node.js in-memory singleton (`global.__graphState`). A server restart, Vercel cold start, or accidental page refresh destroys the entire graph. There is no auto-save, no manual save, and no cloud sync.

### Proposed Solution: Tiered Persistence

**Tier 1 — Client-side auto-save (immediate, zero infrastructure)**
Serialise the full server state to `localStorage` on every PUT call (debounced 1 s). On page load, if the server state is empty, re-hydrate from the local copy automatically. This costs ~5 KB per typical workflow and works entirely offline.

**Tier 2 — Named workflow library (short-term)**
Let users save the current graph under a name (stored in `localStorage` as a keyed list). A "My Workflows" drawer on the Start Screen lets them switch between saved workflows. No backend changes needed.

**Tier 3 — Server-side database (medium-term)**
Swap the in-memory singleton for SQLite (via Drizzle ORM or Prisma). The `importState` / `getGraphState` interface is already clean — the swap is mostly mechanical. This enables multi-tab sync, server restarts without data loss, and opens the door to user accounts.

### Priority: P0 — blocks real daily use

---

## Track 2 — Undo / Redo (Critical)

### Problem
Every destructive action — deleting a node, applying an AI Update, removing a group — is irreversible. A misfire on "Apply to Graph" after an AI Update has no recovery path.

### Proposed Solution: Command History Stack

Introduce an `UndoManager` that captures a snapshot of `GraphState` before every mutation. Store up to 50 snapshots in a circular buffer (in-memory on the client). `Ctrl/Cmd+Z` calls `PUT /api/graph-state` with `action: importState` and the previous snapshot; `Ctrl/Cmd+Shift+Z` re-applies.

The state shape is already serialisable — the snapshot cost is a `JSON.parse(JSON.stringify(state))` deep clone before each mutating PUT. Because the server is the source of truth, the undo stack lives on the client and replays the full state on each undo.

For AI Update specifically, the "Back" button in the diff preview is already half-way there — it just needs to be wired to the undo stack instead of only resetting the modal.

### Priority: P0 — user trust issue

---

## Track 3 — Real-time State Sync (High)

### Problem
The client polls `GET /api/graph-state?since=<ts>` every 3 seconds. On an idle graph this wastes bandwidth and prevents multi-tab or future multi-user sync from feeling live.

### Proposed Solution: Server-Sent Events (SSE)

Replace the polling loop with a `GET /api/graph-state/stream` SSE endpoint. The server pushes a lightweight diff (positions hash + lastUpdated) whenever state changes. The client re-fetches the full state only on a hash mismatch — matching the current hash-based deduplication logic, but event-driven instead of polling.

SSE is simpler than WebSockets (no handshake, works over HTTP/2, stateless on server), and Next.js supports it natively with `Response` streaming. The existing 3-second poll can remain as a fallback.

### Priority: P1 — required before multi-user or persistence features feel responsive

---

## Track 4 — AI Quality & Reliability (High)

### 4a — Streaming Responses

Currently all three AI routes buffer the full response before returning. For a large workflow parse (8 000 token budget) this can take 8–12 seconds with zero visual feedback. Add streaming with `ReadableStream` — the client displays a partial node count ("Parsed 4 nodes so far…") while the stream arrives.

### 4b — Retry + Exponential Backoff

A single failed network call surfaces immediately as an error. Add up to 3 retries with 1 s / 2 s / 4 s backoff in `aiClient.ts`. Doubao and Gemini both return transient 503s on rate spikes; retries turn these invisible to the user.

### 4c — Smarter Error Messages

The current catch block returns raw error message strings to the UI. Instead, maintain a server-side error classification map:

| Pattern | User-facing message |
|---|---|
| Auth / 401 | "Invalid API key — check AI Settings" |
| 429 / rate limit | "Rate limit hit — try again in a moment" |
| 503 / timeout | "Provider is slow — retrying…" |
| JSON parse fail | "AI returned unexpected output — try rephrasing" |

### 4d — Cycle Detection on Parse

The AI can return cyclic graphs (node A → B → A). `hierarchicalLayout` handles this with back-edge detection, but downstream consumers (edge rendering, analysis) do not. Add a lightweight DFS cycle check in `parse-workflow/route.ts` before calling layout, and either break the cycle automatically or flag it in the API response.

### 4e — Token Usage Tracking

Surface input/output token counts and estimated cost per request in the AI Debug Log. Doubao and Gemini both return usage objects; Anthropic always has. This lets users understand why large workflows are slow or expensive.

### 4f — AI Analyze: Real Data + Presentation + Cached Results + Legacy Fixes ✅ IMPLEMENTED (`0.44-personal`)

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

## Track 12 — AI Analysis: Cascading Impact & Fishbone Reasoning

### The Core Gap

The current AI Analyze loop treats every suggestion as an isolated, independent action:
- "Add a direct connection from **Mary** to **Dashboard**" — no mention of what that does to the **Edward** bottleneck or the **mary-ed** / **ed-cy** edges.
- "Remove **Edward** (bottleneck)" — no guidance on what replaces his function, where his incoming connections should now point, or what new automation should close the gap.

This is a shallow analysis. Real workflow optimisation is a chain of causes and effects. A single change ripples — adding a bypass edge makes a bottleneck redundant, removing a node orphans its dependencies, merging two steps changes who owns what. Treating each suggestion independently forces the user to figure out the cascade themselves, which is exactly the cognitive load the AI feature is meant to remove.

The user insight that prompted this track: *"when new connections are added, we didn't consider what connections could be updated or removed as a result of that — same applies to bottleneck nodes. Sometimes we can't or shouldn't remove all connections. When we remove something, what should be added? Cascading thinking — like Miro's fishbone."*

---

### 12a — Fishbone Root Cause Decomposition

**What it is:** When the AI identifies a bottleneck node, it should structure its reasoning as an Ishikawa (fishbone) diagram — the same mental model Miro uses in its diagramming templates. The bottleneck is the "fish head" (the effect). The incoming connections are the "bones" (the contributing causes). Each bone can have sub-bones (root causes one level deeper).

**Why it matters:** Today the AI says "Edward is a bottleneck". The fishbone structure would say:
- **Head:** Edward holds up report publishing (avg 2+ day queue)
- **Bone 1 — Handoff dependency:** Mary always escalates to Edward; she has no publish authority
  - Sub-bone: No direct-to-dashboard role assigned to Mary
  - Sub-bone: Approval policy requires senior sign-off even for routine NAV reports
- **Bone 2 — Volume mismatch:** Edward receives 100% of publish requests but works at 60% bandwidth
  - Sub-bone: No parallel review path; single-threaded by design
- **Bone 3 — No automation gate:** The ed→cy edge requires manual action; no rules-based trigger exists

**Proposed AI schema extension:**

```typescript
interface FishboneNode {
  nodeId:      string;            // the bottleneck
  effectLabel: string;            // "holds up X by avg Y"
  bones: Array<{
    causeLabel:   string;         // "Handoff dependency"
    connectionId: string | null;  // edge causing this bone, if identifiable
    subBones:     string[];       // root causes
    proposedFix:  string;         // what to change to address this bone
  }>;
}
```

**UI proposal:** In the AI Analysis modal, each bottleneck section shows a collapsible fishbone card. Clicking a bone highlights the corresponding edge on the canvas (amber pulse). The "Fix this bone" button triggers the specific cascading action for that branch.

---

### 12b — Cascading Connection Analysis

**What it is:** Every suggested connection addition or removal should come with a `cascadeEffects` array — the secondary changes that become necessary or advisable as a result.

**The problem today:** Adding the **mary→dashboard** bypass edge makes the **mary→edward→dashboard** path partially redundant, yet the AI Analysis lists them independently. The user adds the bypass, but the old path remains — creating two parallel routes where one should be deprecated, the old bottleneck node becomes stranded (still receives flow but its output is no longer the only path), and the graph becomes misleading rather than improved.

**Proposed AI schema extension:**

```typescript
interface SuggestedConnection {
  sourceId:       string;
  targetId:       string;
  reason:         string;
  cascadeEffects: Array<{
    type:         'deprecate-edge' | 'reduce-edge-weight' | 'reassign-node-role'
                | 'suggest-remove-node' | 'update-group';
    targetId:     string;           // which edge or node is affected
    reason:       string;           // why this secondary change follows
    severity:     'required' | 'recommended' | 'optional';
  }>;
}
```

**UI proposal:** In the suggestion row, a "▶ 2 follow-on changes" expandable section lists the cascade. Applying the primary suggestion auto-prompts: *"This addition makes the mary→edward edge redundant. Mark it as deprecated?"* with Yes/Skip buttons. Required cascade effects are shown with a warning badge.

**Example cascade chain:**
1. ✅ **Add** mary → dashboard (direct publish bypass)
2. ↳ ⚠️ **Recommend deprecating** mary → edward (now redundant for routine reports)
3. ↳ ⚠️ **Recommend deprecating** edward → dashboard (now redundant, edward no longer on critical path)
4. ↳ 💡 **Suggest** edward's role changes from "Final approver" to "Exception reviewer"
5. ↳ 💡 **Suggest** adding automation rule node between mary and dashboard

---

### 12c — Bottleneck Resolution Planner

**What it is:** Removing a bottleneck without a replacement plan simply breaks the workflow. The AI should generate a **resolution plan** — a structured sequence of: what stays, what changes role, what new node/automation fills the gap, and in what order to apply changes so the graph is never left in an invalid intermediate state.

**The problem today:** The "Remove" button on a bottleneck node in the Analysis modal removes the node and its edges, leaving the graph with orphaned endpoints and no guidance on what fills the function.

**Proposed AI schema extension:**

```typescript
interface SuggestedRemoval {
  id:               string;
  type:             'node' | 'edge';
  reason:           string;
  resolutionPlan:   {
    description:    string;         // prose summary
    orderedSteps:   Array<{
      stepIndex:    number;
      action:       'add-node' | 'add-edge' | 'reassign-role' | 'remove-edge'
                  | 'add-automation' | 'update-metadata';
      targetId:     string;
      detail:       string;         // what exactly to do
      isPrerequisite: boolean;      // must happen before the removal
      isFollowUp:   boolean;        // must happen after the removal
    }>;
    cannotRemoveIf: string[];       // conditions under which removal is inadvisable
    alternativeToFullRemoval?: string; // "if full removal is not possible, consider…"
  };
}
```

**Example resolution plan for removing Edward:**

> **Cannot remove if:** Any report requires regulatory sign-off (check compliance policy).
> **Alternative if not removable:** Change Edward's role to Exception Reviewer — only escalate non-routine NAV discrepancies.
>
> **Pre-requisite steps (before removal):**
> 1. Add automation node "Auto-Publish Gate" (rule-based, triggers on Mary approval + no-discrepancy flag)
> 2. Add edge mary → Auto-Publish Gate
> 3. Add edge Auto-Publish Gate → Dashboard
>
> **Post-removal steps:**
> 4. Remove edge mary → edward (now orphaned)
> 5. Remove edge edward → dashboard (now orphaned)
> 6. Update Dashboard metadata: note new publish path

**UI proposal:** The removal suggestion row expands to show the resolution plan as a numbered checklist with checkboxes. Each step has its own "Apply" button. Steps marked `isPrerequisite: true` must be checked before the "Remove node" button activates. Steps marked `isFollowUp: true` appear after removal, surfaced as "Recommended clean-up actions."

---

### 12d — Suggestion Dependency Graph & Ordered Apply

**What it is:** Suggestions are not always independent. Adding connection A before removing node B matters. The AI should return an explicit **dependency graph** on its suggestions so the UI can enforce an order and prevent the user from applying suggestions in an invalid sequence.

**Proposed schema:**

```typescript
interface AnalysisResult {
  analysis:             string;
  suggestedConnections: SuggestedConnection[];
  suggestedRemovals:    SuggestedRemoval[];
  suggestionPlan: {
    phases: Array<{
      phaseIndex:   number;
      label:        string;    // "Phase 1 — Bypass routing"
      description:  string;
      suggestionIds: string[]; // IDs referencing connections/removals in this phase
      prerequisitePhases: number[];
    }>;
  };
}
```

**UI proposal:** The Analysis modal gains a "Step-by-step plan" tab alongside the current "Findings" tab. Each phase renders as a card with all its actions listed. Phases are gated: Phase 2's "Apply" buttons are disabled until all Phase 1 actions are applied. A "Apply all in order" master button walks through all phases sequentially with confirmations.

---

### 12e — Impact Preview Before Apply

**What it is:** Before the user clicks "Add" or "Remove" on any suggestion, a hover/click preview shows exactly what the graph will look like — not just the direct change, but also all `cascadeEffects` that would be triggered in the same apply.

**UI proposal:**
- Hovering the "Add" button for a suggested connection draws the new edge on the canvas as a solid (not dashed) emerald arc + dims all cascade-affected edges simultaneously.
- The tooltip reads: *"Adds 1 edge · marks 2 edges deprecated · updates 1 node role"*
- Clicking "Apply cascade" applies everything in the correct order as a single undo-able snapshot.

---

### Implementation Approach: Two-Pass AI Prompting

Generating cascading analysis in a single prompt is fragile — the AI tends to surface only the most obvious cascade steps if asked to do everything at once. A two-pass approach is more reliable:

**Pass 1 — Structural analysis (current prompt, extended)**
Send the workflow graph and ask for:
1. Bottlenecks and their fishbone causes
2. Suggested additions/removals without cascade detail yet
3. A rough phasing order

**Pass 2 — Cascade expansion**
For each suggestion from Pass 1, send a focused prompt:
> *"Given this workflow graph, we are about to add an edge from {source} to {target}. List all edges, nodes, and metadata that should be updated, deprecated, or added as a direct result of this change. Be specific about which changes are required vs optional."*

This keeps each cascade prompt small and focused, reduces hallucination risk, and allows progressive disclosure in the UI — users can expand each suggestion to trigger its cascade analysis on demand (lazy-loaded).

---

### Priority: P1 — this is the feature gap that makes AI Analyze feel shallow rather than genuinely insightful

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

### Priority: P2 for 13a–13f, P1 for 13g (smoke tests catch regressions before merge)

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
| **0.46-personal** | Reset Layout fix — immediate re-fetch + viewport reset via `triggerResetLayout()` imperative ref; AI analysis canvas highlights — amber bottleneck glow on suggested-removal nodes, dashed emerald arcs for suggested connections, applied-state lifted to `useAIHandlers` | In Progress |
| **0.47** | Multi-select + bulk ops, dark mode, dynamic AI Update examples (6c), jump-to-node search (6d), ecosystem view depth rendering (6g) | Planned |
| **0.48** | Keyboard shortcuts + ARIA labels (Track 9), edge ID robustness (8e), cycle detection on parse (4d) | Planned |
| **0.50** | API key encryption, server-side session option, full security audit | Planned |

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
| Persistence (localStorage → SQLite) | P0 | Low → Medium | Unblocks daily use | Planned |
| Undo / Redo | P0 | Medium | Removes fear of using AI features | Planned |
| SSE state sync | P1 | Low | Better responsiveness, enables multi-tab | Planned |
| AI reliability — streaming, retries, errors | P1 | Medium | Reduces friction on the core loop | Planned |
| AI Analyze — real data, UI, caching, legacy fixes (4f) | P1 | Low | Correct results, better UX | ✅ merged |
| Rendering performance (5b/5c/5d) | P2 | Medium | Faster layout, no jarring reflows | ✅ merged |
| Data flow mode + vivid improvements + applied buttons | P2 | Low | Clear workflow visibility | ✅ merged |
| Reset Layout fix + AI analysis canvas highlights (11a/11b) | P1 | Low | Core feature loop correctness | ✅ `0.46-personal` |
| UX gaps — history, search, bulk, dark mode, ecosystem view (6a–6g) | P2 | Medium | Daily delight + complete dual-view | Planned |
| Security — key encryption, sanitisation (7a/7b) | P2 | Low | Trust and safety | Planned |
| Tests + refactor (8a–8d) | P3 | High | Long-term maintainability | ✅ `0.43-personal` |
| Accessibility + keyboard nav (Track 9) | P3 | Medium | Inclusivity, power-user speed | Planned |
| Edge ID robustness + AI response validation (8e, 7c) | P3 | Low | Data integrity | Planned |

The biggest single improvement with the least effort is **Track 1 Tier 1** — client-side auto-save. It costs one `localStorage.setItem` call per mutation and eliminates the most common user frustration (refresh = lost work) in an afternoon.
