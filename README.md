# qa-agent

An agentic QA tool: point it at any repo, it explores the code, writes automated tests
in the idiomatic framework for whatever language(s) it finds, writes a manual test-case
checklist for things automation can't judge well, runs the automated suite, iterates on
failures, and produces one consolidated report.

## How it works

1. **`detect.ts`** — cheap, fast marker-file scan (`package.json`, `requirements.txt`,
   `go.mod`, etc.) to seed the agent with a guess at each stack's test framework and
   command. This is a *seed*, not a source of truth — the agent verifies by reading the
   repo itself.
2. **`agent.ts`** — the agentic loop. Claude gets five tools: `list_files`, `read_file`,
   `write_file`, `run_command`, `finish_task`. It explores, writes tests + a manual test
   doc, runs the suite, and iterates on failures within a turn budget (`--max-turns`,
   default 40) so it can't run away.
3. **`tools.ts`** — guardrails live here:
   - `run_command` is sandboxed to the repo root, has a timeout, and refuses commands
     matching a blocklist (`rm -rf`, `sudo`, force-pushes, publish commands, etc.).
   - File reads/writes are path-checked so the agent can't escape the repo root.
   - `--dry-run` simulates command execution without running anything, useful for a
     first look at what the agent *would* do.
4. **`report.ts`** — writes `qa-agent-output/qa-agent-report.md`: pass/fail counts,
   files written, known gaps the agent flagged itself, and a full tool-call log.
5. **`.github/workflows/qa-agent.yml`** — runs the above on every PR and posts the
   report as a PR comment plus an uploaded artifact.

## Usage

```bash
npm install
npm run build
export ANTHROPIC_API_KEY=sk-ant-...
node dist/cli.js /path/to/target/repo
```

Options:

| Flag | Default | Purpose |
|---|---|---|
| `-m, --model` | `claude-sonnet-4-6` | Which Claude model drives the agent |
| `--max-turns` | 40 | Hard cap on agentic tool-call turns |
| `--max-command-seconds` | 180 | Timeout per shell command |
| `--output-dir` | `qa-agent-output` | Where the report + manual test doc land |
| `--dry-run` | off | Simulate `run_command` instead of executing |

## Design choices worth knowing about

- **The agent never touches source files**, only test files and its own output
  directory — this is a system-prompt rule, reinforced by asking it to flag any
  exception explicitly in `knownGaps` rather than doing it silently.
- **Failing tests are not "fixed" by weakening them.** The system prompt explicitly
  tells the agent to distinguish "my test is wrong" from "the code has a real bug,"
  and to keep failing tests that reveal a real bug rather than deleting them.
- **Turn budget, not trust, bounds runaway loops.** Even if the model tries to iterate
  forever chasing a flaky test, `--max-turns` cuts it off and the report says so.
- **Command execution is a blocklist, not a sandbox VM.** For anything beyond a trusted
  CI runner, consider running this inside a container with no credentials/secrets
  beyond `ANTHROPIC_API_KEY`.

## Extending

- Add a new stack: append a detector in `detect.ts` (marker file → guessed command).
- Change what "manual test case" means for your team: edit the relevant paragraph in
  `agent.ts`'s `buildSystemPrompt` — that's the only place test-writing behavior is
  specified.
- Multi-repo/monorepo support: `detect.ts` already searches one level deep for markers;
  extend `deep` if you need more nesting.
