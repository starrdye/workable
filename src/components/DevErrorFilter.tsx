"use client";

/**
 * DevErrorFilter — development-only browser extension noise suppressor.
 *
 * Some browser extensions (MetaMask, OKX Wallet, Rabby, etc.) inject an
 * `inpage.js` script into every tab. When those scripts have internal bugs
 * (e.g. "func sseError not found") the error surfaces in the Next.js
 * Turbopack overlay and the browser console, making it hard to spot real
 * app errors.
 *
 * This component:
 *   1. Overrides window.onerror to drop errors whose `source` URL starts
 *      with "chrome-extension://"
 *   2. Captures the "error" event (capture phase) and stops + prevents any
 *      ErrorEvent whose filename is a chrome-extension URL
 *   3. Captures "unhandledrejection" and suppresses rejections whose stack
 *      trace or fileName references a chrome-extension URL
 *
 * It is ONLY rendered in development (gated in layout.tsx with a
 * process.env.NODE_ENV check) so zero suppression logic reaches production.
 */

import { useEffect } from "react";

export function DevErrorFilter() {
  useEffect(() => {
    const isExtension = (src?: string | null): boolean =>
      typeof src === "string" && src.startsWith("chrome-extension://");

    // ── 1. window.onerror (synchronous errors) ──────────────────────────────
    const prevOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      if (isExtension(source)) return true; // returning true suppresses the browser error
      return prevOnError ? prevOnError(message, source, lineno, colno, error) : false;
    };

    // ── 2. ErrorEvent (capture phase, fires before React/Next overlays) ─────
    const onErrorEvent = (e: ErrorEvent) => {
      if (isExtension(e.filename)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("error", onErrorEvent, true /* capture */);

    // ── 3. Unhandled promise rejections from extensions ──────────────────────
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const stack: string = e.reason?.stack ?? "";
      const file: string  = e.reason?.fileName ?? "";
      if (isExtension(file) || stack.includes("chrome-extension://")) {
        e.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.onerror = prevOnError;
      window.removeEventListener("error", onErrorEvent, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
