#!/usr/bin/env bun
// Build pipeline helper (docs/v2/pipeline/PIPELINE.md). The orchestrator never decides what
// runs next by reading prose: it asks this script. State lives in docs/v2/pipeline/pipeline.json.
//
//   bun run pipeline check              validate the graph (ids, deps, cycles, spec files and their header lines)
//   bun run pipeline status             counts per phase, what is running or blocked
//   bun run pipeline next [--parallel]  the work package(s) that may start now
//   bun run pipeline start <id>         mark in_progress and print the worktree commands
//   bun run pipeline verify <id>        changed files of wp/<id> must stay inside its `owns`
//   bun run pipeline merged <id>        mark merged
//   bun run pipeline block <id> <why>   mark blocked with a reason
//   bun run pipeline reset <id>         back to todo
//   bun run pipeline show <id>          print one entry

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Status = "todo" | "in_progress" | "merged" | "blocked";

interface WorkPackage {
  id: string;
  title: string;
  /** Ids that must be merged first. */
  deps: string[];
  /** Path prefixes this package may change (a directory ends with "/"). */
  owns: string[];
  /** basic: fine for a small model. careful: easy to get subtly wrong; use the best model available. */
  tier: "basic" | "careful";
  /** Gate level for scripts/pipeline/gate.sh, or a platform gate described in PIPELINE.md. */
  gate: "quick" | "unit" | "full" | "apple" | "android" | "windows";
  status: Status;
  /** Set when the package cannot start until the user does or decides something. */
  needs_user?: string;
  /** Runs after everything else: ready only when no other package is running or can still start. */
  last?: boolean;
  note?: string;
}

interface Pipeline {
  integration_branch: string;
  max_parallel: number;
  packages: WorkPackage[];
}

const ROOT = join(import.meta.dir, "../..");
const BUILD_DIR = join(ROOT, "docs/v2/pipeline");
const FILE = join(BUILD_DIR, "pipeline.json");

function load(): Pipeline {
  return JSON.parse(readFileSync(FILE, "utf8")) as Pipeline;
}

/** One package per line, so a state change is a one-line diff. */
function save(p: Pipeline): void {
  const lines = p.packages.map((wp) => `    ${JSON.stringify(wp)}`);
  const text = [
    "{",
    `  "integration_branch": ${JSON.stringify(p.integration_branch)},`,
    `  "max_parallel": ${p.max_parallel},`,
    `  "packages": [`,
    lines.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
  writeFileSync(FILE, text);
}

function fail(message: string): never {
  console.error(`pipeline: ${message}`);
  process.exit(1);
}

function find(p: Pipeline, id: string | undefined): WorkPackage {
  if (!id) fail("missing work package id");
  const wp = p.packages.find((x) => x.id === id);
  if (!wp) fail(`unknown work package: ${id}`);
  return wp;
}

const overlaps = (a: WorkPackage, b: WorkPackage) =>
  a.owns.some((x) => b.owns.some((y) => x.startsWith(y) || y.startsWith(x)));

/** A package that is running, or that will become ready once packages that can still run are merged. */
function canStillRun(p: Pipeline, wp: WorkPackage, seen = new Map<string, boolean>()): boolean {
  const known = seen.get(wp.id);
  if (known !== undefined) return known;
  seen.set(wp.id, false); // a cycle (rejected by check) counts as "cannot run"
  let result = false;
  if (wp.status === "in_progress") result = true;
  else if (wp.status === "todo" && !wp.needs_user) {
    result = wp.deps.every((dep) => {
      const other = find(p, dep);
      return other.status === "merged" || canStillRun(p, other, seen);
    });
  }
  seen.set(wp.id, result);
  return result;
}

function isReady(p: Pipeline, wp: WorkPackage): boolean {
  if (wp.status !== "todo" || wp.needs_user) return false;
  if (!wp.deps.every((dep) => find(p, dep).status === "merged")) return false;
  // A `last` package waits until every other package is merged, blocked, or stuck behind one that is.
  if (wp.last) return !p.packages.some((other) => other !== wp && !other.last && canStillRun(p, other));
  return true;
}

/** Tier, gate, deps and owns as written on a spec's header line ("> 등급: … · 게이트: … · 의존: … · 소유: …"). */
function specHeader(id: string): { tier: string; gate: string; deps: string[]; owns: string[] } | null {
  const path = join(BUILD_DIR, "wp", `${id}.md`);
  if (!existsSync(path)) return null;
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith("> 등급"));
  const m = line?.match(/등급: `([a-z]+)` · 게이트: `([a-z]+)` · 의존: (.*?) · 소유: (.*)$/);
  if (!m) return null;
  const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((x) => x[1]!);
  return { tier: m[1]!, gate: m[2]!, deps: ticks(m[3]!), owns: ticks(m[4]!) };
}

