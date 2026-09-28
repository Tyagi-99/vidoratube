/**
 * Voice Intelligence Layer — public barrel (D326).
 *
 * Pure client-safe modules: catalog data, recommendation engine, model
 * selection, cost estimation, availability resolution. Server-only code
 * (provider calls, DB access) lives in *.server.ts / *.functions.ts and is
 * NOT re-exported here.
 */
export * from "./types";
export * from "./catalog";
export * from "./recommend";
export * from "./models";
export * from "./cost";
export * from "./availability";
