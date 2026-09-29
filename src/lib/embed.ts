/**
 * embed.ts — lets Workable run inside a sandboxed frame (the Hermes desktop
 * app's Workable window).
 *
 * A sandboxed frame has an opaque origin, so every call to Workable's own API
 * is cross-origin and must prove it came from the embed: the frame URL carries
 * ?embed=<token>, and this module appends the same token to the page's API
 * requests. src/proxy.ts checks it. Outside a frame this module does nothing.
 */

let token: string | null = null;

/** True when the page runs in an opaque-origin (sandboxed) frame. */
export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.origin === 'null';
}

/** Add the embed token to a same-app URL (for EventSource, which can't be patched). */
export function withEmbedToken(url: string): string {
  if (!token || !url.startsWith('/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}embed=${encodeURIComponent(token)}`;
}

function install(): void {
  if (!isEmbedded()) return;
  token = new URLSearchParams(window.location.search).get('embed');
  if (!token) return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) return original(withEmbedToken(input), init);
    return original(input, init);
  };
}

// Runs when the client bundle loads, before any component effect fetches data.
if (typeof window !== 'undefined') install();
