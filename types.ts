export interface AgentConfig {
  repoRoot: string;
  maxTurns: number;
  maxCommandSeconds: number;
  model: string;
  outputDir: string; // where reports + generated tests land, relative to repoRoot
  dryRun: boolean; // if true, run_command is simulated, nothing executes
}

export interface DetectedStack {
  language: string;
  marker: string; // the file that identified it, e.g. package.json
  testCommand: string; // best-guess command to run its test suite
  testFramework: string;
}

export interface FinishTaskPayload {
  summary: string;
  stacksTested: string[];
  automatedTestsWritten: string[]; // file paths
  manualTestDocPath: string;
  testsPassed: number;
  testsFailed: number;
  knownGaps: string[]; // things the agent could not cover automatically
}

export interface RunLogEntry {
  turn: number;
  toolName: string;
  input: unknown;
  outputSummary: string;
  isError: boolean;
}
