// Nodes.tsx – type-only module (no @xyflow/react dependency)
// Wire rendering and node rendering are handled inline in GraphCanvas.tsx.

export interface CustomNodeData {
  labelInitials: string;
  label: string;
  isDeprecated?: boolean;
  isUpgraded?: boolean;
  borderColor?: string;
  textColor?: string;
  bottleneck?: boolean;
  bottleneckText?: string;
  isHub?: boolean;
  subcategory?: string;
}