function check(p: Pipeline): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const wp of p.packages) {
    if (ids.has(wp.id)) problems.push(`duplicate id ${wp.id}`);
    ids.add(wp.id);
    if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(wp.id)) problems.push(`${wp.id}: id must look like P1-03`);
    if (wp.owns.length === 0) problems.push(`${wp.id}: owns is empty`);
    if (!existsSync(join(BUILD_DIR, "wp", `${wp.id}.md`))) {
      problems.push(`${wp.id}: missing spec docs/v2/pipeline/wp/${wp.id}.md`);
      continue;
    }
    // The spec's header line is a copy of this entry; a worker reads the spec, the orchestrator reads the JSON.
    const header = specHeader(wp.id);
    if (!header) {
      problems.push(`${wp.id}: spec has no "> 등급: … · 게이트: … · 의존: … · 소유: …" header line`);
      continue;
    }
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (header.tier !== wp.tier) problems.push(`${wp.id}: spec says tier ${header.tier}, pipeline.json says ${wp.tier}`);
    if (header.gate !== wp.gate) problems.push(`${wp.id}: spec says gate ${header.gate}, pipeline.json says ${wp.gate}`);
    if (!same(header.deps, wp.deps)) problems.push(`${wp.id}: spec deps [${header.deps.join(", ")}] differ from pipeline.json [${wp.deps.join(", ")}]`);
    if (!same(header.owns, wp.owns)) problems.push(`${wp.id}: spec owns [${header.owns.join(", ")}] differ from pipeline.json [${wp.owns.join(", ")}]`);
  }
  for (const wp of p.packages) {
    for (const dep of wp.deps) if (!ids.has(dep)) problems.push(`${wp.id}: unknown dep ${dep}`);
  }
  // Cycles: repeatedly remove packages whose deps are all removed.
  const left = new Map(p.packages.map((wp) => [wp.id, wp]));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, wp] of left) {
      if (wp.deps.every((dep) => !left.has(dep))) {
        left.delete(id);
        changed = true;
      }
    }
  }
  if (left.size > 0) problems.push(`dependency cycle among: ${[...left.keys()].join(", ")}`);
  return problems;
}

