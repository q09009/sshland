// Helpers for working with remote Unix-style absolute paths.

/** The parent directory of a path. Parent of "/" stays "/". */
export function parentPath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  if (trimmed === "" ) return "/";
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

/** Join a directory path with a child name (Unix-style). */
export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export interface Crumb {
  name: string;
  path: string;
}

/** Break an absolute path into clickable breadcrumb segments (root first). */
export function breadcrumbs(p: string): Crumb[] {
  const segments = p.split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ name: "/", path: "/" }];
  let acc = "";
  for (const seg of segments) {
    acc += "/" + seg;
    crumbs.push({ name: seg, path: acc });
  }
  return crumbs;
}
