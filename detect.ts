import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import type { DetectedStack } from "./types.js";

// Each detector: marker file -> best-guess test command.
// The agent can still override these after reading the repo, this is just a seed.
const DETECTORS: Array<{
  marker: string;
  language: string;
  resolve: (repoRoot: string, markerPath: string) => DetectedStack;
}> = [
  {
    marker: "package.json",
    language: "JavaScript/TypeScript",
    resolve: (repoRoot, markerPath) => {
      let framework = "unknown (no test script found)";
      let cmd = "npm test";
      try {
        const pkg = JSON.parse(readFileSync(markerPath, "utf8"));
        const scripts = pkg.scripts ?? {};
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.vitest) framework = "vitest";
        else if (deps.jest) framework = "jest";
        else if (deps.mocha) framework = "mocha";
        else if (deps["@playwright/test"]) framework = "playwright";
        if (scripts.test) cmd = "npm test";
      } catch {
        /* leave defaults */
      }
      return { language: "JavaScript/TypeScript", marker: markerPath, testCommand: cmd, testFramework: framework };
    },
  },
  {
    marker: "requirements.txt",
    language: "Python",
    resolve: (_repoRoot, markerPath) => ({
      language: "Python",
      marker: markerPath,
      testCommand: "python -m pytest",
      testFramework: "pytest (assumed)",
    }),
  },
  {
    marker: "pyproject.toml",
    language: "Python",
    resolve: (_repoRoot, markerPath) => ({
      language: "Python",
      marker: markerPath,
      testCommand: "python -m pytest",
      testFramework: "pytest (assumed)",
    }),
  },
  {
    marker: "go.mod",
    language: "Go",
    resolve: (_repoRoot, markerPath) => ({
      language: "Go",
      marker: markerPath,
      testCommand: "go test ./...",
      testFramework: "go test",
    }),
  },
  {
    marker: "pom.xml",
    language: "Java",
    resolve: (_repoRoot, markerPath) => ({
      language: "Java",
      marker: markerPath,
      testCommand: "mvn -q test",
      testFramework: "JUnit via Maven",
    }),
  },
  {
    marker: "build.gradle",
    language: "Java/Kotlin",
    resolve: (_repoRoot, markerPath) => ({
      language: "Java/Kotlin",
      marker: markerPath,
      testCommand: "./gradlew test",
      testFramework: "JUnit via Gradle",
    }),
  },
  {
    marker: "Cargo.toml",
    language: "Rust",
    resolve: (_repoRoot, markerPath) => ({
      language: "Rust",
      marker: markerPath,
      testCommand: "cargo test",
      testFramework: "cargo test",
    }),
  },
  {
    marker: "Gemfile",
    language: "Ruby",
    resolve: (_repoRoot, markerPath) => ({
      language: "Ruby",
      marker: markerPath,
      testCommand: "bundle exec rspec",
      testFramework: "rspec (assumed)",
    }),
  },
];

export async function detectStacks(repoRoot: string): Promise<DetectedStack[]> {
  const found: DetectedStack[] = [];
  for (const detector of DETECTORS) {
    // search top-level and one level deep (monorepo-friendly, cheap)
    const matches = await fg([detector.marker, `*/${detector.marker}`], {
      cwd: repoRoot,
      absolute: true,
      onlyFiles: true,
      deep: 2,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
    });
    for (const m of matches) {
      if (existsSync(m)) found.push(detector.resolve(repoRoot, m));
    }
  }
  // de-dupe by language+marker
  const seen = new Set<string>();
  return found.filter((s) => {
    const key = `${s.language}:${s.marker}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
