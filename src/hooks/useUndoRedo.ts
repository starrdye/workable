/**
 * useUndoRedo — Track 2 (0.42 → ported to 0.46)
 *
 * Client-side circular undo/redo buffer for ServerGraphState.
 *
 * Design:
 *  - Two ref-based stacks (past / future) hold up to MAX_HISTORY deep-cloned
 *    ServerGraphState snapshots.  Refs avoid triggering renders on every push.
 *  - A single `counts` state value is updated after every stack operation so
 *    the header buttons (canUndo / canRedo) re-render only when needed.
 *  - `push(state)`  — call BEFORE a destructive mutation; clears the redo stack.
 *  - `undo(current)` / `redo(current)` — swap stacks and return the target state
 *    (or null if the stack is empty).  Caller is responsible for applying it to
 *    the server via importState.
 */

import { useCallback, useRef, useState } from 'react';
import type { ServerGraphState } from '@/lib/serverState';

const MAX_HISTORY = 50;

function deepClone(state: ServerGraphState): ServerGraphState {
  return JSON.parse(JSON.stringify(state)) as ServerGraphState;
}

export interface UndoRedoHandle {
  /** Snapshot the current state before a mutation. Clears the redo stack. */
  push: (state: ServerGraphState) => void;
  /** Returns the previous state (or null). Pushes current onto redo stack. */
  undo: (current: ServerGraphState) => ServerGraphState | null;
  /** Returns the next state (or null). Pushes current onto undo stack. */
  redo: (current: ServerGraphState) => ServerGraphState | null;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
}

export function useUndoRedo(): UndoRedoHandle {
  const pastRef   = useRef<ServerGraphState[]>([]);
  const futureRef = useRef<ServerGraphState[]>([]);

  // Counts drive re-renders for button enabled/disabled state.
  const [counts, setCounts] = useState({ past: 0, future: 0 });

  const syncCounts = () =>
    setCounts({ past: pastRef.current.length, future: futureRef.current.length });

  const push = useCallback((state: ServerGraphState) => {
    const clone = deepClone(state);
    const arr = pastRef.current;
    // Circular: keep only the last MAX_HISTORY entries
    if (arr.length >= MAX_HISTORY) arr.shift();
    arr.push(clone);
    futureRef.current = [];          // new action clears redo
    syncCounts();
  }, []);

  const undo = useCallback((current: ServerGraphState): ServerGraphState | null => {
    if (pastRef.current.length === 0) return null;
    // Move current to redo stack
    const futArr = futureRef.current;
    if (futArr.length >= MAX_HISTORY) futArr.pop();   // drop oldest redo
    futArr.unshift(deepClone(current));
    // Pop from past
    const prev = pastRef.current.pop()!;
    syncCounts();
    return prev;
  }, []);

  const redo = useCallback((current: ServerGraphState): ServerGraphState | null => {
    if (futureRef.current.length === 0) return null;
    // Move current to past stack
    const pastArr = pastRef.current;
    if (pastArr.length >= MAX_HISTORY) pastArr.shift();
    pastArr.push(deepClone(current));
    // Shift from future
    const next = futureRef.current.shift()!;
    syncCounts();
    return next;
  }, []);

  return {
    push,
    undo,
    redo,
    canUndo:   counts.past   > 0,
    canRedo:   counts.future > 0,
    undoCount: counts.past,
    redoCount: counts.future,
  };
}
