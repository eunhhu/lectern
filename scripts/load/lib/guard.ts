// Refuses any directory that could hold real Lectern data (CONTRACTS D-0-10): the load scripts
// only ever write into a throwaway root.

import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../../..");

function refuse(reason: string): never {
  throw new Error(`load: refused — ${reason}`);
}

/** The real path of `path`: symlinks resolved on its deepest existing ancestor, the rest appended. */
export function realPath(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** Throws unless `dir` is safe to use as a throwaway data root. Made unless `create` is false. */
export function assertSandboxDir(
  dir: string,
  env: Record<string, string | undefined> = process.env,
  options: { create?: boolean } = {},
): string {
  const target = realPath(dir);
  const repo = realPath(REPO_ROOT);
  if (target === sep || target === realPath(homedir()) || target === repo) {
    refuse(`${target} is the filesystem root, the home directory or the repository`);
  }
  if (within(target, realPath(join(repo, "data"))) || within(target, join(repo, "data"))) {
    refuse(`${target} is the repository's data directory`);
  }
  for (const name of ["LECTERN_DATA_DIR", "LECTERN_LECTURES_DIR"] as const) {
    const value = env[name];
    if (!value) continue;
    const configured = realPath(value);
    if (within(target, configured) || within(configured, target)) refuse(`${target} overlaps ${name} (${configured})`);
  }
  // A database here or in a parent: this is (inside) a data directory in use.
  for (let at = target; ; at = dirname(at)) {
    if (existsSync(join(at, "lectern.sqlite"))) refuse(`${at} holds lectern.sqlite`);
    if (dirname(at) === at) break;
  }
  if (existsSync(target)) {
    const entries = readdirSync(target).filter((name) => name !== "lost+found" && !name.startsWith("."));
    if (entries.length > 0) refuse(`${target} is not empty`);
  }
  if (options.create !== false) mkdirSync(target, { recursive: true });
  return target;
}
