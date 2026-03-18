"use client";
import {
  forwardRef, useCallback, useEffect, useImperativeHandle,
  useMemo, useRef, useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GraphCanvasRef {
  exportCsv: () => void;
  exportPng: () => void;
  importCsv: (text: string) => void;
}

export interface GraphCanvasProps {
  isEcosystem:      boolean;
  showImprovements: boolean;
  selectedId:       string | null;
  selectedType:     "node" | "edge" | null;
  onSelectNode:     (id: string, type: "node" | "edge") => void;
  onDeselect:       () => void;
  onHover:          (name: string, summary: string) => void;
  onHoverEnd:       () => void;
  onDeleteNode:     (id: string) => void;
}

interface CanvasNode {
  id: string;  x: number;  y: number;
  z?: number;  // simulated depth: -1.0 (back) to +1.0 (front)
  initials: string;  label: string;
  subcategory?: string;  isHub?: boolean;
  bottleneck?: boolean;  bottleneckText?: string;
  isDeprecated?: boolean;  isUpgraded?: boolean;
  borderColor: string;  textColor: string;
  isEco: boolean;
  labelBg: string;  labelBorderColor: string;  labelTextColor?: string;
  isCustom?: boolean;
}
interface CanvasEdge {
  id: string;  source: string;  target: string;
  isDeprecated?: boolean;  isUpgraded?: boolean;
  isCustom?: boolean;
  sequence?: number;
  weight?: number;
}
interface DragState { nodeId: string; offsetX: number; offsetY: number; hasMoved: boolean; }
type CtxMenu =
  | { type: "canvas"; x: number; y: number; cx: number; cy: number }
  | { type: "node";   x: number; y: number; nodeId: string };
interface AddForm { cx: number; cy: number; label: string; initials: string; role: "person" | "tool" | "external" | "output"; }
interface WorkflowApiState {
  baselinePositions:  Record<string, { x: number; y: number; z?: number }>;
  ecosystemPositions: Record<string, { x: number; y: number; z?: number }>;
  customNodes: Array<{ id: string; labelInitials: string; label: string; nodeType: "neural"|"eco"; role?: string; textColor?: string; position: { x: number; y: number; z?: number }; outputDelay?: number }>;
  customEdges: Array<{ id: string; source: string; target: string; sequence?: number; weight?: number; isCustom?: boolean; isImprovementOnly?: boolean }>;
  settings: {
    nodePause: number;
    edgeWeightOverrides: Record<string, { sequence?: number; weight?: number }>;
    nodeDelayOverrides: Record<string, number>;
  };
  lastUpdated: number;
  _positionsHash?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SZ = 56;  // node box size
const R  = SZ / 2; // radius / half-size
const ECO_NODE_SZ = 44; // smaller nodes in ecosystem/web-map view (kept for reference)
const SPHERE_SZ = 20; // diameter of 3D neon sphere in ecosystem view
function nodeRadius(isEco: boolean): number {
  return isEco ? SPHERE_SZ / 2 : R;
}

// Neon color per ecosystem node — maps to sphere gradient theme
const ECO_NEON: Record<string, string> = {
  xy:   "#00BCD4",  // cyan  hub
  nav:  "#E91E8C",  // magenta  external
  mary: "#C084FC",  // violet  collaborator
  ed:   "#F59E0B",  // amber   bottleneck (unchanged)
};
function ecoNodeNeon(id: string, isCustom?: boolean): string {
  return ECO_NEON[id] || (isCustom ? "#10B981" : "#0EA5E9");
}

// Neon radial-gradient sphere — MiroFish 3D Signal Theme
function sphereGradient(nodeId: string, isBottleneck?: boolean, isDeprecated?: boolean): string {
  if (isDeprecated) return "radial-gradient(circle at 30% 30%, #f1f5f9 0%, #cbd5e1 55%, #94a3b8 100%)";
  if (isBottleneck) return "radial-gradient(circle at 30% 30%, #fef08a 0%, #f59e0b 55%, #78350f 100%)";
  if (nodeId === "xy"   || nodeId === "XY") return "radial-gradient(circle at 30% 30%, #e0ffff 0%, #00bcd4 55%, #006064 100%)";
  if (nodeId === "nav"  || nodeId === "NB") return "radial-gradient(circle at 30% 30%, #fce4ec 0%, #e91e8c 55%, #4a0033 100%)";
  if (nodeId === "mary" || nodeId === "MM") return "radial-gradient(circle at 30% 30%, #f3e8ff 0%, #c084fc 55%, #4a0072 100%)";
  if (nodeId === "ed"   || nodeId === "EC") return "radial-gradient(circle at 30% 30%, #fef08a 0%, #f59e0b 55%, #78350f 100%)";
  // Custom nodes — emerald
  return "radial-gradient(circle at 30% 30%, #e0ffe0 0%, #00ff88 55%, #004422 100%)";
}

// Neon glow box-shadow per node
function sphereGlow(nodeId: string, isBottleneck?: boolean, isDeprecated?: boolean, depthScale = 1): string {
  if (isDeprecated) return "none";
  if (isBottleneck) return `0 0 10px rgba(245,158,11,0.6), 0 0 24px rgba(245,158,11,0.3), inset 0 1px 2px rgba(255,255,255,0.5)`;
  const glowMap: Record<string, string> = {
    xy:   "0 0 10px rgba(0,188,212,0.7), 0 0 24px rgba(0,188,212,0.3), inset 0 1px 2px rgba(255,255,255,0.6)",
    nav:  "0 0 10px rgba(233,30,140,0.7), 0 0 24px rgba(233,30,140,0.3), inset 0 1px 2px rgba(255,255,255,0.6)",
    mary: "0 0 10px rgba(192,132,252,0.7), 0 0 24px rgba(192,132,252,0.3), inset 0 1px 2px rgba(255,255,255,0.6)",
  };
  return glowMap[nodeId] || `0 ${Math.round(depthScale * 3)}px ${Math.round(depthScale * 8)}px rgba(0,0,0,0.2), inset 0 1px 2px rgba(255,255,255,0.5)`;
}

// Satellite mini-spheres around each main eco node (MiroFish dense cluster effect)
function getSatellites(cx: number, cy: number, id: string, count = 10): Array<{x: number; y: number; r: number; opacity: number}> {
  const out: Array<{x: number; y: number; r: number; opacity: number}> = [];
  let h = 5381;
  for (const c of id) h = ((h << 5) + h) ^ c.charCodeAt(0);
  for (let i = 0; i < count; i++) {
    const s1 = Math.abs((h * (i * 7 + 13)) | 0);
    const s2 = Math.abs((h * (i * 11 + 5)) | 0);
    const s3 = Math.abs((h * (i * 3 + 17)) | 0);
    const radius = 16 + (s1 % 42);
    const angle  = (s2 % 628) / 100;
    const dotR   = 1.2 + (s3 % 3) * 0.5;
    out.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), r: dotR, opacity: 0.35 + (s3 % 45) / 100 });
  }
  return out;
}

