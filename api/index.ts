/**
 * The entire integration: import and re-export.
 * Phase 13 reduced this file from ~150 LoC to ~5; the runtime now
 * lives in node_modules/cms-vercel and is upgraded with `npm update`.
 */
import { createHandler } from 'cms-vercel';

export default createHandler();
