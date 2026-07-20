import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentConfig, DetectedStack, FinishTaskPayload, RunLogEntry } from "./types.js";

export function writeReport(
  config: AgentConfig,
  stacks: DetectedStack[],
  result: FinishTaskPayload | null,
  log: RunLogEntry[]
): string {
  const reportPath = join(config.repoRoot, config.outputDir, "qa-agent-report.md");
  mkdirSync(dirname(reportPath), { recursive: true });

  const lines: string[] = [];
  lines.push(`# QA Agent Report`);
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");

  lines.push(`## Detected stacks`);
  if (stacks.length === 0) lines.push("- None detected via markers; agent inspected repo manually.");
  for (const s of stacks) lines.push(`- **${s.language}** — framework: ${s.testFramework}, seed command: \`${s.testCommand}\``);
  lines.push("");

  if (!result) {
    lines.push(`## ⚠️ Incomplete run`);
    lines.push(
      `The agent did not call finish_task before hitting its turn budget (${config.maxTurns}). Check the run log below and consider raising --max-turns.`
    );
  } else {
    lines.push(`## Summary`);
    lines.push(result.summary);
    lines.push("");
    lines.push(`## Results`);
    lines.push(`- ✅ Passed: **${result.testsPassed}**`);
    lines.push(`- ❌ Failed: **${result.testsFailed}**`);
    lines.push(`- Stacks tested: ${result.stacksTested.join(", ") || "none"}`);
    lines.push("");
    lines.push(`## Automated tests written`);
    for (const f of result.automatedTestsWritten) lines.push(`- \`${f}\``);
    if (result.automatedTestsWritten.length === 0) lines.push("- (none)");
    lines.push("");
    lines.push(`## Manual test cases`);
    lines.push(`See [\`${result.manualTestDocPath}\`](./${result.manualTestDocPath.replace(config.outputDir + "/", "")})`);
    lines.push("");
    lines.push(`## Known gaps`);
    for (const g of result.knownGaps) lines.push(`- ${g}`);
    if (result.knownGaps.length === 0) lines.push("- None reported.");
  }

  lines.push("");
  lines.push(`## Run log (${log.length} tool calls)`);
  lines.push("| Turn | Tool | Status | Summary |");
  lines.push("|---|---|---|---|");
  for (const e of log) {
    const summary = e.outputSummary.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 120);
    lines.push(`| ${e.turn} | ${e.toolName} | ${e.isError ? "❌" : "✅"} | ${summary} |`);
  }

  writeFileSync(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}