// Default border/text per node ID (baseline view)
const BASE_STYLE: Record<string, { border: string; text: string }> = {
  nav:    { border: "#CBD5E1", text: "#475569" },
  script: { border: "#E2E8F0", text: "#64748B" },
  db:     { border: "#E2E8F0", text: "#64748B" },
  xy:     { border: "#4F46E5", text: "#4F46E5" },
  mary:   { border: "#CBD5E1", text: "#475569" },
  ed:     { border: "#F59E0B", text: "#F59E0B" },
  cy:     { border: "#CBD5E1", text: "#475569" },
};
const BASE_LABELS: Record<string, { initials: string; label: string }> = {
  nav:    { initials: "NB",  label: "NAV Back Office" },
  script: { initials: "</>", label: "Parsing Script" },
  db:     { initials: "DB",  label: "Database" },
  xy:     { initials: "XY",  label: "Xingye" },
  mary:   { initials: "MM",  label: "Mary" },
  ed:     { initials: "EC",  label: "Edward" },
  cy:     { initials: "RV",  label: "Ridgeview Dashboard" },
};
const ECO_SUB: Record<string, string> = { nav: "External", xy: "Hub", mary: "Collaborator", ed: "Manager" };
const ROLE_COLOR: Record<string, string> = { person: "#4F46E5", tool: "#64748B", external: "#475569", output: "#10B981" };
const CORE_IDS = new Set(["nav","script","db","xy","mary","ed","cy"]);

// Workflow node metadata (for tooltip / analysis panel)
const NODE_META: Record<string, { name: string; summary: string }> = {
  nav:    { name: "NAV Back Office",     summary: "Provides initial raw data for the fund." },
  script: { name: "Parsing Script",      summary: "Parses raw NAV data into standardized formats." },
  db:     { name: "Database",            summary: "Stores historical records and references." },
  xy:     { name: "Xingye",              summary: "Compiles inputs and routes data for approval." },
  mary:   { name: "Mary",                summary: "Provides initial review and approval." },
  ed:     { name: "Edward",              summary: "Final manual review queue holding up the pipeline." },
  cy:     { name: "Ridgeview Dashboard", summary: "Final generated report for the fund." },
};
const EDGE_META: Record<string, { name: string; summary: string }> = {
  "nav-xy":    { name: "Data Ingestion",       summary: "Raw NAV data transferred to Xingye." },
  "xy-script": { name: "Parsing Request",      summary: "Xingye sends raw data to script for parsing." },
  "script-xy": { name: "Script Execution",     summary: "Script parses raw data into usable formats." },
  "db-xy":     { name: "Historical Query",     summary: "Pulls past records to match with new NAV." },
  "xy-mary":   { name: "Draft Submission",     summary: "Xingye submits compiled report to Mary." },
  "mary-ed":   { name: "Escalation",           summary: "Mary forwards to Edward for final sign-off." },
  "ed-cy":     { name: "Publishing",           summary: "Edward approves and generates the dashboard." },
  "mary-cy":   { name: "Automated Publishing", summary: "Direct publish to dashboard, bypassing Edward." },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hashDelay(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 100;
  return (h / 100) * 2;
}

// Deterministic per-edge jitter so parallel edges fan out organically
function ecoJitter(id: string): number {
  let h = 5381;
  for (const c of id) h = ((h << 5) + h) ^ c.charCodeAt(0);
  return ((h >>> 0) % 1000) / 1000 - 0.5; // -0.5 … +0.5
}

function buildBaselineNodes(
  pos: Record<string, { x: number; y: number; z?: number }>,
  customNodes: WorkflowApiState["customNodes"],
  showImprovements: boolean,
): CanvasNode[] {
  const ids = ["nav","script","db","xy","mary","ed","cy"];
  const out: CanvasNode[] = ids.map((id) => {
    const p = pos[id] || { x: 100, y: 100 };
    const z = p.z; // may be undefined for baseline — that's fine, baseline uses no depth effects
    const s = BASE_STYLE[id];
    const isBottleneck = id === "ed";
    const isDep  = isBottleneck && showImprovements;
    const isUpgr = id === "cy"  && showImprovements;
    const border = isDep ? "#E2E8F0" : isUpgr ? "#10B981" : s.border;
    const text   = isDep ? "#94A3B8" : isUpgr ? "#10B981" : s.text;
    return {
      id, x: p.x, y: p.y, z,
      initials: BASE_LABELS[id].initials,
      label:    BASE_LABELS[id].label,
      bottleneck: isBottleneck, bottleneckText: isBottleneck ? "Queue: 2.3 Days" : undefined,
      isDeprecated: isDep, isUpgraded: isUpgr,
      borderColor: border, textColor: text,
      isEco: false,
      labelBg: "rgba(255,255,255,0.95)", labelBorderColor: isDep ? "#F1F5F9" : "#E2E8F0",
      labelTextColor: isDep ? "#94A3B8" : "#334155",
    };
  });
  customNodes.forEach((cn) => {
    const p = pos[cn.id] || cn.position;
    const clr = cn.textColor || ROLE_COLOR[cn.role || ""] || "#4F46E5";
    out.push({ id: cn.id, x: p.x, y: p.y, z: p.z, initials: cn.labelInitials, label: cn.label,
      borderColor: clr, textColor: clr, isEco: false,
      labelBg: "rgba(255,255,255,0.95)", labelBorderColor: "#E2E8F0", isCustom: true });
  });
  return out;
}

function buildEcosystemNodes(
  pos: Record<string, { x: number; y: number; z?: number }>,
  customNodes: WorkflowApiState["customNodes"],
  showImprovements: boolean,
): CanvasNode[] {
  const ids = ["nav","xy","mary","ed"];
  const out: CanvasNode[] = ids.map((id) => {
    const p = pos[id] || { x: 100, y: 100 };
    const z = p.z;
    const isBottleneck = id === "ed";
    const isDep = isBottleneck && showImprovements;
    const neon = ecoNodeNeon(id);
    const border = isDep ? "#E2E8F0" : neon;
    const text   = isDep ? "#94A3B8" : neon;
    return {
      id, x: p.x, y: p.y, z,
      initials: BASE_LABELS[id].initials, label: BASE_LABELS[id].label,
      subcategory: ECO_SUB[id], isHub: id === "xy",
      bottleneck: isBottleneck, bottleneckText: isBottleneck ? "Queue: 2.3 Days" : undefined,
      isDeprecated: isDep,
      borderColor: border, textColor: text,
      isEco: true,
      labelBg: isDep ? "#fff" : "rgba(255,255,255,0.92)",
      labelBorderColor: isDep ? "#F1F5F9" : neon + "55",
      labelTextColor: isDep ? "#94A3B8" : "#1e293b",
    };
  });
  customNodes.forEach((cn) => {
    const p = pos[cn.id] || cn.position;
    const clr = cn.textColor || "#0EA5E9";
    out.push({ id: cn.id, x: p.x, y: p.y, z: p.z, initials: cn.labelInitials, label: cn.label,
      borderColor: clr, textColor: clr, isEco: true,
      labelBg: "#F0F9FF", labelBorderColor: "#BAE6FD", isCustom: true });
  });
  return out;
}

function buildEdges(isEcosystem: boolean, showImprovements: boolean, customEdges: WorkflowApiState["customEdges"]): CanvasEdge[] {
  const base: CanvasEdge[] = isEcosystem
    ? [
        // Ecosystem: NAV feeds Xingye, Xingye compiles, passes to Mary, Mary escalates to Ed (deprecated on improvements)
        { id: "nav-xy",  source: "nav",  target: "xy",   sequence: 1, weight: 1 },
        { id: "xy-mary", source: "xy",   target: "mary", sequence: 2, weight: 2 },   // Xingye compiles (takes time)
        { id: "mary-ed", source: "mary", target: "ed",   sequence: 3, weight: 1.5, isDeprecated: showImprovements },
      ]
    : [
        { id: "nav-xy",    source: "nav",    target: "xy", sequence: 1, weight: 1 },
        { id: "xy-script", source: "xy",     target: "script", sequence: 2, weight: 1 },
        { id: "script-xy", source: "script", target: "xy", sequence: 3, weight: 1 },
        { id: "db-xy",     source: "db",     target: "xy", sequence: 3, weight: 1 },
        { id: "xy-mary",   source: "xy",     target: "mary", sequence: 4, weight: 1 },
        // Baseline: Mary -> Edward (slow bottleneck) -> Dashboard
        { id: "mary-ed",   source: "mary",   target: "ed",   sequence: 5, weight: 1.5, isDeprecated: showImprovements },
        { id: "ed-cy",     source: "ed",     target: "cy",   sequence: 6, weight: 6,   isDeprecated: showImprovements },
        // Improvements: Mary -> Dashboard directly (faster, weight 1.2 = slight processing)
        ...(showImprovements ? [{ id: "mary-cy", source: "mary", target: "cy", sequence: 5, weight: 1.2, isUpgraded: true }] : []),
      ];

  const existing = new Set(base.map((e) => e.id));
  customEdges.forEach((ce) => {
    if (!existing.has(ce.id)) {
      // isImprovementOnly: edge only visible when improvements are ON
      const isOnlyWhenImproved = !!ce.isImprovementOnly;
      base.push({
        id: ce.id, source: ce.source, target: ce.target,
        sequence: ce.sequence || 1, weight: ce.weight || 1,
        isDeprecated: isOnlyWhenImproved ? !showImprovements : false,
        isUpgraded: isOnlyWhenImproved,
        isCustom: true,
      });
    }
  });
  return base;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function csvCell(v: string | number): string {
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(...cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}
function parseCsvRow(line: string): string[] {
  const out: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i+1] === '"') { f += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(f); f = ""; }
    else f += c;
  }
  out.push(f);
  return out;
}

