'use client';

/**
 * hooks/useAIEngine.ts — Strategy-pattern routing hook for AI operations.
 *
 * Intercepts AI API calls and injects the current engine mode.
 * Handles the critical race condition: if the user toggles mode while a
 * request is in flight, the stale request is aborted via AbortController
 * and its response is discarded using a generation counter.
 *
 * The UI components never touch this hook directly — it's consumed by
 * useAIHandlers, which remains the public API for all AI operations.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useAIEngineMode, type AIEngineMode } from '@/contexts/AIEngineContext';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AIEngineConfig {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl?: string;
}

export interface EngineCallOptions {
  /** Override the engine mode for this specific call */
  forceMode?: AIEngineMode;
  /** External AbortSignal to chain */
  signal?: AbortSignal;
}

interface InFlightRequest {
  controller: AbortController;
  generation: number;
  operationType: 'analyze' | 'update';
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAIEngine() {
  const { mode, generation } = useAIEngineMode();

  // Track in-flight requests by operation type
  const inFlightRef = useRef<Map<string, InFlightRequest>>(new Map());
  // Snapshot the generation at call time to detect staleness
  const generationRef = useRef(generation);
  generationRef.current = generation;

  // Abort all in-flight requests when generation changes (mode toggled)
  useEffect(() => {
    const inFlight = inFlightRef.current;
    for (const [key, req] of inFlight) {
      if (req.generation !== generation) {
        req.controller.abort(new DOMException('Engine mode changed', 'AbortError'));
        inFlight.delete(key);
      }
    }
  }, [generation]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      for (const req of inFlightRef.current.values()) {
        req.controller.abort(new DOMException('Component unmounted', 'AbortError'));
      }
      inFlightRef.current.clear();
    };
  }, []);

  /**
   * Run the optimize/analyze operation via the appropriate engine.
   * Returns the response data or throws on error/abort.
   */
  const runAnalyze = useCallback(async (
    workflowData: unknown,
    config: AIEngineConfig,
    options?: EngineCallOptions,
  ): Promise<{ data: Record<string, unknown>; engine: AIEngineMode; aborted: boolean }> => {
    const effectiveMode = options?.forceMode ?? mode;
    const callGeneration = generationRef.current;

    // Abort any previous in-flight analyze request
    const existing = inFlightRef.current.get('analyze');
    if (existing) {
      existing.controller.abort(new DOMException('Superseded by new request', 'AbortError'));
      inFlightRef.current.delete('analyze');
    }

    const controller = new AbortController();
    if (options?.signal) {
      // Chain external signal
      options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason));
    }

    inFlightRef.current.set('analyze', {
      controller,
      generation: callGeneration,
      operationType: 'analyze',
    });

    try {
      const res = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowData,
          apiKey: config.apiKey,
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl || undefined,
          engine: effectiveMode,
        }),
        signal: controller.signal,
      });

      // Check for staleness: if generation changed since we started, discard result
      if (generationRef.current !== callGeneration) {
        return { data: {}, engine: effectiveMode, aborted: true };
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Analysis failed.');
      }

      return { data, engine: effectiveMode, aborted: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { data: {}, engine: effectiveMode, aborted: true };
      }
      throw err;
    } finally {
      inFlightRef.current.delete('analyze');
    }
  }, [mode]);

  /**
   * Run the update operation via the appropriate engine.
   */
  const runUpdate = useCallback(async (
    prompt: string,
    currentState: unknown,
    config: AIEngineConfig,
    options?: EngineCallOptions,
  ): Promise<{ data: Record<string, unknown>; engine: AIEngineMode; aborted: boolean }> => {
    const effectiveMode = options?.forceMode ?? mode;
    const callGeneration = generationRef.current;

    // Abort any previous in-flight update request
    const existing = inFlightRef.current.get('update');
    if (existing) {
      existing.controller.abort(new DOMException('Superseded by new request', 'AbortError'));
      inFlightRef.current.delete('update');
    }

    const controller = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason));
    }

    inFlightRef.current.set('update', {
      controller,
      generation: callGeneration,
      operationType: 'update',
    });

    try {
      const res = await fetch('/api/ai/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentState,
          apiKey: config.apiKey,
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl || undefined,
          engine: effectiveMode,
        }),
        signal: controller.signal,
      });

      if (generationRef.current !== callGeneration) {
        return { data: {}, engine: effectiveMode, aborted: true };
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Update failed.');
      }

      return { data, engine: effectiveMode, aborted: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { data: {}, engine: effectiveMode, aborted: true };
      }
      throw err;
    } finally {
      inFlightRef.current.delete('update');
    }
  }, [mode]);

  /**
   * Abort a specific in-flight operation.
   */
  const abort = useCallback((operationType: 'analyze' | 'update') => {
    const req = inFlightRef.current.get(operationType);
    if (req) {
      req.controller.abort(new DOMException('Manually aborted', 'AbortError'));
      inFlightRef.current.delete(operationType);
    }
  }, []);

  /**
   * Check if a specific operation is in flight.
   */
  const isInFlight = useCallback((operationType: 'analyze' | 'update') => {
    return inFlightRef.current.has(operationType);
  }, []);

  return {
    mode,
    runAnalyze,
    runUpdate,
    abort,
    isInFlight,
  };
}
