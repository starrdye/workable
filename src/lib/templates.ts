/**
 * templates.ts — Pre-built workflow templates for the template gallery.
 *
 * Each template has:
 *   • Metadata   — name, description, density label, node/edge counts
 *   • Node list  — custom node definitions (all roles: person/tool/external/output)
 *   • Edge list  — directed edges with sequence numbers
 *
 * buildTemplateState() runs the layout algorithms and returns the full
 * importState payload expected by PUT /api/graph-state.
 *
 * Density tiers map to which layout features they showcase:
 *   few  → straight lines + simple beziers  (current 4–7 node default)
 *   some → single beziers + mild radial rings  (~12–14 nodes)
 *   many → 4-arc bundles + concentric force rings  (~22 nodes)
 */

import { hierarchicalLayout, radialWebLayout } from "./layout";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeRole = "person" | "tool" | "external" | "output";

export interface TplNode {
  id: string;
  label: string;
  initials: string;
  role: NodeRole;
  textColor?: string;
}

export interface TplEdge {
  source: string;
  target: string;
  sequence?: number;
  weight?: number;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  density: "few" | "some" | "many";
  nodeCount: number;
  edgeCount: number;
  /** If true the built-in Ridgeview core nodes are kept visible. */
  useBuiltins?: boolean;
  nodes: TplNode[];
  edges: TplEdge[];
}

// ── Role colours (must stay in sync with GraphCanvas) ────────────────────────

const ROLE_COLOR: Record<NodeRole, string> = {
  person:   "#4F46E5",
  tool:     "#64748B",
  external: "#475569",
  output:   "#10B981",
};

// ── Template definitions ──────────────────────────────────────────────────────

