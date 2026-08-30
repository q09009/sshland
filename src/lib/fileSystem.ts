import {
  copyPath,
  createFile,
  deletePath,
  listDir,
  localCopy,
  localCreateFile,
  localDelete,
  localListDir,
  localMkdir,
  localRename,
  mkdir,
  rename,
  type FileEntry,
} from "../api";
import {
  breadcrumbs,
  joinLocalPath,
  joinPath,
  localBreadcrumbs,
  localParentPath,
  localPathContains,
  parentPath,
  type Crumb,
} from "./path";

export type FileSystemScope = "remote" | "local";

export interface FileSystemAdapter {
  scope: FileSystemScope;
  list(path: string): Promise<FileEntry[]>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  createFile(path: string): Promise<void>;
  delete(path: string, isDir: boolean): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  join(dir: string, name: string): string;
  parent(path: string): string;
  breadcrumbs(path: string): Crumb[];
  contains(parent: string, candidate: string): boolean;
}

const remoteFileSystem: FileSystemAdapter = {
  scope: "remote",
  list: listDir,
  rename,
  mkdir,
  createFile,
  delete: deletePath,
  copy: copyPath,
  join: joinPath,
  parent: parentPath,
  breadcrumbs,
  contains: (parent, candidate) =>
    candidate === parent || candidate.startsWith(`${parent.replace(/\/+$/, "")}/`),
};

const localFileSystem: FileSystemAdapter = {
  scope: "local",
  list: localListDir,
  rename: localRename,
  mkdir: localMkdir,
  createFile: localCreateFile,
  delete: (path) => localDelete(path),
  copy: localCopy,
  join: joinLocalPath,
  parent: localParentPath,
  breadcrumbs: localBreadcrumbs,
  contains: localPathContains,
};

export function fileSystemFor(scope: FileSystemScope): FileSystemAdapter {
  return scope === "local" ? localFileSystem : remoteFileSystem;
}
