/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_ids from "../lib/ids.js";
import type * as matches from "../matches.js";
import type * as matchmaking from "../matchmaking.js";
import type * as privateMatch from "../privateMatch.js";
import type * as signaling from "../signaling.js";
import type * as sweep from "../sweep.js";
import type * as turn from "../turn.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "lib/access": typeof lib_access;
  "lib/codes": typeof lib_codes;
  "lib/ids": typeof lib_ids;
  matches: typeof matches;
  matchmaking: typeof matchmaking;
  privateMatch: typeof privateMatch;
  signaling: typeof signaling;
  sweep: typeof sweep;
  turn: typeof turn;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
