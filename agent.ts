import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, DetectedStack, FinishTaskPayload, RunLogEntry } from "./types.js";
import { listFiles, readFileTool, writeFileTool, runCommand, logEntry } from "./tools.js";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_files",
    description: "List files under a directory in the repo (relative to repo root), recursively up to 4 levels deep.",
    input_schema: {
      type: "object",
      properties: { dir: { type: "string", description: "Directory relative to repo root, e.g. 'src' or '.'" } },
      required: ["dir"],
    },
  },
  {
    name: "read_file",
    description: "Read a file's contents (relative path from repo root).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write a file (creates directories as needed). Use for generated test code and the manual test case markdown doc.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from repo root" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command from the repo root (e.g. 'npm test', 'python -m pytest -q'). Sandboxed with a timeout and a blocklist on destructive commands.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "finish_task",
    description: "Call this once analysis, test generation, and execution are complete, to report final results.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        stacksTested: { type: "array", items: { type: "string" } },
        automatedTestsWritten: { type: "array", items: { type: "string" } },
        manualTestDocPath: { type: "string" },
        testsPassed: { type: "integer" },
        testsFailed: { type: "integer" },
        knownGaps: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "stacksTested", "automatedTestsWritten", "manualTestDocPath", "testsPassed", "testsFailed", "knownGaps"],
    },
  },
];

function buildSystemPrompt(stacks: DetectedStack[], config: AgentConfig): string {
  const stackList = stacks.length
    ? stacks.map((s) => `- ${s.language} (marker: ${s.marker}, guessed framework: ${s.testFramework}, guessed command: ${s.testCommand})`).join("\n")
    : "- None detected automatically; inspect the repo yourself to determine language(s).";

  return `You are a QA engineering agent. You have been pointed at a real codebase at repo root "${config.repoRoot}".

Detected stacks (seed guesses only, verify them yourself):
${stackList}

Your job, in order:
1. Explore the repo (list_files, read_file) enough to understand its structure and identify testable units: public functions, API endpoints, CLI commands, UI components, critical business logic. You do not need to read every file — prioritize entry points, core logic, and anything with clear side effects or edge cases.
2. Write automated tests using the idiomatic test framework for each stack you find (e.g. Jest/Vitest for JS/TS, pytest for Python, go test for Go). Place them following that ecosystem's conventions (e.g. __tests__ or *.test.ts, test_*.py). Cover: happy path, boundary conditions, error handling, and any obviously untested branches.
3. Write a manual test case document as markdown at "${config.outputDir}/manual-test-cases.md". Include cases that automation struggles with: cross-browser/device behavior, visual/UX judgment calls, complex multi-step user flows, permissions/auth edge cases, and anything requiring human judgment. Each case: ID, preconditions, steps, expected result.
4. Run the automated suite(s) with run_command. If tests fail, decide whether the failure is a bug in the source code (report it, do not silently "fix" the test to hide it) or a mistake in your test (fix the test). Iterate, but do not loop indefinitely — you have a turn budget.
5. Call finish_task with an honest summary, including any parts of the codebase you could not cover and why (knownGaps).

Rules:
- Never modify source/application files, only test files and the manual test doc, unless a test setup file (config, fixtures) is clearly required — note any such changes explicitly in your summary.
- Prefer fewer, well-targeted tests over exhaustive boilerplate.
- If a test genuinely fails because of a real bug, keep the failing test (do not delete or weaken it) and flag the bug clearly in your summary.
- Be honest in finish_task about pass/fail counts — do not round up.`;
}

export async function runAgent(
  config: AgentConfig,
  stacks: DetectedStack[]
): Promise<{ result: FinishTaskPayload | null; log: RunLogEntry[] }> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const log: RunLogEntry[] = [];
  const system = buildSystemPrompt(stacks, config);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "Begin. Explore the repo, then generate and run tests as described in your instructions. Call finish_task when done.",
    },
  ];

  let finalResult: FinishTaskPayload | null = null;

  for (let turn = 1; turn <= config.maxTurns; turn++) {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      // Model stopped without calling finish_task — nudge once, then bail.
      if (!finalResult) {
        messages.push({
          role: "user",
          content: "You stopped without calling finish_task. If you are done, call finish_task now with your results.",
        });
        continue;
      }
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let outputText = "";
      let isError = false;
      try {
        switch (block.name) {
          case "list_files":
            outputText = await listFiles(config.repoRoot, (block.input as any).dir);
            break;
          case "read_file":
            outputText = readFileTool(config.repoRoot, (block.input as any).path);
            break;
          case "write_file":
            outputText = writeFileTool(config.repoRoot, (block.input as any).path, (block.input as any).content);
            break;
          case "run_command":
            outputText = await runCommand(config, (block.input as any).command);
            break;
          case "finish_task":
            finalResult = block.input as FinishTaskPayload;
            outputText = "Recorded final results.";
            break;
          default:
            outputText = `Unknown tool: ${block.name}`;
            isError = true;
        }
      } catch (err) {
        outputText = `ERROR: ${(err as Error).message}`;
        isError = true;
      }

      logEntry(log, { turn, toolName: block.name, input: block.input, outputSummary: outputText, isError });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: outputText,
        is_error: isError,
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (finalResult) break;
  }

  return { result: finalResult, log };
}