function next(p: Pipeline, parallel: boolean): WorkPackage[] {
  const running = p.packages.filter((wp) => wp.status === "in_progress");
  if (!parallel) {
    if (running.length > 0) return [];
    const first = p.packages.find((wp) => isReady(p, wp));
    return first ? [first] : [];
  }
  const picked: WorkPackage[] = [];
  for (const wp of p.packages) {
    if (running.length + picked.length >= p.max_parallel) break;
    if (!isReady(p, wp)) continue;
    if ([...running, ...picked].some((other) => overlaps(wp, other))) continue;
    picked.push(wp);
  }
  return picked;
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: ROOT });
  if (result.exitCode !== 0) fail(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

const [command, ...rest] = process.argv.slice(2);
const pipeline = load();

switch (command) {
  case "check": {
    const problems = check(pipeline);
    for (const problem of problems) console.log(`PROBLEM ${problem}`);
    console.log(problems.length === 0 ? `OK ${pipeline.packages.length} work packages` : `${problems.length} problem(s)`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
  case "status": {
    const phases = new Map<string, Record<Status, number>>();
    for (const wp of pipeline.packages) {
      const phase = wp.id.split("-")[0]!;
      const row = phases.get(phase) ?? { todo: 0, in_progress: 0, merged: 0, blocked: 0 };
      row[wp.status] += 1;
      phases.set(phase, row);
    }
    for (const [phase, row] of phases) {
      console.log(`${phase}: merged ${row.merged}, in_progress ${row.in_progress}, blocked ${row.blocked}, todo ${row.todo}`);
    }
    for (const wp of pipeline.packages) {
      if (wp.status === "in_progress") console.log(`RUNNING ${wp.id} ${wp.title}`);
      if (wp.status === "blocked") console.log(`BLOCKED ${wp.id} ${wp.title}: ${wp.note ?? ""}`);
      if (wp.status === "todo" && wp.needs_user) console.log(`NEEDS_USER ${wp.id} ${wp.title}: ${wp.needs_user}`);
      if (wp.status === "todo" && wp.last) console.log(`LAST ${wp.id} ${wp.title}: starts when nothing else can still start`);
    }
    break;
  }
  case "next": {
    const ready = next(pipeline, rest.includes("--parallel"));
    if (ready.length === 0) {
      const running = pipeline.packages.filter((wp) => wp.status === "in_progress").map((wp) => wp.id);
      const todo = pipeline.packages.filter((wp) => wp.status === "todo").length;
      if (running.length > 0) console.log(`WAIT running: ${running.join(", ")}`);
      else if (todo === 0) console.log("DONE nothing left to start");
      else console.log("STUCK remaining packages are blocked, wait on a blocked dependency, or need the user (see: pipeline status)");
      break;
    }
    for (const wp of ready) console.log(`READY ${wp.id} [${wp.tier}, gate ${wp.gate}] ${wp.title}`);
    break;
  }
  case "start": {
    const wp = find(pipeline, rest[0]);
    if (!existsSync(join(BUILD_DIR, "wp", `${wp.id}.md`))) fail(`${wp.id} has no spec: write docs/v2/pipeline/wp/${wp.id}.md first (SPEC-WRITER.md)`);
    if (!isReady(pipeline, wp)) fail(`${wp.id} is not ready (status ${wp.status}, deps or needs_user)`);
    const clash = pipeline.packages.find((other) => other.status === "in_progress" && overlaps(wp, other));
    if (clash) fail(`${wp.id} overlaps files with running ${clash.id}`);
    wp.status = "in_progress";
    save(pipeline);
    console.log(`STARTED ${wp.id}`);
    console.log(`git worktree add .claude/worktrees/wp-${wp.id} -b wp/${wp.id} ${pipeline.integration_branch}`);
    console.log(`spec: docs/v2/pipeline/wp/${wp.id}.md`);
    break;
  }
  case "verify": {
    const wp = find(pipeline, rest[0]);
    const changed = git(["diff", "--name-only", `${pipeline.integration_branch}...wp/${wp.id}`])
      .split("\n")
      .filter(Boolean);
    const outside = changed.filter((file) => !wp.owns.some((prefix) => file.startsWith(prefix)));
    if (changed.length === 0) fail(`wp/${wp.id} has no changes`);
    for (const file of outside) console.log(`OUTSIDE ${file}`);
    console.log(outside.length === 0 ? `OK ${changed.length} changed file(s), all inside owns` : `${outside.length} file(s) outside owns`);
    process.exit(outside.length === 0 ? 0 : 1);
  }
  case "merged":
  case "block":
  case "reset": {
    const wp = find(pipeline, rest[0]);
    if (command === "merged") {
      wp.status = "merged";
      delete wp.note;
    } else if (command === "block") {
      wp.status = "blocked";
      wp.note = rest.slice(1).join(" ") || "no reason given";
    } else {
      wp.status = "todo";
      delete wp.note;
    }
    save(pipeline);
    console.log(`${wp.id} → ${wp.status}`);
    break;
  }
  case "show": {
    const wp = find(pipeline, rest[0]);
    console.log(JSON.stringify(wp, null, 2));
    break;
  }
  default:
    fail("usage: pipeline check|status|next [--parallel]|start <id>|verify <id>|merged <id>|block <id> <why>|reset <id>|show <id>");
}