export const TEMPLATES: Template[] = [

  // ── 0. Blank Canvas ──────────────────────────────────────────────────────
  {
    id: "blank",
    name: "Blank Canvas",
    description: "Start from scratch — drag in nodes and draw connections yourself.",
    density: "few",
    nodeCount: 0,
    edgeCount: 0,
    nodes: [],
    edges: [],
  },

  // ── 1. Ridgeview Workflow (default) ──────────────────────────────────────
  {
    id: "ridgeview",
    name: "Ridgeview Workflow",
    description: "NAV fund pipeline: data ingestion → parsing → review → dashboard. The classic 7-node starter.",
    density: "few",
    nodeCount: 7,
    edgeCount: 8,
    useBuiltins: true,
    nodes: [],
    edges: [],
  },

  // ── 2. Product Launch Pipeline (~14 nodes) ────────────────────────────────
  //
  // Showcases: single bezier edges (PM hub has degree 6 → would trigger bundle
  // in a denser graph), clean radial rings, barycenter-ordered layers.
  {
    id: "product-launch",
    name: "Product Launch",
    description: "Full product cycle from stakeholder to launch analytics. ~14 people & tools, moderate density.",
    density: "some",
    nodeCount: 14,
    edgeCount: 19,
    nodes: [
      { id: "stakeholder", label: "Stakeholder",    initials: "SH", role: "external" },
      { id: "pm",          label: "Product Manager",initials: "PM", role: "person"   },
      { id: "cto",         label: "CTO",            initials: "CT", role: "person"   },
      { id: "designer",    label: "UX Designer",    initials: "UX", role: "person"   },
      { id: "figma",       label: "Figma",          initials: "FG", role: "tool"     },
      { id: "fe-dev",      label: "Frontend Dev",   initials: "FE", role: "person"   },
      { id: "be-dev",      label: "Backend Dev",    initials: "BE", role: "person"   },
      { id: "prod-db",     label: "Database",       initials: "DB", role: "tool"     },
      { id: "jira",        label: "Jira Board",     initials: "JR", role: "tool"     },
      { id: "qa",          label: "QA Engineer",    initials: "QA", role: "person"   },
      { id: "deploy",      label: "Deployment",     initials: "DP", role: "tool"     },
      { id: "mktg",        label: "Marketing",      initials: "MK", role: "person"   },
      { id: "content",     label: "Content Writer", initials: "CW", role: "person"   },
      { id: "analytics",   label: "Analytics",      initials: "AN", role: "output"   },
    ],
    edges: [
      { source: "stakeholder", target: "pm",       sequence: 1 },
      // PM is the central hub — degree 7 → triggers 4-arc bundle in eco view
      { source: "pm",          target: "designer",  sequence: 2 },
      { source: "pm",          target: "cto",       sequence: 2 },
      { source: "pm",          target: "jira",      sequence: 2 },
      { source: "pm",          target: "qa",        sequence: 2 },
      { source: "pm",          target: "mktg",      sequence: 2 },
      { source: "pm",          target: "content",   sequence: 2 },
      { source: "pm",          target: "analytics", sequence: 9 },
      { source: "designer",    target: "figma",     sequence: 3 },
      { source: "cto",         target: "be-dev",    sequence: 3 },
      { source: "figma",       target: "fe-dev",    sequence: 4 },
      { source: "jira",        target: "fe-dev",    sequence: 4 },
      { source: "jira",        target: "be-dev",    sequence: 4 },
      { source: "be-dev",      target: "prod-db",   sequence: 5 },
      { source: "fe-dev",      target: "deploy",    sequence: 6 },
      { source: "be-dev",      target: "deploy",    sequence: 6 },
      { source: "deploy",      target: "qa",        sequence: 7 },
      { source: "qa",          target: "mktg",      sequence: 8 },
      { source: "mktg",        target: "analytics", sequence: 9 },
    ],
  },

  // ── 3. Data Platform Architecture (~22 nodes) ─────────────────────────────
  //
  // Showcases: 4-arc bundles (warehouse degree 9), concentric force rings
  // (ring 1 & 2 each have > 4 nodes), deep 4-ring radial structure.
  {
    id: "data-platform",
    name: "Data Platform",
    description: "Enterprise data architecture: 5 sources, ingestion, processing, storage, serving, and governance.",
    density: "many",
    nodeCount: 22,
    edgeCount: 28,
    nodes: [
      // ── Data Sources (external) ──────────────────────────────────────
      { id: "crm",      label: "CRM System",     initials: "CR", role: "external" },
      { id: "erp",      label: "ERP System",     initials: "ER", role: "external" },
      { id: "iot",      label: "IoT Sensors",    initials: "IO", role: "external" },
      { id: "web",      label: "Web Events",     initials: "WB", role: "tool"     },
      { id: "partner",  label: "Partner API",    initials: "PA", role: "external" },
      // ── Ingestion layer ──────────────────────────────────────────────
      { id: "kafka",    label: "Kafka",          initials: "KF", role: "tool"     },
      { id: "batch",    label: "Batch ETL",      initials: "BT", role: "tool"     },
      { id: "apigw",    label: "API Gateway",    initials: "GW", role: "tool"     },
      // ── Processing layer ─────────────────────────────────────────────
      { id: "spark",    label: "Spark Cluster",  initials: "SP", role: "tool"     },
      { id: "dbt",      label: "dbt Transform",  initials: "DT", role: "tool"     },
      { id: "mlpipe",   label: "ML Pipeline",    initials: "ML", role: "tool"     },
      { id: "dq",       label: "Data Quality",   initials: "DQ", role: "tool"     },
      // ── Storage layer ────────────────────────────────────────────────
      { id: "lake",     label: "Data Lake",      initials: "LK", role: "tool"     },
      { id: "wh",       label: "Data Warehouse", initials: "WH", role: "tool"     }, // hub
      { id: "featstore",label: "Feature Store",  initials: "FS", role: "tool"     },
      { id: "cache",    label: "Redis Cache",    initials: "RC", role: "tool"     },
      // ── Consumers ────────────────────────────────────────────────────
      { id: "bi",       label: "BI Team",        initials: "BI", role: "person"   },
      { id: "ds",       label: "Data Science",   initials: "DS", role: "person"   },
      { id: "product",  label: "Product Team",   initials: "PR", role: "person"   },
      { id: "exec",     label: "Exec Dashboard", initials: "EX", role: "output"   },
      { id: "mlserve",  label: "ML Serving",     initials: "MS", role: "tool"     },
      // ── Governance ───────────────────────────────────────────────────
      { id: "catalog",  label: "Data Catalog",   initials: "DC", role: "tool"     },
    ],
    edges: [
      // Sources → Ingestion
      { source: "crm",     target: "kafka",     sequence: 1 },
      { source: "erp",     target: "batch",     sequence: 1 },
      { source: "iot",     target: "kafka",     sequence: 1 },
      { source: "web",     target: "kafka",     sequence: 1 },
      { source: "partner", target: "apigw",     sequence: 1 },
      // Ingestion → Processing
      { source: "kafka",   target: "spark",     sequence: 2 },
      { source: "kafka",   target: "mlpipe",    sequence: 2 },
      { source: "batch",   target: "spark",     sequence: 2 },
      { source: "apigw",   target: "spark",     sequence: 2 },
      { source: "apigw",   target: "dbt",       sequence: 2 },
      // Processing → Storage
      { source: "spark",   target: "lake",      sequence: 3 },
      { source: "spark",   target: "dq",        sequence: 3 },
      { source: "lake",    target: "dbt",       sequence: 3 },
      { source: "lake",    target: "catalog",   sequence: 3 },
      { source: "dbt",     target: "wh",        sequence: 4 },
      { source: "dbt",     target: "featstore", sequence: 4 },
      { source: "dq",      target: "wh",        sequence: 4 },
      { source: "mlpipe",  target: "featstore", sequence: 4 },
      // Warehouse → Consumers  (wh degree = 9 → 4-arc bundle)
      { source: "wh",      target: "bi",        sequence: 5 },
      { source: "wh",      target: "ds",        sequence: 5 },
      { source: "wh",      target: "product",   sequence: 5 },
      { source: "wh",      target: "exec",      sequence: 5 },
      { source: "wh",      target: "cache",     sequence: 5 },
      // Feature serving
      { source: "featstore",target: "mlserve",  sequence: 5 },
      { source: "cache",   target: "mlserve",   sequence: 5 },
      { source: "mlserve", target: "product",   sequence: 6 },
      { source: "mlserve", target: "ds",        sequence: 6 },
      // Governance
      { source: "catalog", target: "wh",        sequence: 4 },
    ],
  },
];

