# Workable — Developer Guide

<p align="center">
  <em>Personal Workflow Mapper · Next.js 16 · React 19 · TypeScript 5 · Multi-provider AI</em>
</p>

> **Current branch:** `vb0.2`

> This guide covers the current production architecture. The original prototype (`prototype.html`) is kept for historical reference only — all active development happens in `src/`.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Getting Started](#getting-started)
3. [Project Structure](#project-structure)
4. [Core Systems](#core-systems)
   - [State Management](#state-management)
   - [AI Pipeline](#ai-pipeline)
   - [AI Update Pipeline](#ai-update-pipeline)
   - [Layout Engine](#layout-engine)
   - [Analysis Sidebar](#analysis-sidebar)
5. [Distributed Agent System (vb0.1)](#distributed-agent-system-vb01)
   - [Token Budget](#token-budget)
   - [Node-as-an-Agent (Phase 2)](#node-as-an-agent-phase-2)
   - [Message Passing & Cascades (Phase 3)](#message-passing--cascades-phase-3)
   - [Group-Level Governance (Phase 4)](#group-level-governance-phase-4)
   - [Infinite Canvas & Viewport (Phase 5)](#infinite-canvas--viewport-phase-5)
6. [Feature Status](#feature-status)
7. [Branch & Version History](#branch--version-history)
8. [Development Patterns](#development-patterns)
9. [Roadmap](#roadmap)

---

## Architecture Overview

```
Browser
  └─ page.tsx ─────────────────────── Start Screen OR Canvas
       │                                       │
       ├─ StartScreen.tsx ─── POST /api/ai/parse-workflow
       │                               │
       │                        generateText()  (Anthropic / Gemini / Doubao)
       │                        extractJSON()   (brace-depth scanner)
       │                        jsonrepair()    (malformed model output)
       │                        hierarchicalLayout()
       │                        groupAwareLayout()
       │                        importState()   ──▶ in-memory singleton
       │
       ├─ GraphCanvas.tsx ──── GET  /api/graph-state/stream (SSE sync)
       │                       PUT  /api/graph-state  (node drag, CRUD)
       │
       ├─ AnalysisSidebar.tsx ─ reads AnalysisData built in page.tsx
       │                         PUT /api/graph-state (updateMetadata / updateEdgeParams)
       │
       ├─ AIAnalysisModal.tsx ─ POST /api/ai/optimize (Monolithic)
       │                          OR   /api/ai/agent (Distributed)
       │
       ├─ AIEngineToggle.tsx ── context: AIEngineContext (Strategy Pattern)
       │
       └─ AISettingsModal.tsx ── localStorage: nwt_ai_config
                                  (provider, model, API key, baseUrl)
                                  endpoint ID preserved across sessions (no purge)
```

No database — server state is a module-level singleton (`src/lib/serverState.ts`). It resets on server restart. Swap the singleton with a real DB via the `importState` / `getGraphState` interface to add persistence.

---

## Getting Started

```bash
git clone https://github.com/your-username/workable.git
cd workable
npm install
npm run dev        # → http://localhost:3000
```

No `.env` file required. AI API keys are entered at runtime in the UI and stored in browser `localStorage` only.

**Useful scripts:**

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx                  # Root layout — metadata, fonts, favicon
│   ├── page.tsx                    # App entry: start screen ↔ canvas routing,
│   │                               #   AnalysisData assembly, AI handlers
│   ├── globals.css
│   └── api/
│       ├── ai/
│       │   ├── parse-workflow/     # POST: plain text → full graph JSON
│       │   │   └── route.ts
│       │   ├── optimize/           # POST: current graph → bottleneck report
│       │   │   └── route.ts
│       │   └── update/             # POST: prompt + snapshot → validated patch
│       │       └── route.ts
│       ├── graph-state/            # GET / PUT: server state CRUD
│       │   └── route.ts
│       └── workflow/               # GET: static workflow data (legacy)
│           └── route.ts
│
├── components/
│   ├── GraphCanvas.tsx             # SVG canvas — nodes, edges, pulses,
│   │                               #   drag, right-click CRUD, group regions
│   ├── AnalysisSidebar.tsx         # Right slide-out panel — node & edge detail
│   ├── StartScreen.tsx             # Landing page — template gallery,
│   │                               #   AI textarea (8k char cap), CSV import
│   ├── AIAnalysisModal.tsx         # Bottleneck report + suggested changes modal
│   ├── AIUpdateModal.tsx           # Two-panel: prompt input → diff preview + apply
│   └── AISettingsModal.tsx         # Provider / model / API key / baseUrl
│
└── lib/
    ├── aiClient.ts                 # Provider-agnostic generateText()
    │                               #   Anthropic · Google Gemini · ByteDance Doubao
    ├── layout.ts                   # hierarchicalLayout + groupAwareLayout
    ├── serverState.ts              # In-memory singleton + all mutation helpers
    ├── templates.ts                # Pre-built workflow templates with full metadata
    └── constants.ts                # Core node IDs, role colours, PROVIDERS list

public/
└── workable-icon.svg               # Brand icon — used as favicon + StartScreen logo
```

---

## Core Systems

### State Management

Server state lives in a single module-level object (`global.__graphState`) in `serverState.ts`. All API routes import helpers from this file:

| Helper | Purpose |
|---|---|
| `getGraphState()` | Returns full state snapshot |
| `importState({ customNodes, customEdges, … })` | Bulk-load a new workflow (used after AI parse) |
| `addCustomNode / removeCustomNode` | CRUD for nodes |
| `addCustomEdge / removeCustomEdge` | CRUD for edges; auto-updates `metadataOverrides[sourceId].connections` |
| `updateMetadata(id, patch)` | Patch any entity's metadata override |
| `updateEdgeParams(edgeId, …)` | Update sequence / weight / isImprovementOnly |

**`metadataOverrides`** is a flat `Record<string, PartialEntityMeta>` keyed by both node IDs and edge IDs. Fields: `name`, `role`, `status`, `summary`, `constraints`, `processes` (workflow group memberships), `connections` (neighbour names), `tasks`.

The client opens an **SSE stream** via `/api/graph-state/stream` for instant updates. If the stream fails, it falls back to polling `/api/graph-state?since=<ts>` every 3 seconds.

---

### AI Pipeline

**Entry point:** `POST /api/ai/parse-workflow`

```
1. Receive { provider, model, apiKey, baseUrl?, prompt }
2. Build structured prompt (schema + examples + user description)
3. generateText() — provider switch:
     anthropic  → @anthropic-ai/sdk  (Messages API)
     google     → @google/generative-ai
     doubao     → fetch() to baseUrl (OpenAI-compatible REST)
4. extractJSON(rawText)
     → strip markdown fences
     → find first '{', track brace depth to matching '}'
     → extract just the JSON object regardless of surrounding prose
5. jsonrepair(extracted)
     → fixes missing quotes, trailing commas, single quotes
     → handles malformed output from any model
6. JSON.parse → validated graph object
7. Build CustomNodeConfig[] + CustomEdgeConfig[] (with name field)
8. Build metadataOverrides:
     - per node: name, role, summary, constraints, tasks
     - per node: connections derived from edges (neighbour display names)
     - per node: processes derived from workflowGroups membership
     - per edge: name, summary (for sidebar)
9. hierarchicalLayout() → baseline process map positions
10. groupAwareLayout() → ecosystem hub positions with group physics
11. importState() → write to singleton
12. Return { success, promptUsed, rawAIResponse } for debug log
```

**Token budget:** `maxTokens: 8000` (raised from 3000 to handle 30-node workflows).

**Post-import layout pass (added 0.38):**

After `importState()` is called, `importStateAndStart` in `page.tsx` immediately fires a second
`PUT /api/graph-state { action: "resetLayout" }` before setting `isAppStarted = true`.
This ensures the very first generation of a workflow uses identical layout rules to the
Reset Layout button — group zone assignment, AABB collision resolution, and canvas clamping
all apply on first render, not only after the user manually resets.

---

### AI Update Pipeline

**Entry point:** `POST /api/ai/update`

```
1. Receive { prompt, currentState, provider, model, apiKey, baseUrl? }
2. buildSnapshot(currentState) — serialize graph as semantic text:
     - Nodes: [id]  Name  (role)  summary  Connections: …  Groups: …
     - Edges: [id]  Source → Target  "edge name"
     - Groups: [id]  Group Name  →  member1, member2
     No coordinates — only semantic fields the AI needs to reason about
3. generateText() with snapshot injected into the user message
4. extractJSON() + jsonrepair() (same pipeline as parse-workflow)
5. validatePatch():
     - add.nodes:   enforce upd_ prefix, discard ID collisions
     - add.edges:   check both endpoints exist in snapshot OR add.nodes
     - add.groups:  enforce upd_grp_ prefix, validate colors against palette
     - update.nodes: discard IDs not in snapshot
     - update.groupExtensions: discard unknown group IDs
     - remove.nodeIds: discard unknown IDs and protected CORE_NODE_IDS
     - remove.edgeIds: cascade — auto-add edges of removed nodes even if not listed
6. Return validated AIUpdateResult patch
```

**Apply flow (client-side, `handleApplyUpdate` in page.tsx):**

Sequential `PUT /api/graph-state` calls in this order:
1. `deleteEdge` for each `remove.edgeIds` (before nodes to avoid dangling refs)
2. `deleteNode` for each `remove.nodeIds`
3. `addNode` + `updateMetadata` for each `add.nodes` (position is `{0,0}` — layout fixes it)
4. `addEdge` for each `add.edges`
5. `upsertWorkflowGroup` for each `add.groups`
6. `updateMetadata` for each `update.nodes` (only patches changed fields)
7. `upsertWorkflowGroup` for each `update.groupExtensions` (merge nodeIds client-side)
8. `resetLayout` — reflows all nodes including new additions

**Semantic snapshot vs. raw CSV:**
The snapshot strips all coordinate and visual data. The AI only sees IDs, display names, roles, summaries, connections, and group memberships — the minimal set needed to reason about workflow structure. This reduces token usage and improves accuracy compared to feeding the full CSV or raw `ServerGraphState` JSON.

**AIUpdateModal — two-panel flow:**
- **Panel A** (prompt input): textarea + example prompts; submits via `onSubmit(prompt)`
- **Panel B** (diff preview): green "Adding" / amber "Updating" / red "Removing" sections; `← Back` returns to A with prompt preserved; "Apply to Graph" fires `onApply(result)`
- Panel switch is driven by `result` prop changing from `null` to non-null (via `useEffect`)

**Provider notes:**
- **Anthropic:** Native SDK, best JSON fidelity
- **Gemini:** Native SDK, fast, free-tier friendly
- **Doubao:** OpenAI-compatible; `baseUrl` is overridable in settings to switch between standard billing (`/api/v3`) and Coding Plan (`/api/coding/v3`) without code changes. The endpoint ID (e.g. `doubao-seed-2.0-lite`) is **always preserved** in `localStorage` — the stale-value purge that previously cleared any non-`ep-` prefixed value has been removed (0.38)

**Adding a new provider:**
1. Add ID to `AIProvider` union in `aiClient.ts`
2. Add `generateText` branch (call provider SDK, return `{ text: string }`)
3. Add config entry to `PROVIDERS` in `AISettingsModal.tsx` (name, colour, defaultModel, models list)

---

### Layout Engine

`src/lib/layout.ts` contains two layout algorithms:

#### `hierarchicalLayout(nodes, edges)`
Sugiyama-style topological sort → assign columns → centre within column. Produces left-to-right flow for the baseline process map view.

#### `groupAwareLayout(nodes, edges, groups, canvasW, canvasH)`
Multi-force physics solver — no velocity, pure position assignment. Runs in a temperature-cooled loop:

**Top-level group detection (updated 0.38):**
A group is treated as top-level when either:
- `parentGroupId` is `null` / `undefined`, **or**
- `parentGroupId` references a group ID that does not exist in the groups list (orphaned subgroup — e.g. a CSV export that referenced a parent that was never defined such as `grp_daily_reconciliation`).

Previously such orphaned subgroups were silently excluded from the physics solver, causing their nodes to be stranded outside all group zones after a Reset Layout.

**Forces (per iteration):**

| # | Force | Description |
|---|---|---|
| 1 | **Hub gravity** | All groups attracted toward the most-connected node (highest degree). Strength scaled by temperature. |
| 2 | **Shared-node tension** | Groups sharing ≥1 node are pulled toward each other. |
| 3 | **Centroid repulsion** | Sharing groups whose centroids are closer than `GC_SZ*2 + SEP_GAP` (~128 px) are pushed apart — prevents pile-up when all groups share the same hub node. |
| 4 | **AABB collision** | Non-sharing groups whose bounding boxes overlap are pushed apart. Uses **accumulated node-level deltas** (not rigid body) — collect all pair contributions, apply once per pass — prevents oscillation for same-shape groups. |

**Post-processing passes:**

| Pass | Iterations | Description |
|---|---|---|
| Strict separation | 60 | Resolves residual group overlaps at node level. Facing-half strategy: sort group nodes by proximity to opponent bbox, push only `ceil(n/2)` of them — breaks symmetry for identical-shape groups. |
| Union-bbox eviction | 40 | Non-member nodes trapped inside foreign group bboxes: compute union of all containing bboxes, find shortest canvas-valid exit direction, move once. Prevents oscillation from competing per-group pushes. |

---

### Analysis Sidebar

`AnalysisSidebar.tsx` renders the right slide-out panel. Data flows:

```
page.tsx useEffect (on selectedId change)
  ├── lookup workflowCache[selectedId]   (static workflow data if any)
  ├── merge fullServerState.settings.metadataOverrides[selectedId]
  ├── if edge: resolve edgeSourceLabel / edgeTargetLabel
  │     from customNodes[source/target].label
  │     or metadataOverrides[source/target].name
  └── setAnalysisData({ ...all merged fields, type: "node"|"edge" })
        ↓
  AnalysisSidebar receives:
    data: AnalysisData
    metadataOverrides: Record<string, Partial<AnalysisData> & { tasks? }>
    nodeSources: Record<string, "ai-generated" | "user-added">
```

**`metadataOverrides` type (updated 0.38):**
The inline type for `metadataOverrides` in `parse-workflow/route.ts` now explicitly declares `connections` and `processes` fields, matching the runtime shape that was already being spread in. This prevents TypeScript from widening the type to `unknown` when these fields are accessed in the same function scope.

**Edge-specific fields** (added in 0.36):
- `edgeSourceLabel` / `edgeTargetLabel` — resolved node display names
- `name` — AI connection label (e.g. "Send Exception File for review")
- `summary` — auto-generated: `"${name} — flow from ${source} to ${target}."`

**Node-specific fields:**
- `processes` — workflow group names the node belongs to (renamed from "Assigned Processes" → "Assigned Workflows" in sidebar display)
- `connections` — display names of all direct neighbour nodes
- `constraints` — free-text operational/compliance constraints (amber styling)
- `tasks[]` — inline editable task list (persisted via `updateMetadata`)

---

## Distributed Agent System (vb0.1)

Branch `vb0.2` formalizes the distributed agent architecture and makes it the default for large-scale operations. It uses a **Strategy Pattern** via `AIEngineContext` to switch between engines.

```
vb0.1/vb0.2 Architecture

Phase 1 — SQLite Foundation      src/lib/db/
Phase 2 — Node-as-an-Agent       src/lib/agents/nodeAgent.ts
                                  src/lib/agents/contextBuilder.ts
                                  src/lib/agents/orchestrator.ts
                                  POST /api/ai/agent
Phase 3 — Message Passing        src/lib/agents/messageBroker.ts
                                  src/lib/agents/cascadeSimulator.ts
                                  POST /api/ai/cascade
Phase 4 — Group Governance       src/lib/agents/groupAgent.ts
                                  POST /api/ai/group-agent
Phase 5 — Infinite Canvas        src/lib/spatialIndex.ts
                                  GET  /api/graph-state/viewport
```

### Token Budget

**The key efficiency claim:** instead of serialising the entire graph into one prompt (~3,000–50,000+ tokens), each node agent receives only its ego-centric local neighbourhood.

#### Per-call estimates

| Operation | Input tokens | Output cap | Typical output | Total/call |
|---|---|---|---|---|
| **NodeAgent** (single node) | 700–1,200 | 1,024 | 300–700 | **~1,000–1,900** |
| **GroupAgent** (5-member group) | 1,500–3,500 | 2,048 | 600–1,200 | **~2,500–5,000** |
| **CascadeSimulator** (per affected node) | 1,000–1,500 | 1,024 | 300–700 | **~1,300–2,200** |

What fills the NodeAgent input (~700–1,200 tokens):

| Section | Tokens |
|---|---|
| Node identity (name, role, summary, constraints) | ~50–150 |
| Tasks list | ~0–100 (0 if none) |
| Inbound edges (3–4 avg) | ~60–100 |
| Outbound edges (2–3 avg) | ~40–80 |
| Group memberships | ~20–60 |
| 1-hop neighbour summaries (3–5 avg) | ~150–400 |
| JSON response schema | ~200–250 |
| User message | ~80–130 |
| **Total** | **~600–1,270** |

#### Full-orchestration totals (N nodes, all parallel)

| Graph size | Total input | Total output | Wall time |
|---|---|---|---|
| 10 nodes | ~9,500 | ~5,000 | ~1–2 s (concurrency=5) |
| 20 nodes | ~19,000 | ~10,000 | ~2–4 s |
| 50 nodes | ~47,500 | ~25,000 | ~4–8 s |
| 100 nodes | ~95,000 | ~50,000 | ~8–15 s |

Concurrency is capped at 5 simultaneous LLM calls (configurable). Wall time scales with `ceil(N / 5)` batches, not N.

#### Comparison: monolithic vs. distributed

| Operation | Calls | Input | Output cap | Total tokens |
|---|---|---|---|---|
| **Monolithic analyze** (`/api/ai/optimize`, current) | 1–2 | 3,500–8,000 | 8,000 | **~11,500–16,000** |
| **Monolithic update** (`/api/ai/update`, current) | 1 | 2,500–6,000 | 8,000 | **~10,500–14,000** |
| **Distributed orchestrate** — 10-node graph | 10 parallel | ~9,500 | 10×1,024 | **~19,700** |
| **Distributed orchestrate** — 20-node graph | 20 parallel | ~19,000 | 20×1,024 | **~39,400** |
| **Distributed orchestrate** — 50-node graph | 50 parallel | ~47,500 | 50×1,024 | **~98,700** |

**Trade-offs:**

- For graphs ≤ ~12 nodes, monolithic uses fewer total tokens.
- For graphs > 12 nodes, distributed uses more total tokens but:
  - **Does not hit a context-window ceiling** (each call stays under 2K input regardless of graph size)
  - **Parallel wall time** is roughly constant, not linear
  - **Precision** — each agent reasons about only its local neighbourhood (fewer hallucinations, more actionable suggestions)
  - **Incremental** — re-run a single node's agent without re-analysing the whole graph

---

### Node-as-an-Agent (Phase 2)

**Entry point:** `POST /api/ai/agent`

```
Modes:
  single      → { nodeId } → AgentResponse (one LLM call)
  orchestrate → { nodeIds? } → OrchestratorResult (N parallel calls)
  simulate    → { payload: SimulationPayload } → SimulationResult (graph traversal)
```

`buildAgentContext(nodeId, state)` in `contextBuilder.ts` constructs the ego-centric view:
- Resolves identity from `NODE_DATA`, `customNodes`, and `metadataOverrides` (in that priority order)
- Collects inbound/outbound edges from both `EDGE_DATA` (core) and `customEdges`, skipping `isImprovementOnly`
- Finds group memberships and peer node IDs
- Builds 1-hop neighbour summaries (name + role + summary)

`AgentOrchestrator` merges all responses into a unified `OrchestratorResult`:
- `bottlenecks[]` — nodes flagged by their own agent or a neighbour's agent
- `proposedEdges[]` — new connections suggested by agents
- `orphanWarnings[]` — nodes with no inbound or no outbound
- `conflicts[]` — cases where two agents propose conflicting changes to the same edge
- `totalTokens` — aggregate input/output across all agents

---

### Message Passing & Cascades (Phase 3)

**Entry point:** `POST /api/ai/cascade`

`MessageBroker` (EventEmitter-based) enforces:
- **Edge validation** — targeted messages must travel along a real graph edge (core or custom)
- **Depth limit** — default `MAX_CASCADE_DEPTH = 5`; messages at depth > limit are rejected
- **Count limit** — default `MAX_MESSAGES_PER_SIMULATION = 100`; prevents runaway cascades
- **System bypass** — `fromNodeId: "system"` skips edge validation for injected triggers

`CascadeSimulator` runs a BFS cascade from a `CascadeTrigger`:
```typescript
type CascadeTriggerType = "remove_edge" | "add_edge" | "remove_node" | "bottleneck_resolve"
```
At each depth level, affected agents receive the trigger context and decide independently whether to propagate it further. This replaces the current Pass 2 monolithic cascade prediction.

**Token cost for cascade:** depth D affecting K nodes per level → `K × D` agent calls, each ~1,300–2,200 tokens. A typical 3-depth cascade touching 3–5 nodes/level = 9–15 calls = ~12,000–33,000 tokens total.

---

### Group-Level Governance (Phase 4)

**Entry point:** `POST /api/ai/group-agent`

`buildGroupContext(groupId, state)` aggregates all member `AgentContext` objects plus:
- **Boundary edges** — edges crossing the group perimeter (inbound/outbound)
- **Adjacent group summaries** — groups reachable via boundary edges (nodeCount, roleSummary, edgeCount)
- **Subgroup / parent group** — hierarchical group structure

`GroupAgent.negotiate(proposal)` supports inter-group negotiation: one group proposes a cross-boundary change; the receiving group's agent evaluates and accepts/counter-proposes/rejects.

**Token cost:** GroupAgent input scales with group size. Rule of thumb: `group_input ≈ (members × 250) + 400` tokens. A 5-member group ≈ 1,650 input tokens; a 10-member group ≈ 2,900 input tokens.

---

### Infinite Canvas & Viewport (Phase 5)

**Entry point:** `GET /api/graph-state/viewport?minX=&minY=&maxX=&maxY=&lod=`

`SpatialIndex` wraps `rbush` (R-tree) for O(log n) spatial queries. Built once from `baselinePositions`; updated incrementally on node drag.

**LOD levels** (controlled by zoom factor):

| Zoom | LOD | Payload contents |
|---|---|---|
| > 0.7 | `full` | All metadata, tasks, group memberships |
| 0.3–0.7 | `simplified` | Name + role only; no metadata details |
| < 0.3 | `dot` | LabelInitials + node type only; no text |

**Margin:** viewport is expanded by 20% in each direction before querying, so nodes just off-screen are pre-loaded for smooth scrolling.

`?since=<timestamp>` returns `{ unchanged: true }` when `lastUpdated ≤ since` — same optimization as the existing 3-second polling endpoint.

---

## Feature Status

| Feature | Status | Branch |
|---|---|---|
| Dual-view canvas (process map + ecosystem hub) | ✅ Complete | 0.1 |
| SVG custom edges with animated pulses | ✅ Complete | 0.1 |
| Node/edge CRUD (right-click, drag-to-connect, delete) | ✅ Complete | 0.1 |
| CSV export / import | ✅ Complete | 0.1 |
| PNG export | ✅ Complete | 0.1 |
| AI workflow generation (Claude) | ✅ Complete | 0.2 |
| AI bottleneck analysis | ✅ Complete | 0.2 |
| Google Gemini support | ✅ Complete | 0.2 |
| ByteDance Doubao support | ✅ Complete | 0.33 |
| Configurable base URL (Coding Plan) | ✅ Complete | 0.35 |
| Workflow groups + nested sub-groups | ✅ Complete | 0.33 |
| Group-aware physics layout (hub gravity, AABB) | ✅ Complete | 0.33 |
| AABB oscillation fix (accumulated node-level deltas) | ✅ Complete | 0.33 |
| Sharing-group centroid repulsion | ✅ Complete | 0.33 |
| Union-bbox node eviction | ✅ Complete | 0.33 |
| Node tasks (status, priority, due date, notes) | ✅ Complete | 0.33 |
| Entity constraints field (amber badge) | ✅ Complete | 0.33 |
| `maxTokens` 3 000 → 8 000 | ✅ Complete | 0.34 |
| `extractJSON` + `jsonrepair` robust parsing | ✅ Complete | 0.34 |
| AI Debug Log button (always visible, modal) | ✅ Complete | 0.34 |
| Hydration SSR fix (static init + useEffect) | ✅ Complete | 0.34 |
| 8 000-char textarea cap + counter | ✅ Complete | 0.34 |
| Edge `name` stored & displayed in sidebar | ✅ Complete | 0.36 |
| Data Flow Direction row (From → To pill) | ✅ Complete | 0.36 |
| `connections` derived from edges in metadata | ✅ Complete | 0.37 |
| `processes` derived from workflow groups | ✅ Complete | 0.37 |
| Template metadata (real names, derived fields) | ✅ Complete | 0.37 |
| Workable brand icon (SVG, favicon, header logo) | ✅ Complete | 0.37 |
| Doubao endpoint ID preserved across sessions | ✅ Complete | 0.38 |
| First-generation layout enforces Reset Layout rules | ✅ Complete | 0.38 |
| Orphaned subgroup treated as top-level in layout | ✅ Complete | 0.38 |
| `metadataOverrides` type includes `connections` + `processes` | ✅ Complete | 0.38 |
| AI Update — plain-English patch any aspect of the workflow | ✅ Complete | 0.39 |
| AI Update — semantic snapshot context (no coordinate noise) | ✅ Complete | 0.39 |
| AI Update — server-side patch validation (ID guards, color palette, CORE_NODE protection) | ✅ Complete | 0.39 |
| AI Update — two-panel modal (prompt input → diff preview → apply) | ✅ Complete | 0.39 |
| AI Update — cascade edge removal when nodes are deleted | ✅ Complete | 0.39 |
| AI Update — group membership extensions (`addNodeIds` / `removeNodeIds`) | ✅ Complete | 0.39 |
| Persistent database backend | 🔶 In progress | vb0.1 |
| Node-as-an-Agent distributed analysis | 🔶 In progress | vb0.1 |
| Message broker + organic cascade simulation | 🔶 In progress | vb0.1 |
| Group-level governance agents | 🔶 In progress | vb0.1 |
| Viewport streaming + R-tree spatial index | 🔶 In progress | vb0.1 |
| Feature | Status | Branch |
|---|---|---|
| Real-time SSE Sync (multi-tab) | ✅ Complete | 0.5 |
| Undo/Redo (50-step circular buffer) | ✅ Complete | 0.42 |
| Distributed reasoning engine toggle | ✅ Complete | vb0.2 |
| Token usage tracking in debug logs | ✅ Complete | vb0.2 |
| PNG export | ✅ Complete | 0.1 |

---

## Branch & Version History

| Branch | Key changes |
|---|---|
| `0.1` | Foundation: Next.js scaffold, SVG canvas, node/edge CRUD, CSV export, polling |
| `0.2` | AI integration: Claude parse-workflow, AI analyze, Gemini support |
| `0.21` | Smart layout, ecosystem web-map, entity constraints field |
| `0.33-personal` | Doubao provider, workflow groups, group-aware physics layout, node tasks, all layout bug fixes |
| `0.34-personal` | 8k token budget, `extractJSON` + `jsonrepair`, AI Debug Log, hydration fix, char counter |
| `0.35-personal` | Configurable `baseUrl` per provider (Coding Plan support) |
| `0.36-personal` | Edge name/summary in sidebar, Data Flow Direction row, `edgeSourceLabel`/`edgeTargetLabel` |
| `0.37-personal` | Derived connections + workflow group memberships in metadata, template metadata overhaul, Workable brand icon + README |
| `0.38-personal` | Endpoint ID caching (Doubao no longer wiped on load), post-import `resetLayout` pass so first-generation layout matches Reset Layout, orphaned subgroup fix in `groupAwareLayout`, explicit `connections`/`processes` in `metadataOverrides` type |
| `0.39-personal` | AI Update feature: plain-English prompt applies any change to the live graph (add/update/remove nodes, edges, groups). Semantic snapshot context builder strips coordinates. Server-side patch validation guards protected nodes, validates IDs, auto-cascades edge removal. Two-panel modal: prompt input → colour-coded diff preview → sequential apply with `resetLayout` reflow. |
| `vb0.1` | Distributed agent architecture (5 phases, all additive/feature-flagged). Phase 1: SQLite persistence layer (schema + adapter). Phase 2: NodeAgent + AgentOrchestrator — ego-centric per-node prompts (~700–1,200 input tokens each vs. monolithic ~3,500–8,000 tokens for the whole graph). Phase 3: EventEmitter MessageBroker + BFS CascadeSimulator. Phase 4: GroupAgent with boundary context and inter-group negotiation. Phase 5: R-tree spatial index, LOD system, viewport-filtered state endpoint. |

---

## Development Patterns

### Adding a new template

Templates live in `src/lib/templates.ts`. Each template calls `buildTemplateState(config)` which:
1. Takes `nodes`, `edges`, `groups`, and `settings` overrides
2. Auto-derives `metadataOverrides` per node: `connections` from edges, `processes` from group membership
3. Returns a `GraphState`-compatible object ready for `importState()`

```typescript
// Minimal template structure
export function buildMyTemplate(): Partial<GraphState> {
  const nodes: CustomNodeConfig[] = [ /* ... */ ];
  const edges: CustomEdgeConfig[]  = [ /* ... */ ];
  const groups: WorkflowGroup[]    = [ /* ... */ ];
  return buildTemplateState({ nodes, edges, groups });
}
```

### Adding a new sidebar field

1. Add the field to `AnalysisData` in `AnalysisSidebar.tsx`
2. Populate it in the `useEffect` in `page.tsx` (from `fullServerState`, `workflowCache`, or derived logic)
3. Render it in the sidebar body using `<EditableField>` or `<EditableList>`
4. If it needs persistence: add the field to `updateMetadata`'s PUT body in `handleSave`

### Debugging AI parse failures

1. Click **AI Debug Log** (always visible, bottom-left corner)
2. The modal shows:
   - **Prompt sent** — full text with schema injected
   - **Raw AI response** — exactly what the model returned before any parsing
3. Common failure modes:
   - Model wraps JSON in `\`\`\`json` fences → handled by `extractJSON`
   - Model adds preamble / postamble text → handled by brace-depth scan
   - Model generates invalid JSON (missing quote, trailing comma) → handled by `jsonrepair`
   - Model generates semantically wrong structure (wrong field names) → prompt engineering

### Doubao endpoint ID persistence

The `loadAIConfig()` function in `AISettingsModal.tsx` merges the saved `localStorage` value with defaults on every page load. Prior to 0.38, a guard clause erased any `models.doubao` value that did not start with `"ep-"`, which wiped user-configured model names (e.g. `doubao-seed-2.0-lite`) every session.

That guard has been removed. The saved endpoint / model value is now always respected. If a user needs to reset it, they open AI Settings and clear the Endpoint ID field manually.

### First-generation layout consistency

`importStateAndStart` in `page.tsx` (called after both AI parse and template load) now issues two sequential server calls before revealing the canvas:

1. `PUT /api/graph-state { action: "importState", … }` — stores nodes, edges, groups, metadata
2. `PUT /api/graph-state { action: "resetLayout" }` — re-runs `hierarchicalLayout` + `groupAwareLayout` using the just-stored groups

This guarantees that the positions the user sees on first load are identical to what Reset Layout would produce, instead of using the raw positions that the parse-workflow route calculated before group sanitization was complete.

### Hydration / SSR rules

- **Never** call `localStorage` inside `useState(initializer)` or component body
- Use `useEffect` for any client-side-only reads (AI config, saved state)
- `aiConfig` is initialised with a static default object, then overwritten in `useEffect(() => setAiConfig(loadAIConfig()), [])`

---

## Roadmap

### In progress (vb0.1)

- **SQLite persistence** — `src/lib/db/` has the full schema and adapter ready; wire up by swapping `getGraphState` / `importState` in `serverState.ts` to call the adapter when `WORKABLE_USE_DB=true`
- **Distributed analysis UI** — frontend controls for triggering node-agent orchestration and displaying per-node results (the API routes exist; no UI yet)
- **Cascade visualisation** — animate cascade propagation steps as a time-ordered edge pulse sequence

### Near-term

- **Real-time collaboration** — upgrade 3-second polling to WebSocket. The viewport endpoint already supports `?since=` for diff-only delivery; extend to push model.
- **Feature flag UI** — settings panel toggle for each distributed phase (currently env-var only)

### Medium-term

- **Constraint propagation** — when a constrained node is blocked, visually cascade a risk indicator through all downstream edges and nodes (Phase 3 cascade infrastructure is already built)
- **Webhook ingestion** — receive POST events from Slack / Jira / GitHub and animate a live pulse on the relevant graph edge when the event fires

### Long-term

- **OCR / PDF import** — extract workflow actors and handoffs from scanned SOPs or Jira CSV exports
- **Diff view** — snapshot two graph states and highlight added/removed nodes, changed edge names, and shifted groups
- **Shareable links** — serialise graph state to a URL-safe token; render read-only view without auth
