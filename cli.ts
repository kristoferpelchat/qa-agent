#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { detectStacks } from "./detect.js";
import { runAgent } from "./agent.js";
import { writeReport } from "./report.js";
import type { AgentConfig } from "./types.js";

const program = new Command();

program
  .name("qa-agent")
  .description("Point at a repo. Get automated tests, manual test docs, and an execution report.")
  .argument("[repoPath]", "path to the repo to test", ".")
  .option("-m, --model <model>", "Claude model to use", "claude-sonnet-4-6")
  .option("--max-turns <n>", "max agentic turns before bailing out", "40")
  .option("--max-command-seconds <n>", "timeout per shell command", "180")
  .option("--output-dir <dir>", "where reports + generated docs land (relative to repo)", "qa-agent-output")
  .option("--dry-run", "do not actually execute test commands, just simulate", false)
  .action(async (repoPath: string, opts) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY is not set. Export it and re-run.");
      process.exit(1);
    }

    const config: AgentConfig = {
      repoRoot: resolve(repoPath),
      maxTurns: parseInt(opts.maxTurns, 10),
      maxCommandSeconds: parseInt(opts.maxCommandSeconds, 10),
      model: opts.model,
      outputDir: opts.outputDir,
      dryRun: Boolean(opts.dryRun),
    };

    console.log(`QA agent starting on ${config.repoRoot} (model: ${config.model}, dryRun: ${config.dryRun})`);

    const stacks = await detectStacks(config.repoRoot);
    console.log(`Detected ${stacks.length} stack(s): ${stacks.map((s) => s.language).join(", ") || "none"}`);

    const { result, log } = await runAgent(config, stacks);

    const reportPath = writeReport(config, stacks, result, log);
    console.log(`\nReport written to ${reportPath}`);

    if (!result) {
      console.error("Agent did not finish within the turn budget. See report for partial progress.");
      process.exit(1);
    }
    if (result.testsFailed > 0) {
      console.log(`\n${result.testsFailed} test(s) failed. See report for details.`);
      process.exit(1);
    }
    console.log("\nAll tests passed.");
  });

program.parseAsync(process.argv);
