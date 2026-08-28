import type { FileSearchEngine, SearchToolStatus } from "./settings";

/** Resolve a preference against this server/user's remembered tool checks. */
export function resolveFileSearchEngine(
  preferred: FileSearchEngine,
  tools: SearchToolStatus,
): FileSearchEngine {
  if (preferred === "filter") return "filter";
  if (preferred === "fd" && tools.fdChecked && tools.fdCommand) return "fd";
  if (preferred === "find" && tools.find === true) return "find";
  return "filter";
}
