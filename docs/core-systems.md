# Core Systems

## State Management

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

## AI Pipeline

**Entry point:** `POST /api/ai/parse-workflow`

```text
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

## AI Update Pipeline

**Entry point:** `POST /api/ai/update`

```text
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

## Layout Engine

`src/lib/layout.ts` contains two layout algorithms:

### `hierarchicalLayout(nodes, edges)`
Sugiyama-style topological sort → assign columns → centre within column. Produces left-to-right flow for the baseline process map view.

### `groupAwareLayout(nodes, edges, groups, canvasW, canvasH)`
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

## Analysis Sidebar

`AnalysisSidebar.tsx` renders the right slide-out panel. Data flows:

```text
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
