# Neural Workflow & Ecosystem Twin

<p align="center">
  <em>An interactive visualizer for mapping, analyzing, and optimizing business operations — built with Next.js, Claude AI, and TypeScript.</em>
</p>

---

## 📌 Project Overview

The **Neural Workflow & Ecosystem Twin** is a full-stack web application that transforms raw workflow descriptions into a dynamic, interactive digital twin. Users can spot bottlenecks, model optimization scenarios, add custom nodes/edges in real time, generate entire workflows from natural language using AI, and export results — all from a clean, prototype-faithful UI.

---

## 🏆 Version 0.2 — AI Integration

Version 0.2 builds directly on v0.1 by implementing the full Phase 4 AI roadmap using the **Anthropic Claude API**.

- **AI Workflow Parser**: Describe any workflow in plain English on the Start Screen — Claude parses it into nodes, edges, and positions and loads it directly onto the canvas.
- **AI Optimization Analyst**: Click "AI Analyze" in the header to have Claude analyze the current graph for bottlenecks and generate a structured optimization report (Summary → Bottlenecks → Recommendations → Quick Wins).
- **API Key Management**: A settings modal (gear icon in the header) lets users enter and persist their own Anthropic API key in browser local storage — no server-side secrets required.
- **Fixed Documentation**: Corrected inaccuracies across all docs from v0.1 (component table, file references, phase descriptions).
- **Package Name**: Renamed from `temp-app` to `neural-workflow-twin`.

---

## 🏆 Version 0.1 — Foundation

Version 0.1 marks the successful transition from a static prototype to a production-grade interactive framework.

- **Framework Migration**: Fully ported from vanilla HTML/JS to **Next.js 16 + React 19 + TypeScript**.
- **Interactive Canvas**: Custom SVG canvas with squircle/circle nodes and animated data-pulse wires.
- **Dynamic CRUD**: Full support for adding, editing, and deleting nodes and edges via right-click and interactive handles.
- **Bidirectional Metadata Sync**: Automated synchronisation between the **Analysis Sidebar** and the visual graph, including name-to-ID resolution.
- **Backend Persistence**: Server-side state management with real-time polling (3-second intervals).
- **Advanced Optimisation**: "Improvements Mode" highlights optimised routes and fades legacy bottlenecks.
- **Export Capabilities**: Native **PNG** rendering and **CSV** export/import.

---

## ✅ Phase 1 — Prototype (UI/UX Baseline)

The `prototype.html` file is the interactive frontend prototype. It demonstrates the following UI/UX paradigms:

