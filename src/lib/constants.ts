/** Canonical list of built-in Ridgeview core node IDs. */
export const CORE_NODE_IDS = ["nav", "script", "db", "xy", "mary", "ed", "cy"] as const;

/** Subset of core node IDs that appear in the ecosystem (web-map) view. */
export const ECO_NODE_IDS = ["nav", "xy", "mary", "ed"] as const;

/** Role → accent colour, shared by GraphCanvas and templates. */
export const ROLE_COLOR: Record<string, string> = {
  person: "#4F46E5",
  tool: "#64748B",
  external: "#475569",
  output: "#0EA5E9",
};

export const NODE_DATA: Record<string, {
  name: string; role: string; status: string;
  statusColor?: string; summary: string;
  processes: string[]; connections: string[];
}> = {
  nav: { name: 'NAV Back Office', role: 'External Partner', status: 'Active', summary: 'Provides initial raw data for the fund.', processes: ['Data Export', 'File Transfer'], connections: ['Xingye'] },
  script: { name: 'Parsing Script', role: 'Automation Tool', status: 'Operational', summary: 'Parses raw NAV data into standardized formats.', processes: ['Data Cleaning', 'Formatting'], connections: ['Xingye'] },
  db: { name: 'Database', role: 'Storage System', status: 'Operational', summary: 'Stores historical records and references.', processes: ['Query Execution', 'Data Retrieval'], connections: ['Xingye'] },
  xy: { name: 'Xingye', role: 'Central Hub / Coordinator', status: 'Active', summary: 'Compiles inputs and routes data for approval.', processes: ['Data Compilation', 'Workflow Routing', 'Monitoring'], connections: ['NAV', 'Script', 'Database', 'Mary'] },
  mary: { name: 'Mary', role: 'Collaborator', status: 'Active', summary: 'Provides initial review and approval.', processes: ['Data Review', 'Initial Sign-off'], connections: ['Xingye', 'Edward', 'Dashboard (Optimized)'] },
  ed: { name: 'Edward', role: 'Manager', status: 'Bottleneck (Queue: 2.3 Days)', statusColor: 'text-amber-500', summary: 'Final manual review queue holding up the pipeline.', processes: ['Final Approval', 'Delay Generation'], connections: ['Mary', 'Dashboard'] },
  cy: { name: 'Ridgeview Dashboard', role: 'Output Artifact', status: 'Pending Generation', summary: 'Final generated report for the fund.', processes: ['Data Visualization', 'Client Export'], connections: ['Edward', 'Mary (Automated)'] },
};

export const EDGE_DATA: Record<string, {
  name: string; role: string; status: string;
  statusColor?: string; summary: string;
  processes: string[]; connections: string[];
  sequence?: number;
}> = {
  'nav-xy': { sequence: 1, name: 'Data Ingestion', role: 'Input Feed', status: 'Active', summary: 'Raw NAV data transferred to Xingye.', processes: ['Secure FTP', 'Email Attachment'], connections: ['NAV', 'Xingye'] },
  'xy-script': { sequence: 2, name: 'Parsing Request', role: 'Processing Trigger', status: 'Automated', summary: 'Xingye sends raw data to script for parsing.', processes: ['API Call', 'Job Queue'], connections: ['Xingye', 'Script'] },
  'script-xy': { sequence: 3, name: 'Script Execution', role: 'Processing', status: 'Automated', summary: 'Script parses raw data into usable formats.', processes: ['Regex matching', 'Data mapping'], connections: ['Script', 'Xingye'] },
  'db-xy': { sequence: 3, name: 'Historical Query', role: 'Database Fetch', status: 'Active', summary: 'Pulls past records to match with new NAV.', processes: ['SQL Query', 'Data Merge'], connections: ['Database', 'Xingye'] },
  'xy-mary': { sequence: 4, name: 'Draft Submission', role: 'Review Request', status: 'Active', summary: 'Xingye submits compiled report to Mary.', processes: ['Drafting', 'Internal Routing'], connections: ['Xingye', 'Mary'] },
  'mary-ed': { sequence: 5, name: 'Escalation', role: 'Manager Review', status: 'Bottleneck', statusColor: 'text-amber-500', summary: 'Mary forwards to Edward for final sign-off.', processes: ['Manual Reading', 'Approval'], connections: ['Mary', 'Edward'] },
  'ed-cy': { sequence: 6, name: 'Publishing', role: 'Deployment', status: 'Delayed', statusColor: 'text-amber-500', summary: 'Edward approves and generates the dashboard.', processes: ['System Upload', 'Client Notification'], connections: ['Edward', 'Dashboard'] },
  'mary-cy': { sequence: 5, name: 'Automated Publishing', role: 'Direct Deployment', status: 'Optimized', statusColor: 'text-emerald-500', summary: 'Direct publish to dashboard, bypassing Edward.', processes: ['API Integration', 'Instant Refresh'], connections: ['Mary', 'Dashboard'] },
};
