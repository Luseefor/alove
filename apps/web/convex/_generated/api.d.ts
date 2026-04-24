/* eslint-disable */
/**
 * Generated `api` utility (vendored baseline). Regenerate with `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as files from "../files.js";
import type * as presence from "../presence.js";
import type * as projects from "../projects.js";

declare const fullApi: ApiFromModules<{
  files: typeof files;
  presence: typeof presence;
  projects: typeof projects;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
