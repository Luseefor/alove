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
import type * as accountLifecycle from "../accountLifecycle.js";
import type * as files from "../files.js";
import type * as presence from "../presence.js";
import type * as members from "../members.js";
import type * as sourceHistory from "../sourceHistory.js";
import type * as reviews from "../reviews.js";
import type * as projects from "../projects.js";
import type * as github from "../github.js";

declare const fullApi: ApiFromModules<{
  accountLifecycle: typeof accountLifecycle;
  files: typeof files;
  presence: typeof presence;
  members: typeof members;
  sourceHistory: typeof sourceHistory;
  reviews: typeof reviews;
  projects: typeof projects;
  github: typeof github;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