// ── buildTemplateState ────────────────────────────────────────────────────────
//
// Runs both layout algorithms on the template's node/edge list and returns
// the full payload for PUT /api/graph-state { action: "importState" }.

export interface TemplateState {
  customNodes:        ReturnType<typeof makeCustomNodes>;
  customEdges:        ReturnType<typeof makeCustomEdges>;
  baselinePositions:  Record<string, { x: number; y: number }>;
  ecosystemPositions: Record<string, { x: number; y: number }>;
  settings?:          { hiddenCoreNodes?: string[] };
}

function makeCustomNodes(nodes: TplNode[], basePos: Record<string, { x: number; y: number }>) {
  return nodes.map((n) => ({
    id:            n.id,
    labelInitials: n.initials,
    label:         n.label,
    nodeType:      "neural" as const,
    role:          n.role as "person" | "tool" | "external" | "output",
    textColor:     n.textColor ?? ROLE_COLOR[n.role],
    position:      basePos[n.id] ?? { x: 100, y: 100 },
  }));
}

function makeCustomEdges(edges: TplEdge[]) {
  return edges.map((e, i) => ({
    id:       `${e.source}-${e.target}`,
    source:   e.source,
    target:   e.target,
    sequence: e.sequence ?? 1,
    weight:   e.weight   ?? 1,
    isCustom: true as const,
  }));
}

/** Canvas dimensions used for layout computation. */
const CANVAS_W = 900;
const CANVAS_H = 560;

export function buildTemplateState(template: Template): TemplateState {
  if (template.useBuiltins || template.nodes.length === 0) {
    // Ridgeview / Blank: restore core nodes, no custom content
    return {
      customNodes:        [],
      customEdges:        [],
      baselinePositions:  {},
      ecosystemPositions: {},
      settings:           { hiddenCoreNodes: [] },
    };
  }

  const layoutNodes = template.nodes.map((n) => ({ id: n.id }));
  const layoutEdges = template.edges.map((e) => ({ source: e.source, target: e.target }));

  const baselinePositions  = hierarchicalLayout(layoutNodes, layoutEdges, CANVAS_W, CANVAS_H);
  const ecosystemPositions = radialWebLayout   (layoutNodes, layoutEdges, CANVAS_W, CANVAS_H);

  const customNodes = makeCustomNodes(template.nodes, baselinePositions);
  const customEdges = makeCustomEdges(template.edges);

  return {
    customNodes,
    customEdges,
    baselinePositions,
    ecosystemPositions,
    // Hide the built-in Ridgeview core nodes so only template nodes show
    settings: {
      hiddenCoreNodes: ["nav", "script", "db", "xy", "mary", "ed", "cy"],
    },
  };
}
