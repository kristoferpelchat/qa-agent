import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import fg from "fast-glob";
import type { AgentConfig, RunLogEntry } from "./types.js";

// --- Safety guardrails -----------------------------------------------------
// Commands the agent is never allowed to run, regardless of framing.
const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{.*\};/, // fork bomb shape
  /\bcurl\b.*\|\s*sh\b/i,
  /\bwget\b.*\|\s*sh\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+reset\s+--hard\b.*origin/i,
  /\bshutdown\b|\breboot\b/i,
  />\s*\/dev\/sd/i,
  /\bnpm\s+publish\b/i,
  /\bcargo\s+publish\b/i,
];

function assertWithinRepo(repoRoot: string, targetPath: string): string {
  const resolved = isAbsolute(targetPath) ? normalize(targetPath) : normalize(join(repoRoot, targetPath));
  const rel = relative(repoRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes repo root, refusing: ${targetPath}`);
  }
  return resolved;
}

function isBlocked(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return pattern.source;
  }
  return null;
}

// --- Tool: list_files --------------------------------------------------
export async function listFiles(repoRoot: string, dir: string): Promise<string> {
  const target = assertWithinRepo(repoRoot, dir || ".");
  const entries = await fg(["**/*"], {
    cwd: target,
    onlyFiles: true,
    dot: false,
    deep: 4,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/.venv/**"],
  });
  return entries.slice(0, 500).join("\n") || "(no files found)";
}

// --- Tool: read_file -----------------------------------------------------
export function readFileTool(repoRoot: string, path: string): string {
  const target = assertWithinRepo(repoRoot, path);
  try {
    const content = readFileSync(target, "utf8");
    // Cap what we feed back to keep context sane on huge files.
    return content.length > 20000 ? content.slice(0, 20000) + "\n...[truncated]" : content;
  } catch (err) {
    return `ERROR reading ${path}: ${(err as Error).message}`;
  }
}

// --- Tool: write_file ------------------------------------------------------
export function writeFileTool(repoRoot: string, path: string, content: string): string {
  const target = assertWithinRepo(repoRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  return `Wrote ${content.length} bytes to ${path}`;
}

// --- Tool: run_command -------------------------------------------------
export function runCommand(config: AgentConfig, command: string): Promise<string> {
  return new Promise((resolve) => {
    const blockedBy = isBlocked(command);
    if (blockedBy) {
      resolve(`REFUSED: command matched a blocked pattern (${blockedBy}). Not executed.`);
      return;
    }
    if (config.dryRun) {
      resolve(`[dry-run] would execute: ${command}`);
      return;
    }
    const timeoutMs = config.maxCommandSeconds * 1000;
    execFile(
      "/bin/sh",
      ["-c", command],
      { cwd: config.repoRoot, timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const out = (stdout + "\n" + stderr).trim();
        const capped = out.length > 8000 ? out.slice(0, 8000) + "\n...[truncated]" : out;
        if (error) {
          resolve(`EXIT CODE ${error.code ?? "unknown"}\n${capped}`);
        } else {
          resolve(capped || "(command produced no output, exit 0)");
        }
      }
    );
  });
}

export function logEntry(log: RunLogEntry[], entry: RunLogEntry) {
  log.push(entry);
  const status = entry.isError ? "ERROR" : "ok";
  console.log(`  [turn ${entry.turn}] ${entry.toolName} (${status}): ${entry.outputSummary.slice(0, 160)}`);
}
