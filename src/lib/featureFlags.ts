/**
 * featureFlags.ts — Runtime feature flags for distributed system phases.
 *
 * All flags default to false so the existing in-memory architecture is preserved.
 * Enable via environment variables in .env.local for development.
 */

/** Phase 1: Use SQLite as persistence backend instead of in-memory singleton. */
export const USE_SQLITE = process.env.WORKABLE_USE_SQLITE === 'true';

/** Phase 2: Enable Node-as-an-Agent analysis routes. */
export const USE_AGENTS = process.env.WORKABLE_USE_AGENTS === 'true';

/** Phase 3: Enable message-passing cascade simulation. */
export const USE_MESSAGE_PASSING = process.env.WORKABLE_USE_MESSAGE_PASSING === 'true';

/** Phase 4: Enable group-level governance agents. */
export const USE_GROUP_AGENTS = process.env.WORKABLE_USE_GROUP_AGENTS === 'true';

/** Phase 5: Enable viewport-based culling and LOD rendering. */
export const USE_VIEWPORT_CULLING = process.env.WORKABLE_USE_VIEWPORT === 'true';
