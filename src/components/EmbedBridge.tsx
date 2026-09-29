"use client";

/**
 * EmbedBridge — importing this client module installs embed mode (see
 * src/lib/embed.ts) as soon as the client bundle loads. Renders nothing.
 */

import "@/lib/embed";

export function EmbedBridge() {
  return null;
}
