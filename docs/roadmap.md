# Feature Status & Roadmap

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
| Real-time SSE Sync (multi-tab) | ✅ Complete | 0.5 |
| Undo/Redo (50-step circular buffer) | ✅ Complete | 0.42 |
| Distributed reasoning engine toggle | ✅ Complete | vb0.2 |
| Token usage tracking in debug logs | ✅ Complete | vb0.2 |

---

## Roadmap

### 🚀 Launch & Core Systems (Completed)

- [x] **GitHub Launch** — Repository is live and ready for clones
- [x] **Real-time synchronization** — Server-Sent Events (SSE) for instant multi-tab sync
- [x] **Distributed Reasoning** — Node-agent architecture for 100+ node scalability
- [/] **Persistent storage** — localStorage auto-save + named snapshots in production

### In progress (vb0.1 / vb0.2)

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