function buildCsvExport(
  baselineNodes: CanvasNode[],
  ecosystemNodes: CanvasNode[],
  customNodes: WorkflowApiState["customNodes"],
  customEdges: WorkflowApiState["customEdges"],
  settings: WorkflowApiState["settings"],
  edgesWithParams: CanvasEdge[], // live edges including built-in ones
): string {
  const lines: string[] = [];
  lines.push("# Ridgeview Workflow Export");
  lines.push(`# Date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("# Version: 2.0");
  lines.push("");

  // ── PROCESS_MAP tab ─────────────────────────────────────────────
  lines.push("[PROCESS_MAP]");
  lines.push("id,initials,label,x,y");
  baselineNodes.forEach((n) => lines.push(csvRow(n.id, n.initials, n.label, Math.round(n.x), Math.round(n.y))));
  lines.push("");

  // ── ECOSYSTEM tab ────────────────────────────────────────────────
  lines.push("[ECOSYSTEM]");
  lines.push("id,initials,label,x,y");
  ecosystemNodes.forEach((n) => lines.push(csvRow(n.id, n.initials, n.label, Math.round(n.x), Math.round(n.y))));
  lines.push("");

  // ── CUSTOM_NODES tab ─────────────────────────────────────────────
  lines.push("[CUSTOM_NODES]");
  lines.push("id,initials,label,nodeType,role,textColor,outputDelay,baseline_x,baseline_y,ecosystem_x,ecosystem_y");
  customNodes.forEach((cn) => {
    const bPos = baselineNodes.find((n) => n.id === cn.id);
    const ePos = ecosystemNodes.find((n) => n.id === cn.id);
    lines.push(csvRow(
      cn.id, cn.labelInitials, cn.label, cn.nodeType, cn.role || "", cn.textColor || "",
      cn.outputDelay ?? 1,
      bPos ? Math.round(bPos.x) : Math.round(cn.position.x),
      bPos ? Math.round(bPos.y) : Math.round(cn.position.y),
      ePos ? Math.round(ePos.x) : Math.round(cn.position.x),
      ePos ? Math.round(ePos.y) : Math.round(cn.position.y),
    ));
  });
  lines.push("");

  // ── RELATIONS tab (all edges including built-ins) ─────────────────
  lines.push("[RELATIONS]");
  lines.push("id,source,target,sequence,weight,source_type");
  edgesWithParams.forEach((e) => {
    const isCustomEdge = customEdges.some(ce => ce.id === e.id);
    lines.push(csvRow(
      e.id, e.source, e.target,
      e.sequence ?? 1,
      e.weight ?? 1,
      isCustomEdge ? "custom" : "builtin",
    ));
  });
  lines.push("");

  // ── SETTINGS tab ─────────────────────────────────────────────────
  lines.push("[SETTINGS]");
  lines.push("key,value");
  lines.push(csvRow("nodePause", settings.nodePause));
  // Per-node output delays
  Object.entries(settings.nodeDelayOverrides || {}).forEach(([id, v]) => {
    lines.push(csvRow(`nodeDelay.${id}`, v));
  });
  // Per-edge weight overrides (for built-in edges that have user-set values)
  Object.entries(settings.edgeWeightOverrides || {}).forEach(([id, v]) => {
    if (v.weight !== undefined)   lines.push(csvRow(`edgeWeight.${id}`, v.weight));
    if (v.sequence !== undefined) lines.push(csvRow(`edgeSeq.${id}`, v.sequence));
  });

  return lines.join("\n");
}

function parseCsvImport(text: string): {
  baselinePositions: Record<string, { x: number; y: number }>;
  ecosystemPositions: Record<string, { x: number; y: number }>;
  customNodes: WorkflowApiState["customNodes"];
  customEdges: WorkflowApiState["customEdges"];
  settings: Partial<WorkflowApiState["settings"]>;
} {
  const baselinePositions: Record<string, { x: number; y: number }> = {};
  const ecosystemPositions: Record<string, { x: number; y: number }> = {};
  const customNodes: WorkflowApiState["customNodes"] = [];
  const customEdges: WorkflowApiState["customEdges"] = [];
  const settings: WorkflowApiState["settings"] = { nodePause: 1, edgeWeightOverrides: {}, nodeDelayOverrides: {} };
  const relationOverrides: Record<string, { sequence: number; weight: number }> = {};

  let section = "";
  let headers: string[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      headers = [];
      continue;
    }
    const cells = parseCsvRow(line);
    if (headers.length === 0) { headers = cells; continue; }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] || ""));

    if (section === "PROCESS_MAP" && row.id)
      baselinePositions[row.id] = { x: parseFloat(row.x) || 0, y: parseFloat(row.y) || 0 };
    else if (section === "ECOSYSTEM" && row.id)
      ecosystemPositions[row.id] = { x: parseFloat(row.x) || 0, y: parseFloat(row.y) || 0 };
    else if (section === "CUSTOM_NODES" && row.id) {
      baselinePositions[row.id]  = { x: parseFloat(row.baseline_x) || 0, y: parseFloat(row.baseline_y) || 0 };
      ecosystemPositions[row.id] = { x: parseFloat(row.ecosystem_x) || 0, y: parseFloat(row.ecosystem_y) || 0 };
      customNodes.push({
        id: row.id, labelInitials: row.initials, label: row.label,
        nodeType: (row.nodeType as "neural"|"eco") || "neural",
        role: (row.role as WorkflowApiState["customNodes"][0]["role"]) || undefined,
        textColor: row.textColor || undefined,
        outputDelay: parseFloat(row.outputDelay) || undefined,
        position: { x: parseFloat(row.baseline_x) || 0, y: parseFloat(row.baseline_y) || 0 },
      });
    }
    // RELATIONS section handles both custom and builtin edges
    else if (section === "RELATIONS" && row.id) {
      const seq = parseInt(row.sequence) || 1;
      const w   = parseFloat(row.weight) || 1;
      if (row.source_type === "custom") {
        customEdges.push({ id: row.id, source: row.source, target: row.target, sequence: seq, weight: w, isCustom: true });
      } else {
        // Builtin edge — store as weight override
        settings.edgeWeightOverrides[row.id] = { sequence: seq, weight: w };
        relationOverrides[row.id] = { sequence: seq, weight: w };
      }
    }
    // Legacy CUSTOM_EDGES section (v1.0 compatibility)
    else if (section === "CUSTOM_EDGES" && row.id)
      customEdges.push({ id: row.id, source: row.source, target: row.target, sequence: parseInt(row.sequence) || 1, weight: parseFloat(row.weight) || 1, isCustom: true });
    else if (section === "SETTINGS" && row.key) {
      const val = parseFloat(row.value);
      if (row.key === "nodePause") settings.nodePause = val;
      else if (row.key.startsWith("nodeDelay.")) {
        const nodeId = row.key.replace("nodeDelay.", "");
        settings.nodeDelayOverrides[nodeId] = val;
      } else if (row.key.startsWith("edgeWeight.")) {
        const edgeId = row.key.replace("edgeWeight.", "");
        if (!settings.edgeWeightOverrides[edgeId]) settings.edgeWeightOverrides[edgeId] = {};
        settings.edgeWeightOverrides[edgeId].weight = val;
      } else if (row.key.startsWith("edgeSeq.")) {
        const edgeId = row.key.replace("edgeSeq.", "");
        if (!settings.edgeWeightOverrides[edgeId]) settings.edgeWeightOverrides[edgeId] = {};
        settings.edgeWeightOverrides[edgeId].sequence = Math.round(val);
      }
    }
  }
  return { baselinePositions, ecosystemPositions, customNodes, customEdges, settings };
}

// ─── PNG export ───────────────────────────────────────────────────────────────
function buildSvgExport(nodes: CanvasNode[], edges: CanvasEdge[], isEcosystem: boolean): string {
  const W = 1200, H = 700;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#F8FAFC;font-family:Inter,sans-serif;">`,
    `<defs><pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse">`,
    `<circle cx="1" cy="1" r="1" fill="#CBD5E1"/></pattern></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>`,
  ];
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  edges.forEach((e) => {
    const s = nodeMap[e.source], t = nodeMap[e.target];
    if (!s || !t) return;
    const stroke = e.isUpgraded ? "#10B981" : isEcosystem ? "#7DD3FC" : "#CBD5E1";
    parts.push(`<line x1="${s.x+R}" y1="${s.y+R}" x2="${t.x+R}" y2="${t.y+R}" stroke="${stroke}" stroke-width="${isEcosystem?3:2}" opacity="${e.isDeprecated?0.15:1}"/>`);
  });
  nodes.forEach((n) => {
    const op = n.isDeprecated ? 0.3 : 1;
    const bc = n.borderColor, tc = n.textColor;
    if (n.isEco) parts.push(`<rect x="${n.x}" y="${n.y}" width="56" height="56" rx="14" fill="white" stroke="${bc}" stroke-width="2" opacity="${op}"/>`);
    else         parts.push(`<circle cx="${n.x+R}" cy="${n.y+R}" r="${R}" fill="white" stroke="${bc}" stroke-width="2" opacity="${op}"/>`);
    parts.push(`<text x="${n.x+R}" y="${n.y+R+5}" text-anchor="middle" font-size="13" font-weight="700" fill="${tc}" opacity="${op}">${n.initials}</text>`);
    parts.push(`<text x="${n.x+R}" y="${n.y+72}" text-anchor="middle" font-size="10" fill="#334155">${n.label}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}
function downloadSvgAsPng(svg: string) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new window.Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 700;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#F8FAFC"; ctx.fillRect(0,0,1200,700); ctx.drawImage(img,0,0);
    URL.revokeObjectURL(url);
    const a = document.createElement("a"); a.href = c.toDataURL("image/png");
    a.download = "workflow-graph.png"; a.click();
  };
  img.src = url;
}
function downloadBlob(content: string, filename: string, mime: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename; a.click();
}

// ─── Main Component ───────────────────────────────────────────────────────────
export const GraphCanvas = forwardRef<GraphCanvasRef, GraphCanvasProps>(
  function GraphCanvas({
    isEcosystem, showImprovements, selectedId, selectedType,
    onSelectNode, onDeselect, onHover, onHoverEnd, onDeleteNode,
  }, ref) {
    const canvasRef = useRef<HTMLDivElement>(null);

    // Server state
    const [serverState, setServerState] = useState<WorkflowApiState | null>(null);
    const lastPollTs = useRef(0);

    // Derived node / edge arrays
    const [baselineNodes, setBaselineNodes] = useState<CanvasNode[]>([]);
    const [ecosystemNodes, setEcosystemNodes] = useState<CanvasNode[]>([]);

    const nodes = useMemo(
      () => (isEcosystem ? ecosystemNodes : baselineNodes),
      [isEcosystem, baselineNodes, ecosystemNodes]
    );
    const edges = useMemo(
      () => buildEdges(isEcosystem, showImprovements, serverState?.customEdges || []),
      [isEcosystem, showImprovements, serverState?.customEdges]
    );
    const nodeMap = useMemo(
      () => Object.fromEntries(nodes.map((n) => [n.id, n])),
      [nodes]
    );

    // Rebuild nodes when server state or options change
    useEffect(() => {
      if (!serverState) return;
      setBaselineNodes(buildBaselineNodes(serverState.baselinePositions, serverState.customNodes, showImprovements));
      setEcosystemNodes(buildEcosystemNodes(serverState.ecosystemPositions, serverState.customNodes, showImprovements));
    }, [serverState, showImprovements]);

    // Initial fetch
    useEffect(() => {
      fetch("/api/workflow").then((r) => r.json()).then((d) => {
        setServerState({ ...d, baselinePositions: d.layout.baselinePositions, ecosystemPositions: d.layout.ecosystemPositions });
        lastPollTs.current = d.lastUpdated;
      }).catch(console.error);
    }, []);

    // Poll every 3 s
    useEffect(() => {
      const t = setInterval(() => {
        fetch("/api/graph-state").then((r) => r.json()).then((s: WorkflowApiState & { _positionsHash?: string }) => {
          if (s.lastUpdated > lastPollTs.current) {
            lastPollTs.current = s.lastUpdated;
            setServerState((prev) => {
              // Skip re-render if positions hash hasn't changed (only metadata/settings updated)
              if (prev && s._positionsHash && (prev as typeof prev & { _positionsHash?: string })._positionsHash === s._positionsHash) {
                // Only update settings/customEdges/customNodes, not positions
                return { ...prev, settings: s.settings, customNodes: s.customNodes, customEdges: s.customEdges, lastUpdated: s.lastUpdated, _positionsHash: s._positionsHash } as WorkflowApiState;
              }
              return prev ? { ...prev, ...s } : s;
            });
          }
        }).catch(console.error);
      }, 3000);
      return () => clearInterval(t);
    }, []);

    // ── Drag ──────────────────────────────────────────────────────────────────
    const dragRef = useRef<DragState | null>(null);

    const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
    const [addForm, setAddForm] = useState<AddForm | null>(null);
    const [connectFrom, setConnectFrom] = useState<string | null>(null);
    const [mousePos, setMousePos]       = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const rect = canvasRef.current!.getBoundingClientRect();
      const node = (isEcosystem ? ecosystemNodes : baselineNodes).find((n) => n.id === nodeId)!;
      dragRef.current = { nodeId, offsetX: e.clientX - rect.left - node.x, offsetY: e.clientY - rect.top - node.y, hasMoved: false };
    }, [isEcosystem, baselineNodes, ecosystemNodes]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      if (connectFrom) {
        setMousePos({ x: mx, y: my });
      }

      const d = dragRef.current;
      if (!d) return;
      const newX = mx - d.offsetX;
      const newY = my - d.offsetY;
      d.hasMoved = true;
      const updater = (ns: CanvasNode[]) => ns.map((n) => n.id === d.nodeId ? { ...n, x: newX, y: newY } : n);
      if (isEcosystem) setEcosystemNodes(updater); else setBaselineNodes(updater);
    }, [isEcosystem, connectFrom]);

    const handleMouseUp = useCallback(() => {
      const d = dragRef.current;
      if (!d) return;
      if (d.hasMoved) {
        const node = (isEcosystem ? ecosystemNodes : baselineNodes).find((n) => n.id === d.nodeId);
        if (node) {
          const view = isEcosystem ? "ecosystem" : "baseline";
          fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "updatePosition", view, nodeId: node.id, position: { x: node.x, y: node.y } }),
          }).catch(console.error);
        }
      }
      dragRef.current = null;
    }, [isEcosystem, baselineNodes, ecosystemNodes]);

    // ── Context menu / Add Node ───────────────────────────────────────────────

    const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-nodeid]")) return;
      e.preventDefault();
      const rect = canvasRef.current!.getBoundingClientRect();
      setCtxMenu({ type: "canvas", x: e.clientX, y: e.clientY, cx: e.clientX - rect.left, cy: e.clientY - rect.top });
    }, []);

    const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
      e.preventDefault(); e.stopPropagation();
      setCtxMenu({ type: "node", x: e.clientX, y: e.clientY, nodeId });
    }, []);

    const handleAddNodeSubmit = () => {
      if (!addForm || !addForm.label || !addForm.initials) return;
      const id = `custom-${Date.now()}`;
      const clr = ROLE_COLOR[addForm.role] || "#4F46E5";
      const newCn: WorkflowApiState["customNodes"][0] = {
        id, labelInitials: addForm.initials.toUpperCase().slice(0,3), label: addForm.label,
        nodeType: "neural", role: addForm.role as WorkflowApiState["customNodes"][0]["role"],
        textColor: clr, position: { x: addForm.cx - R, y: addForm.cy - R },
      };
      setServerState((prev) => prev ? { ...prev, customNodes: [...prev.customNodes, newCn], lastUpdated: Date.now() } : prev);
      fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addNode", node: newCn }),
      }).catch(console.error);
      setAddForm(null);
    };

    // ── Connect mode ──────────────────────────────────────────────────────────
    const handleNodeClick = useCallback((e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      if (dragRef.current?.hasMoved) return;
      setCtxMenu(null);

      if (connectFrom) {
        if (connectFrom !== nodeId) {
          const edgeId = `${connectFrom}-${nodeId}`;
          const nextSeq = edges.length > 0 ? Math.max(...edges.map(e => e.sequence || 1)) + 1 : 1;
          const isOpt = window.confirm(
            'Mark this connection as "Optimized Route" (Improvements Only)?\n\nOK = only shown when Improvements mode is ON\nCancel = always shown (standard connection)'
          );
          const newEdge = {
            id: edgeId, source: connectFrom, target: nodeId,
            sequence: nextSeq, isCustom: true,
            isImprovementOnly: isOpt,
            weight: 1,
          };
          setServerState((prev) => prev ? { ...prev, customEdges: [...prev.customEdges.filter(e2 => e2.id !== edgeId), newEdge], lastUpdated: Date.now() } : prev);
          fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "addEdge", edge: newEdge }),
          }).catch(console.error);
        }
        setConnectFrom(null);
        return;
      }
      onSelectNode(nodeId, "node");
    }, [connectFrom, onSelectNode]);

    const handleEdgeClick = useCallback((edgeId: string) => {
      if (dragRef.current?.hasMoved) return;
      setCtxMenu(null); setConnectFrom(null);
      onSelectNode(edgeId, "edge");
    }, [onSelectNode]);

    const handlePaneClick = useCallback(() => {
      if (dragRef.current?.hasMoved) return;
      setCtxMenu(null); setConnectFrom(null); onDeselect();
    }, [onDeselect]);

    // ── Delete key ────────────────────────────────────────────────────────────
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Delete" && e.key !== "Backspace") return;
        if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
        if (!selectedId) return;
        if (selectedType === "node" && !CORE_IDS.has(selectedId)) {
          onDeleteNode(selectedId);
          setServerState((prev) => prev ? {
            ...prev,
            customNodes: prev.customNodes.filter(n => n.id !== selectedId),
            customEdges: prev.customEdges.filter(e2 => e2.source !== selectedId && e2.target !== selectedId),
            lastUpdated: Date.now(),
          } : prev);
          fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "deleteNode", nodeId: selectedId }),
          }).catch(console.error);
        } else if (selectedType === "edge") {
          setServerState((prev) => prev ? {
            ...prev,
            customEdges: prev.customEdges.filter(e2 => e2.id !== selectedId),
            lastUpdated: Date.now(),
          } : prev);
          fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "deleteEdge", edgeId: selectedId }),
          }).catch(console.error);
          onDeselect();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [selectedId, selectedType, onDeleteNode, onDeselect]);

    // ── Export / Import ───────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      exportPng: () => {
        downloadSvgAsPng(buildSvgExport(nodes, edges, isEcosystem));
      },
      exportCsv: () => {
        if (!serverState) return;
        const csv = buildCsvExport(
          baselineNodes, ecosystemNodes,
          serverState.customNodes, serverState.customEdges,
          serverState.settings || { nodePause: 1, edgeWeightOverrides: {}, nodeDelayOverrides: {} },
          edges,
        );
        downloadBlob(csv, "workflow.csv", "text/csv;charset=utf-8;");
      },
      importCsv: (text: string) => {
        const data = parseCsvImport(text);
        fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "importState", ...data }),
        }).then((r) => r.json()).then((res) => {
          if (res.state) {
            const s = res.state as WorkflowApiState;
            setServerState((prev) => prev ? { ...prev, ...s } : s);
            lastPollTs.current = s.lastUpdated;
          }
        }).catch(console.error);
      },
    }));

    // ── Generate dynamic keyframes for sequential animation ─────────────
    const activeEdges = edges.filter(e => !e.isDeprecated);
    const seqMap = new Map<number, number>(); // sequence -> max weight
    activeEdges.forEach(e => {
      const s = e.sequence || 1;
      const w = e.weight || 1;
      seqMap.set(s, Math.max(seqMap.get(s) || 1, w));
    });

    const seqTimes: { seq: number; start: number; duration: number }[] = [];
    const sortedSeqs = Array.from(seqMap.keys()).sort((a, b) => a - b);
    
    let totalWeight = 0;
    const nodePause = serverState?.settings?.nodePause ?? 1.0; // from server settings

    sortedSeqs.forEach(seq => {
      if (totalWeight > 0) totalWeight += nodePause;
      const w = seqMap.get(seq)!;
      seqTimes.push({ seq, start: totalWeight, duration: w });
      totalWeight += w;
    });

    totalWeight += 3.0; // Pause at the end before next cycle begins

    const cycleDur = Math.max(4, totalWeight * 1.1);
    const seqStyles: string[] = [];

    seqTimes.forEach(({ seq, start, duration }) => {
      const startPct = (start / totalWeight) * 100;
      const endPct = ((start + duration) / totalWeight) * 100;

      // Legacy anim for any remaining div-based usage
      seqStyles.push(`
        @keyframes anim-seq-${seq} {
          0% { left: -40px; opacity: 0; }
          ${Math.max(0, startPct - 0.01)}% { left: -40px; opacity: 0; }
          ${startPct}% { left: -40px; opacity: 1; }
          ${endPct}% { left: 100%; opacity: 1; }
          ${Math.min(100, endPct + 0.01)}% { left: 100%; opacity: 0; }
          100% { left: 100%; opacity: 0; }
        }
      `);

      // SVG stroke-dashoffset animation (pathLength="1" normalises path).
      // Dash travels from before the path start (offset=0.06) to after the end (offset=-1.06).
      seqStyles.push(`
        @keyframes svgflow-${seq} {
          0%                              { stroke-dashoffset: 0.06; opacity: 0; }
          ${Math.max(0, startPct - 0.01)}%{ stroke-dashoffset: 0.06; opacity: 0; }
          ${startPct}%                    { stroke-dashoffset: 0.06; opacity: 0.7; }
          ${endPct}%                      { stroke-dashoffset: -1.06; opacity: 0.7; }
          ${Math.min(100, endPct + 0.01)}%{ stroke-dashoffset: -1.06; opacity: 0; }
          100%                            { stroke-dashoffset: -1.06; opacity: 0; }
        }
      `);
    });

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div
        ref={canvasRef}
        className="w-full h-full relative overflow-hidden select-none"
        style={{
          background: "#F8FAFC",
          cursor: connectFrom ? "crosshair" : "default",
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handlePaneClick}
        onContextMenu={handleCanvasContextMenu}
      >
        {/* Blueprint dot background */}
        <div className="absolute inset-0 pointer-events-none opacity-40"
          style={{ backgroundImage: "radial-gradient(#CBD5E1 1px, transparent 1px)", backgroundSize: "30px 30px" }} />
        <style dangerouslySetInnerHTML={{ __html: seqStyles.join("\n") + `
          .eco-sphere-wrapper { position: absolute; }
          .eco-sphere-wrapper .eco-label {
            opacity: 0;
            transition: opacity 0.18s ease;
            pointer-events: none;
          }
          .eco-sphere-wrapper:hover .eco-label {
            opacity: 1;
          }
        ` }} />

        {/* ── SVG edge layer — bezier curves + satellite clusters ─────────────────── */}
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ zIndex: 10, overflow: "visible", pointerEvents: "none" }}
        >
          {/* MiroFish satellite mini-spheres — dense cluster halo around each eco node */}
          {isEcosystem && nodes.filter(n => n.isEco).map(node => {
            const cx = node.x + SPHERE_SZ / 2;
            const cy = node.y + SPHERE_SZ / 2;
            const fill = ecoNodeNeon(node.id, node.isCustom);
            const z = node.z ?? 0;
            const baseOpacity = 0.3 + (z + 1) * 0.2;
            return getSatellites(cx, cy, node.id, 12).map((s, i) => (
              <circle
                key={`${node.id}-sat-${i}`}
                cx={s.x} cy={s.y} r={s.r}
                fill={fill}
                opacity={s.opacity * baseOpacity * (node.isDeprecated ? 0.3 : 1)}
              />
            ));
          })}

          {edges.map((edge) => {
            const src = nodeMap[edge.source]; const tgt = nodeMap[edge.target];
            if (!src || !tgt) return null;

            const x1 = src.x + nodeRadius(src.isEco), y1 = src.y + nodeRadius(src.isEco);
            const x2 = tgt.x + nodeRadius(tgt.isEco), y2 = tgt.y + nodeRadius(tgt.isEco);
            // Bezier control point: perpendicular offset at midpoint for an organic curve
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            // MiroFish sweeping arcs: much larger curvature for ecosystem, moderate for baseline
            const baseCurvature = isEcosystem
              ? Math.min(len * 0.62, 210)   // sweeping arcs for web-map
              : Math.min(len * 0.28, 90);   // existing baseline behaviour
            const jitter = isEcosystem ? ecoJitter(edge.id) * baseCurvature * 0.35 : 0;
            const curvature = baseCurvature + jitter;

            const cpx = mx - (dy / Math.max(len, 1)) * curvature;
            const cpy = my + (dx / Math.max(len, 1)) * curvature;

            // 3D edge depth — vary opacity and stroke-width based on avg z of endpoints
            const srcZ = src.z ?? 0;
            const tgtZ = tgt.z ?? 0;
            const avgZ = (srcZ + tgtZ) / 2;

            // In ecosystem view, tilt the control point slightly based on z difference to simulate 3D bow
            const zDiff = isEcosystem ? (srcZ - tgtZ) * 30 : 0;
            const cpxFinal = cpx;
            const cpyFinal = cpy + zDiff;
            const d = `M ${x1} ${y1} Q ${cpxFinal} ${cpyFinal} ${x2} ${y2}`;

            const isSelected = selectedId === edge.id && selectedType === "edge";
            const edgeMeta = EDGE_META[edge.id];
            const sw = isEcosystem ? 1.0 : 1.5;

            // MiroFish arc bundle: 4 arcs with alternating spread for sweeping overlap effect
            const arcPaths = isEcosystem ? [0, 1, 2, 3].map(a => {
              const sign = a % 2 === 0 ? 1 : -1;
              const spread = (a * 0.6 + ecoJitter(edge.id + String(a)) * 0.5) * baseCurvature * 0.28;
              const nx = -dy / Math.max(len, 1);
              const ny = dx / Math.max(len, 1);
              const cpxA = cpxFinal + sign * spread * nx;
              const cpyA = cpyFinal + sign * spread * ny;
              return `M ${x1} ${y1} Q ${cpxA} ${cpyA} ${x2} ${y2}`;
            }) : [d];

            // MiroFish red arcs on light background; upgraded edges stay green
            const ecoEdgeOpacity = edge.isDeprecated ? 0.04 : Math.max(0.08, 0.18 + (avgZ + 1) * 0.1);
            const ecoEdgeSW = Math.max(0.5, sw * (0.6 + (avgZ + 1) * 0.25));
            const miroArcColor = edge.isUpgraded ? "rgba(16,185,129," : "rgba(220,50,70,";
            const selStroke = isEcosystem ? "#e91e8c" : "#4F46E5";
            const pulseColor = edge.isUpgraded ? "#10B981" : isEcosystem ? "rgba(220,50,70,0.7)" : "#4F46E5";

            return (
              <g key={edge.id} style={{ opacity: isEcosystem ? ecoEdgeOpacity : (edge.isDeprecated ? 0.15 : 1), transition: "opacity 0.5s" }}>
                {/* MiroFish arc bundle — 4 sweeping bezier paths */}
                {arcPaths.map((arcD, ai) => (
                  <path
                    key={ai}
                    d={arcD} pathLength="1"
                    stroke={isSelected ? selStroke : (isEcosystem ? `${miroArcColor}${(0.18 - ai * 0.02).toFixed(2)})` : (edge.isUpgraded ? "#10B981" : "#94A3B8"))}
                    strokeWidth={isSelected ? ecoEdgeSW + 1.5 : ecoEdgeSW}
                    fill="none"
                    strokeDasharray={edge.isDeprecated ? "0.04 0.04" : undefined}
                    style={{
                      filter: isSelected ? "drop-shadow(0 0 4px rgba(233,30,140,0.6))" : undefined,
                      transition: "stroke 0.3s, stroke-width 0.2s",
                    }}
                  />
                ))}
                {/* Animated travelling pulse */}
                {!edge.isDeprecated && (
                  <path
                    d={arcPaths[0]} pathLength="1"
                    stroke={pulseColor}
                    strokeWidth={ecoEdgeSW + 1.0}
                    fill="none"
                    strokeDasharray="0.06 1"
                    style={{ animation: `svgflow-${edge.sequence || 1} ${cycleDur}s linear infinite` }}
                  />
                )}
                {/* Wide invisible hit area for click / hover */}
                <path
                  d={d}
                  stroke="transparent"
                  strokeWidth={22}
                  fill="none"
                  style={{
                    cursor: edge.isDeprecated ? "default" : "pointer",
                    pointerEvents: edge.isDeprecated ? "none" : "stroke",
                  }}
                  onClick={(e) => { e.stopPropagation(); if (!edge.isDeprecated) handleEdgeClick(edge.id); }}
                  onMouseEnter={() => { if (edgeMeta) onHover(edgeMeta.name, edgeMeta.summary); }}
                  onMouseLeave={onHoverEnd}
                />
              </g>
            );
          })}

          {/* Rubber band for connect mode */}
          {connectFrom && (() => {
            const src = nodeMap[connectFrom];
            if (!src) return null;
            return (
              <line
                x1={src.x + (src.isEco ? SPHERE_SZ / 2 : R)} y1={src.y + (src.isEco ? SPHERE_SZ / 2 : R)}
                x2={mousePos.x} y2={mousePos.y}
                stroke="#F59E0B" strokeWidth={2} strokeDasharray="8 4" opacity={0.7}
                style={{ pointerEvents: "none" }}
              />
            );
          })()}
        </svg>

        {/* ── Node layer ────────────────────────────────────── */}
        {(() => {
          // Painter's algorithm: sort ecosystem nodes back-to-front so front nodes overdraw back ones
          const sortedNodes = isEcosystem
            ? [...nodes].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
            : nodes;

          return sortedNodes.map((node) => {
            const isDep  = node.isDeprecated;
            const isBotl = node.bottleneck && !isDep;
            const isCircle = !node.isEco;
            const isSelected = selectedId === node.id && selectedType === "node";
            const isConnSrc  = connectFrom === node.id;
            const nodeMeta   = NODE_META[node.id];

            // ── Ecosystem 3D sphere ───────────────────────────────────────────
            if (node.isEco) {
              const z = node.z ?? 0;
              const depthOpacity = isDep ? 0.2 : 0.3 + (z + 1) * 0.35;
              const depthScale   = 0.60 + (z + 1) * 0.20;
              const depthBlur    = Math.max(0, (-z) * 2.0);  // only blur nodes behind equator (z < 0)
              const depthZIndex  = Math.round(10 + (z + 1) * 10);

              return (
                <div
                  key={node.id}
                  className="eco-sphere-wrapper"
                  style={{ position: "absolute", left: node.x, top: node.y, zIndex: depthZIndex }}
                  data-nodeid={node.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={(e) => handleNodeClick(e, node.id)}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                  onMouseEnter={() => { if (nodeMeta) onHover(nodeMeta.name, nodeMeta.summary); }}
                  onMouseLeave={onHoverEnd}
                >
                  {/* Sphere body */}
                  <div
                    className={isBotl ? "bottleneck-glow" : ""}
                    style={{
                      width: SPHERE_SZ,
                      height: SPHERE_SZ,
                      background: sphereGradient(node.id, isBotl, isDep),
                      borderRadius: "50%",
                      boxShadow: sphereGlow(node.id, isBotl, isDep, depthScale),
                      opacity: depthOpacity,
                      transform: `scale(${depthScale})`,
                      transformOrigin: "center center",
                      filter: depthBlur > 0.3 ? `blur(${depthBlur.toFixed(1)}px)` : undefined,
                      transition: "opacity 0.4s, filter 0.4s, transform 0.4s, box-shadow 0.3s",
                      outline: isSelected ? "2px solid rgba(56,189,248,0.9)" : isConnSrc ? "2px dashed #F59E0B" : "none",
                      outlineOffset: "3px",
                      cursor: dragRef.current?.nodeId === node.id ? "grabbing" : (connectFrom ? "pointer" : "grab"),
                      userSelect: "none",
                    }}
                  />
                  {/* Label — hidden by default, shown on hover via CSS */}
                  <div className="eco-label" style={{
                    position: "absolute",
                    top: SPHERE_SZ + 6,
                    left: "50%",
                    transform: "translateX(-50%)",
                    whiteSpace: "nowrap",
                    background: "rgba(255,255,255,0.92)",
                    backdropFilter: "blur(6px)",
                    padding: "3px 8px",
                    borderRadius: "6px",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#1e293b",
                    textAlign: "center",
                    zIndex: 100,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                    border: `1px solid ${ecoNodeNeon(node.id, node.isCustom)}44`,
                  }}>
                    {node.label}
                    {node.subcategory && !isDep && (
                      <div style={{ fontSize: 8, color: ecoNodeNeon(node.id, node.isCustom), marginTop: 1 }}>{node.subcategory}</div>
                    )}
                    {node.bottleneckText && !isDep && (
                      <div style={{ fontSize: 8, color: "#f59e0b", marginTop: 1 }}>{node.bottleneckText}</div>
                    )}
                  </div>
                </div>
              );
            }

            // ── Baseline flat node (unchanged) ────────────────────────────────
            return (
              <div
                key={node.id}
                data-nodeid={node.id}
                style={{
                  position: "absolute", left: node.x, top: node.y,
                  width: SZ, height: SZ,
                  background: "white",
                  borderRadius: isCircle ? "50%" : "14px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 14,
                  border: `${node.isHub ? 3 : 2}px solid ${node.borderColor}`,
                  color: node.textColor,
                  boxShadow: isBotl ? undefined : "0 4px 6px -1px rgba(0,0,0,0.1)",
                  zIndex: 20,
                  opacity: isDep ? 0.3 : 1,
                  cursor: dragRef.current?.nodeId === node.id ? "grabbing" : (connectFrom ? "pointer" : "grab"),
                  userSelect: "none",
                  transition: "border-color 0.5s, opacity 0.5s, box-shadow 0.5s",
                  outline: isSelected ? `3px solid #818CF8` : isConnSrc ? "3px dashed #F59E0B" : "none",
                  outlineOffset: "3px",
                }}
                className={isBotl ? "bottleneck-glow" : ""}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onClick={(e) => handleNodeClick(e, node.id)}
                onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                onMouseEnter={() => { if (nodeMeta) onHover(nodeMeta.name, nodeMeta.summary); }}
                onMouseLeave={onHoverEnd}
              >
                {node.initials}

                {/* Node label */}
                <div style={{
                  position: "absolute", top: 65, whiteSpace: "nowrap",
                  background: node.labelBg, padding: "4px 10px",
                  borderRadius: "20px",
                  fontSize: 11, fontWeight: 600,
                  color: node.labelTextColor || "#334155",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                  border: `1px solid ${node.labelBorderColor}`,
                  textAlign: "center", pointerEvents: "none",
                }}>
                  {node.label}
                  {node.subcategory && !isDep && (
                    <div style={{ fontSize: 9, fontWeight: 400, color: "#F59E0B", marginTop: 1 }}>
                      {node.subcategory}
                    </div>
                  )}
                  {node.bottleneckText && !isDep && (
                    <div style={{ fontSize: 9, color: "#F59E0B", marginTop: 1 }}>{node.bottleneckText}</div>
                  )}
                </div>
              </div>
            );
          });
        })()}

        {/* ── Context menu ─────────────────────────────────── */}
        {ctxMenu && (
          <div
            className="fixed bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[180px] text-sm"
            style={{ top: ctxMenu.y, left: ctxMenu.x, zIndex: 200 }}
            onMouseLeave={() => setCtxMenu(null)}
            onClick={(e) => e.stopPropagation()}
          >
            {ctxMenu.type === "canvas" && (
              <button className="w-full text-left px-4 py-2 hover:bg-indigo-50 hover:text-indigo-600 font-medium flex items-center gap-2 transition-colors"
                onClick={() => { setAddForm({ cx: ctxMenu.cx, cy: ctxMenu.cy, label: "", initials: "", role: "person" }); setCtxMenu(null); }}>
                <span className="text-indigo-500 font-bold">+</span> Add Node Here
              </button>
            )}
            {ctxMenu.type === "node" && (
              <>
                <button className="w-full text-left px-4 py-2 hover:bg-indigo-50 hover:text-indigo-600 font-medium flex items-center gap-2 transition-colors"
                  onClick={() => { setConnectFrom(ctxMenu.nodeId); setCtxMenu(null); }}>
                  <span className="text-indigo-500">↗</span> Connect from here
                </button>
                {!CORE_IDS.has(ctxMenu.nodeId) && (
                  <button className="w-full text-left px-4 py-2 hover:bg-red-50 hover:text-red-600 font-medium flex items-center gap-2 transition-colors border-t border-gray-100 mt-1"
                    onClick={() => {
                      const id = ctxMenu.nodeId;
                      onDeleteNode(id);
                      setServerState((prev) => prev ? { ...prev,
                        customNodes: prev.customNodes.filter(n => n.id !== id),
                        customEdges: prev.customEdges.filter(e2 => e2.source !== id && e2.target !== id),
                        lastUpdated: Date.now() } : prev);
                      fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "deleteNode", nodeId: id }) }).catch(console.error);
                      setCtxMenu(null);
                    }}>
                    <span className="text-red-400">×</span> Delete Node
                  </button>
                )}
              </>
            )}
            <div className="border-t border-gray-100 mt-1 px-4 py-1.5 text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
              {ctxMenu.type === "node" ? "Right-click · node" : "Right-click · canvas"}
            </div>
          </div>
        )}

        {/* ── Connect mode banner ───────────────────────────── */}
        {connectFrom && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold px-4 py-2 rounded-full shadow flex items-center gap-2">
            <span>↗ Click a target node to connect</span>
            <button onClick={() => setConnectFrom(null)} className="ml-1 text-amber-500 hover:text-amber-700 font-bold">✕</button>
          </div>
        )}

        {/* ── Add Node Modal ────────────────────────────────── */}
        {addForm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setAddForm(null); }}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 border border-gray-200">
              <h3 className="font-bold text-gray-900 mb-4">Add New Node</h3>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Display Name</label>
                  <input autoFocus type="text" value={addForm.label} onChange={(e) => setAddForm(f => f ? { ...f, label: e.target.value } : f)}
                    placeholder="e.g., Compliance Team" onKeyDown={(e) => e.key === "Enter" && handleAddNodeSubmit()}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Initials (2–3 chars)</label>
                  <input type="text" maxLength={3} value={addForm.initials} onChange={(e) => setAddForm(f => f ? { ...f, initials: e.target.value } : f)}
                    placeholder="e.g., CT" onKeyDown={(e) => e.key === "Enter" && handleAddNodeSubmit()}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Role Type</label>
                  <select value={addForm.role} onChange={(e) => setAddForm(f => f ? { ...f, role: e.target.value as AddForm["role"] } : f)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 bg-white">
                    <option value="person">Person / Collaborator</option>
                    <option value="tool">Tool / System</option>
                    <option value="external">External Partner</option>
                    <option value="output">Output / Artifact</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={handleAddNodeSubmit} disabled={!addForm.label || !addForm.initials}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
                  Add Node
                </button>
                <button onClick={() => setAddForm(null)} className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm text-gray-600 font-medium">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {/* ── Edge / Node Param Editor ──────────────────────── */}
        {selectedId && selectedType && (() => {
          const edge = selectedType === "edge" ? edges.find(e => e.id === selectedId) : null;
          const node = selectedType === "node" ? nodes.find(n => n.id === selectedId) : null;
          if (!edge && !node) return null;

          const saveEdge = (seq: number, wt: number) => {
            setServerState(prev => {
              if (!prev) return prev;
              const newOverrides = { ...(prev.settings?.edgeWeightOverrides || {}) };
              newOverrides[selectedId] = { sequence: seq, weight: wt };
              return { ...prev, settings: { ...prev.settings, edgeWeightOverrides: newOverrides }, lastUpdated: Date.now() };
            });
            fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "updateEdgeParams", edgeId: selectedId, sequence: seq, weight: wt }),
            }).catch(console.error);
          };

          const saveNodeDelay = (delay: number) => {
            setServerState(prev => {
              if (!prev) return prev;
              const newDelays = { ...(prev.settings?.nodeDelayOverrides || {}) };
              newDelays[selectedId] = delay;
              return { ...prev, settings: { ...prev.settings, nodeDelayOverrides: newDelays }, lastUpdated: Date.now() };
            });
            fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "updateNodeDelay", nodeId: selectedId, delay }),
            }).catch(console.error);
          };

          const saveNodePause = (pause: number) => {
            setServerState(prev => prev ? { ...prev, settings: { ...prev.settings, nodePause: pause }, lastUpdated: Date.now() } : prev);
            fetch("/api/graph-state", { method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "updateSettings", settings: { nodePause: pause } }),
            }).catch(console.error);
          };

          return (
            <div className="absolute bottom-24 left-6 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 w-72" style={{ backdropFilter: "blur(8px)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="font-bold text-xs text-slate-500 uppercase tracking-widest">
                  {edge ? "⚡ Relation Parameters" : "⏱ Node Output Delay"}
                </div>
                <div className="text-[10px] text-slate-400 font-mono">{selectedId}</div>
              </div>

              {edge && (() => {
                const overrides = serverState?.settings?.edgeWeightOverrides?.[selectedId];
                const curSeq = overrides?.sequence ?? edge.sequence ?? 1;
                const curWt  = overrides?.weight  ?? edge.weight  ?? 1;
                return (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-slate-500">Sequence Order</span>
                      <span className="text-[10px] text-slate-400">Lower = fires earlier in the cycle</span>
                      <input type="number" min={1} max={20} step={1} defaultValue={curSeq}
                        onChange={e => saveEdge(parseInt(e.target.value) || 1, curWt)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-slate-500">Processing Weight</span>
                      <span className="text-[10px] text-slate-400">Relative time for this hop (1 = normal, 6 = bottleneck)</span>
                      <input type="number" min={0.1} max={20} step={0.1} defaultValue={curWt}
                        onChange={e => saveEdge(curSeq, parseFloat(e.target.value) || 1)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                    <label className="flex flex-col gap-1 border-t border-slate-100 pt-3">
                      <span className="text-[11px] font-semibold text-slate-500">Global Node Pause (s)</span>
                      <span className="text-[10px] text-slate-400">Handoff gap between all sequence steps</span>
                      <input type="number" min={0} max={10} step={0.5} defaultValue={serverState?.settings?.nodePause ?? 1}
                        onChange={e => saveNodePause(parseFloat(e.target.value) || 0)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                  </div>
                );
              })()}

              {node && (() => {
                const curDelay = serverState?.settings?.nodeDelayOverrides?.[selectedId] ?? 1;
                return (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-slate-500">Output Delay Multiplier</span>
                      <span className="text-[10px] text-slate-400">Applied to all outgoing edges (1 = normal, 6 = very slow)</span>
                      <input type="number" min={0.1} max={20} step={0.1} defaultValue={curDelay}
                        onChange={e => saveNodeDelay(parseFloat(e.target.value) || 1)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                    <label className="flex flex-col gap-1 border-t border-slate-100 pt-3">
                      <span className="text-[11px] font-semibold text-slate-500">Global Node Pause (s)</span>
                      <span className="text-[10px] text-slate-400">Handoff gap between all sequence steps</span>
                      <input type="number" min={0} max={10} step={0.5} defaultValue={serverState?.settings?.nodePause ?? 1}
                        onChange={e => saveNodePause(parseFloat(e.target.value) || 0)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                  </div>
                );
              })()}
            </div>
          );
        })()}
      </div>
    );
  }
);
