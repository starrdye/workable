# Distributed Agent System (vb0.1)

Branch `vb0.2` formalizes the distributed agent architecture and makes it the default for large-scale operations. It uses a **Strategy Pattern** via `AIEngineContext` to switch between engines.

```text
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

```text
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
