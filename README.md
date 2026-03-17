# Neural Workflow & Ecosystem Twin

<p align="center">
  <em>An interactive visualizer for mapping, analyzing, and optimizing business operations — built with Next.js, React Flow, and TypeScript.</em>
</p>

---

## 📌 Project Overview

The **Neural Workflow & Ecosystem Twin** is a full-stack web application that transforms raw workflow descriptions into a dynamic, interactive digital twin. Users can spot bottlenecks, model optimization scenarios, add custom nodes/edges in real time, and export results — all from a clean, prototype-faithful UI.

---

## ✅ Phase 1 — Prototype (UI/UX Baseline)

The `prototype.html` file is the interactive frontend prototype. It demonstrates the following UI/UX paradigms:

- **Miro-Style Start Screen** — frosted-glass landing page with natural language text input and a drag-and-drop file zone.
- **Dual View Rendering** — seamless toggling between a linear *Baseline Process Map* and a human-centric *Ecosystem Hub*.
- **Optimization Toggles** — "Improvements" engine that visually fades deprecated bottlenecks (e.g., Edward's manual review) and highlights newly automated routes (e.g., Mary → Dashboard API).
- **Custom Physics & Interactivity** — draggable nodes (squircle/circle designs) with real-time recalculating connection lines and continuous CSS-animated data pulses.
- **Deep-Dive Analysis** — clickable nodes and wires that trigger a slide-out right sidebar with entity roles, system status, assigned processes, and connections.

---

## ✅ Phase 2 — Core Development (Frontend Framework Migration)

The vanilla HTML/JS prototype was ported to a production-ready **Next.js 16 + React 19 + TypeScript** app:

| Area | Implementation |
|---|---|
| **Framework** | Next.js 16 (App Router) with React 19 |
| **Graphing Engine** | `@xyflow/react` (React Flow v12) replacing custom Pythagorean wire math |
| **Componentization** | `<StartScreen />`, `<GraphCanvas />`, `<NeuralNode />`, `<EcoNode />`, `<AnimatedPulseEdge />`, `<AnalysisSidebar />` |
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
- **Add Node** — Right-click anywhere on the canvas background to open a context menu → "Add Node Here" → fill in name, initials, and role type in a modal form.
- **Create Connection** — Drag from any node's handle to another node to create a new connection wire. The edge is saved to the server automatically.
- **Delete Node/Edge** — Select any node or edge and press the `Delete` key to remove it. Custom nodes also show a **Delete Node** button in the Analysis Sidebar. Core workflow nodes are protected from deletion.

### 3. Real-Time Collaboration (Polling-Based)
- Every **3 seconds**, each client polls `/api/graph-state` to check for remote updates.
- When a user drags a node to a new position, the coordinates are **immediately saved** to the server via `PUT /api/graph-state`.
- If another browser tab (or user) polls next, they receive the updated positions and their canvas syncs automatically.
- The server state uses a **module-level singleton** (`src/lib/serverState.ts`) that persists across requests in the Next.js dev server.

### 4. Save & Export
- **Export PNG** — Click the `PNG` button in the header. A native SVG is built from current node/edge positions and rendered to a `<canvas>` element, then downloaded as a `.png` file (no external library required).
- **Export CSV** — Click the `CSV` button in the header. Node metadata (id, name, role, status, summary) is serialized to a `.csv` file using a Blob download — no server round-trip needed.

---

## 🤖 Phase 4 — AI-Powered Workflow Analysis

This phase integrates Large Language Models (LLMs) to bridge the gap between abstract descriptions and structured visual models.

### 1. Automated Workflow Parsing
- **Text Prompt to Graph**: The core AI feature allows users to paste natural language descriptions (e.g., "Script A sends data to Xingye, which then routes to Mary"). The AI automatically parses these prompts to create nodes, assignments, and relations on the canvas.
- **Model Storage & CSV**: CSV ingestion remains focused on importing/exporting full model structures (preserving precisely mapped JSON states).

### 2. Model & Key Management
- **Vendor Agility**: Built-in support for providers like **Google Gemini**.
- **User-Owned Keys**: A secure settings panel allows users to manage their own API keys (e.g., `GEMINI_API_KEY`) for full control over cost and privacy.
- **Model Selection**: Toggle between models (e.g., Gemini 1.5 Flash for speed vs. Gemini 1.5 Pro for deep reasoning) based on the complexity of the workflow being parsed.

### 3. Smart Optimization (Roadmap)
- **Bottleneck Detection**: AI-driven analysis of node delays and edge sequences to autonomously suggest improvements.
- **Proactive Design**: Suggesting best-practice architectures based on industry-standard process maps.

---

## 🚀 Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── workflow/route.ts       # Node/edge metadata + layout positions
│   │   └── graph-state/route.ts   # Real-time state (GET poll / PUT mutate)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                   # Main app shell + header + tooltip
├── components/
│   ├── AnalysisSidebar.tsx        # Slide-out panel with delete action
│   ├── Edges.tsx                  # AnimatedPulseEdge (SVG animateMotion)
│   ├── GraphCanvas.tsx            # React Flow canvas + CRUD + export
│   ├── Nodes.tsx                  # NeuralNode (circle) + EcoNode (squircle)
│   └── StartScreen.tsx            # Landing page
└── lib/
    └── serverState.ts             # In-memory graph state singleton
```
