# Overflow: Neural Workflow & Ecosystem Twin

<p align="center">
  <em>An interactive visualizer for mapping, analyzing, and optimizing business operations.</em>
</p>

## 📌 Project Overview
The **Neural Workflow & Ecosystem Twin** is an interactive visualizer for mapping, analyzing, and optimizing business operations. It transitions a user from raw workflow inputs (text/files) into a dynamic, interactive digital twin of their processes, allowing them to spot bottlenecks and model "What-If" optimizations.

The original prototype is in `prototype.html`. The production application lives in `src/`.

---

## 🚀 Phase 1: Current Prototype Features (UI/UX Baseline)
The `prototype.html` file serves as the interactive frontend prototype. It successfully demonstrates the following UI/UX paradigms:

- **Miro-Style Start Screen**: A frosted-glass landing page with natural language text input and a drag-and-drop file zone.
- **Dual View Rendering**: Seamless toggling between a linear *Baseline Process Map* and a human-centric *Ecosystem Hub*.
- **Optimisation Toggles**: An "Improvements" engine that visually fades deprecated bottlenecks (e.g., Edward's manual review) and highlights newly automated routes (e.g., Mary to Dashboard API).
- **Custom Physics & Interactivity**: Draggable nodes (squircle/circle designs) with real-time recalculating connection lines (wires) and continuous CSS-animated data pulses. The pulse speed realistically reflects actual processing time, and the pulse color dynamically depends on the source entity producing the data.
- **Deep-Dive Analysis**: Clickable nodes and connection wires that trigger a slide-out right sidebar displaying entity roles, system status, assigned processes, and connections.

---

## 🛠 Phase 2: Core Development Steps (Transitioning to Full-Stack)
To move from a static frontend prototype to a functional web application, the following architecture and development steps are required:

### 1. Frontend Framework Migration
- **Action**: Port the vanilla HTML/JS into React or Vue.js (Next.js/Nuxt recommended).
- **Why**: To handle complex state management. The hardcoded `nodeData` and `edgeData` dictionaries need to be replaced with a dynamic global state (e.g., using Redux, Zustand, or Pinia).
- **Componentisation**: Break down the UI into modular components: `<StartScreen />`, `<GraphCanvas />`, `<Node />`, `<Wire />`, `<AnalysisSidebar />`.

### 2. Graphing Engine Implementation
- **Action**: Replace the custom Pythagorean math calculating the wire angles with a robust graphing library (e.g., React Flow, Cytoscape.js, or D3.js) — or keep the custom math if graph complexity stays low.
- **Why**: While the custom math works for 5–7 nodes, a dedicated library provides collision detection, auto-layout algorithms, and zooming/panning out-of-the-box for larger graphs.

### 3. Backend & API Setup
- **Action**: Build a backend (Node.js/Express or Python/FastAPI) to handle the Start Screen inputs.
- **Database**: Implement a graph database (like Neo4j) or a document database (like MongoDB) to store saved ecosystem models, node properties, and historical workflow versions. For v0.1–v0.2 the server uses a module-level singleton; this is a dev-only pattern and should be replaced with a real database for production.

---

## ⚙️ Phase 3: Features to Develop (MVP Scope)
Based on the prototype, these features need functional backend logic to be fully realized:

- **Dynamic Graph Generation**: The canvas must render dynamically based on a JSON payload from the backend, rather than hardcoded HTML `<div>` elements. ✅ *Implemented in v0.1*
- **CRUD Capabilities for Nodes/Edges**: Users should be able to right-click the canvas to "Add Node" or drag between nodes to "Create Connection" directly within the visualizer. ✅ *Implemented in v0.1*
- **Real-Time Sync (Polling)**: If user A drags a node or updates a status to "Bottleneck," user B should see the change on their next poll (3-second interval). ✅ *Implemented in v0.1 via polling. WebSocket upgrade remains on the roadmap.*
- **Save & Export**: Ability to export the graph as PNG, or export/import the node data as CSV. ✅ *Implemented in v0.1*

---

## 🤖 Phase 4: AI Integration
The ultimate goal of the Ecosystem Data Engine is to use AI to bridge the gap between messy real-world data and structured visual models.

### 1. AI-Powered Workflow Generation (LLM Integration) ✅ *Implemented in v0.2*
- **Feature**: Connect the Start Screen's text input to the **Anthropic Claude API**.
- **How it works**: When a user types "Xingye gets input from NAV back office, uses a script to parse data, then Mary reviews it…", Claude parses the natural language, identifies entities, determines data flow direction, and outputs the JSON array needed to render the graph automatically. Positions are calculated server-side and loaded via the `importState` endpoint.

### 2. AI Workflow Optimisation ✅ *Implemented in v0.2*
- **Feature**: "AI Analyze" button in the application header.
- **How it works**: The current server graph state is sent to Claude along with a structured analysis prompt. Claude returns a four-section report: Workflow Summary, Bottlenecks Identified, Optimisation Recommendations, and Quick Wins. Displayed in a modal overlay.

### 3. Intelligent Document Processing (OCR + RAG) — *Roadmap*
- **Feature**: Process files dropped in the Start Screen.
- **How it works**: If a user drops a standard operating procedure (SOP) PDF or a Jira CSV export, the AI reads the document, extracts the key personnel and software tools, and maps their relationships without the user typing a single word.

### 4. Live Data Ingestion & Pulse Synchronisation — *Roadmap*
- **Feature**: Make the "Electric Pulses" represent real-world events.
- **How it works**: Connect the app via Webhooks to real-world tools (Slack, Jira, Outlook). When Xingye actually emails Mary in real life, a pulse shoots across the screen in the digital twin. If the data flow stops, the wire turns red, indicating a live process failure.
