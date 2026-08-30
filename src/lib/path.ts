// Helpers for working with remote Unix-style absolute paths.

/** The parent directory of a path. Parent of "/" stays "/". */
export function parentPath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  if (trimmed === "" ) return "/";
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

/** The final component of a path, handling both / and \ separators. */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
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

/** Root of a normalized local path (`C:/` on Windows, `/` on Unix). */
export function localRoot(p: string): string {
  const windows = p.match(/^([A-Za-z]:)(?:\/|$)/);
  return windows ? `${windows[1]}/` : "/";
}

/** Parent of a normalized local absolute path, stopping at its drive/root. */
export function localParentPath(p: string): string {
  const root = localRoot(p);
  const normalized = p.replace(/\/+$/, "") || root;
  if (normalized.toLocaleLowerCase() === root.replace(/\/$/, "").toLocaleLowerCase()) {
    return root;
  }
  const index = normalized.lastIndexOf("/");
  if (index < root.length - 1) return root;
  const parent = normalized.slice(0, index);
  return parent === root.replace(/\/$/, "") ? root : parent;
}

/** Join a normalized local directory with one child name. */
export function joinLocalPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** Breadcrumbs for Unix paths and Windows drive paths. */
export function localBreadcrumbs(p: string): Crumb[] {
  const root = localRoot(p);
  const rest = p.slice(root.length).split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ name: root, path: root }];
  let current = root.replace(/\/$/, "");
  for (const segment of rest) {
    current = current ? `${current}/${segment}` : `/${segment}`;
    crumbs.push({ name: segment, path: current });
  }
  return crumbs;
}

/** Whether `candidate` is `parent` itself or nested below it. */
export function localPathContains(parent: string, candidate: string): boolean {
  const windows = /^[A-Za-z]:\//.test(parent);
  const normalize = (value: string) => {
    const trimmed = value.replace(/\/+$/, "");
    return windows ? trimmed.toLocaleLowerCase() : trimmed;
  };
  const base = normalize(parent);
  const child = normalize(candidate);
  return child === base || child.startsWith(`${base}/`);
}