- **Miro-Style Start Screen** — frosted-glass landing page with natural language text input and a drag-and-drop file zone.
- **Dual View Rendering** — seamless toggling between a linear *Baseline Process Map* and a human-centric *Ecosystem Hub*.
- **Optimisation Toggles** — "Improvements" engine that visually fades deprecated bottlenecks (e.g., Edward's manual review) and highlights newly automated routes (e.g., Mary → Dashboard API).
- **Custom Physics & Interactivity** — draggable nodes (squircle/circle designs) with real-time recalculating connection lines and continuous CSS-animated data pulses.
- **Deep-Dive Analysis** — clickable nodes and wires that trigger a slide-out right sidebar with entity roles, system status, assigned processes, and connections.

---

## ✅ Phase 2 — Core Development (Frontend Framework Migration)

The vanilla HTML/JS prototype was ported to a production-ready **Next.js 16 + React 19 + TypeScript** app:

| Area | Implementation |
|---|---|
| **Framework** | Next.js 16 (App Router) with React 19 |
| **Graphing Engine** | Custom SVG canvas with Pythagorean wire math (no external graph library dependency) |
| **Componentisation** | `<StartScreen />`, `<GraphCanvas />`, `<AnalysisSidebar />` — node/edge renderers are inlined in `GraphCanvas.tsx` |
| **State Management** | React `useState` / `useEffect` with server-side API for persistence |
| **Backend API** | Next.js Route Handlers (`/api/workflow`, `/api/graph-state`) |
| **Font** | Inter (via `next/font/google`) matching prototype exactly |
| **Animations** | CSS `pulse-amber` animation + SVG `animateMotion` data pulses |

---

## ✅ Phase 3 — MVP Features

All Phase 3 features from the development roadmap are now implemented:

### 1. Dynamic Graph Generation
The canvas renders dynamically based on a **JSON payload from the `/api/workflow` backend**, not hardcoded HTML elements. Node positions and graph structure are fetched on load and persisted server-side via the `/api/graph-state` endpoint.

### 2. CRUD Capabilities for Nodes & Edges
- **Add Node** — Right-click anywhere on the canvas background → "Add Node Here" → fill in name, initials, and role type.
- **Create Connection** — Drag from any node's handle to another node to create a new connection wire, saved automatically.
- **Delete Node/Edge** — Select any node or edge and press the `Delete` key. Custom nodes also show a **Delete Node** button in the Analysis Sidebar. Core workflow nodes are protected from deletion.

### 3. Real-Time Collaboration (Polling-Based)
Every **3 seconds**, each client polls `/api/graph-state` for remote updates. Node drag positions are saved immediately to the server. Other browser tabs receive the updated positions on their next poll. The server uses a **module-level singleton** (`src/lib/serverState.ts`) that persists across requests in the Next.js dev server.

> **Note:** v0.1 uses polling rather than WebSockets for simplicity. WebSocket support remains on the long-term roadmap.

### 4. Save & Export
- **Export PNG** — Builds an SVG from current node/edge positions, renders to `<canvas>`, downloads as `.png` (no external library required).
- **Export CSV** — Serialises full graph state to `.csv` via a Blob download.
- **Import CSV** — Available on both the Start Screen and the header Import button.

---

## ✅ Phase 4 — AI-Powered Workflow Analysis

Phase 4 integrates **Claude** (Anthropic) to bridge the gap between abstract descriptions and structured visual models.

### 1. AI Workflow Parser

**How it works:**
1. On the Start Screen, type a natural language description of any workflow in the *AI Workflow Generation* textarea (e.g., "Script A sends data to Xingye, which routes to Mary for approval, then to the Dashboard").
2. Set your Anthropic API key via the **Set API key** link (stored only in your browser).
3. Click **Generate with AI** — the description is sent to `POST /api/ai/parse-workflow`.
4. The route calls **Claude** with a structured system prompt that enforces a JSON output schema (`nodes[]` + `edges[]`).
5. The API calculates linear baseline positions and radial ecosystem positions for the new nodes.
6. The resulting graph is loaded into the canvas via the existing `importState` endpoint.

### 2. AI Optimization Analyst

**How it works:**
1. Click **AI Analyze** (✦ sparkle icon) in the application header.
2. The current server graph state (core nodes, core edges, custom nodes, custom edges, metadata) is sent to `POST /api/ai/optimize`.
3. **Claude** analyses the workflow and returns a structured report:
   - **Workflow Summary** — 2–3 sentence overview
   - **Bottlenecks Identified** — named nodes/edges causing delays
   - **Optimisation Recommendations** — 3–5 specific, actionable improvements
   - **Quick Wins** — highest impact-to-effort changes
4. The analysis is displayed in a modal overlay.

### 3. API Key Management

**How it works:**
- Click the **gear (⚙)** icon in the header to open the AI Settings modal.
- Enter your `sk-ant-api03-...` Anthropic API key.
- The key is saved to browser `localStorage` under `nwt_ai_api_key` — it is never stored on the server.
- A green indicator dot on the gear icon shows when a key is active.
- Keys can be cleared at any time from the settings modal.

---

## 🚀 Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To use AI features, obtain an API key from [console.anthropic.com](https://console.anthropic.com) and enter it via the gear icon in the app header.

### Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── ai/
│   │   │   ├── parse-workflow/route.ts  # POST: natural language → graph nodes/edges (Claude)
│   │   │   └── optimize/route.ts        # POST: graph state → optimisation report (Claude)
│   │   ├── workflow/route.ts            # GET: node/edge metadata + layout positions
│   │   └── graph-state/route.ts        # GET poll / PUT mutate (real-time state)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                        # Main app shell, header, AI orchestration
├── components/
│   ├── AIAnalysisModal.tsx             # Modal: displays Claude optimisation report
│   ├── AISettingsModal.tsx             # Modal: Anthropic API key management
│   ├── AnalysisSidebar.tsx             # Slide-out panel for node/edge editing
│   ├── Edges.tsx                       # Stub (wire rendering is inline in GraphCanvas)
│   ├── GraphCanvas.tsx                 # SVG canvas: CRUD, export, drag, wires
│   ├── Nodes.tsx                       # TypeScript types for custom node data
│   └── StartScreen.tsx                 # Landing page with CSV import + AI generation
└── lib/
    ├── constants.ts                    # Hardcoded core NODE_DATA and EDGE_DATA
    └── serverState.ts                  # In-memory graph state singleton
```

### Environment

No `.env` file is required. The Anthropic API key is managed entirely client-side via browser `localStorage` and passed to the server only as a request body parameter on AI calls.
