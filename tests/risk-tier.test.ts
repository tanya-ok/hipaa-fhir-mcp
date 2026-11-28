import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = new URL("../scripts/risk-tier.mjs", import.meta.url).pathname;

function run(paths: string[], agent = false) {
  const res = spawnSync(
    process.execPath,
    [script, "--stdin", ...(agent ? ["--agent"] : [])],
    { input: paths.join("\n"), encoding: "utf8" },
  );
  return { status: res.status, out: JSON.parse(res.stdout), err: res.stderr };
}

describe("risk-tier", () => {
  it("rates docs only as T0", () => {
    expect(run(["README.md", "docs/demo.md", "CHANGELOG.md"]).out.tier).toBe(
      "T0",
    );
  });

  it("rates a template tool change as T1", () => {
    const r = run(["src/fhir/client.ts", "tests/tools.test.ts"]);
    expect(r.out.tier).toBe("T1");
    expect(r.out.forbidden).toEqual([]);
  });

  it("rates grants, registration and config as T2", () => {
    for (const p of [
      "src/security/patient-policy.ts",
      "src/mcp.ts",
      "src/config.ts",
      "manifest.json",
    ]) {
      expect(run([p]).out.tier).toBe("T2");
    }
  });

  it("fails closed on an unknown path", () => {
    expect(run(["something/new.ts"]).out.tier).toBe("T2");
  });

  it("lets humans touch forbidden paths but blocks agents", () => {
    const paths = [".github/workflows/ci.yml", "src/fhir/client.ts"];
    expect(run(paths).status).toBe(0);
    const agent = run(paths, true);
    expect(agent.status).toBe(1);
    expect(agent.out.forbidden).toEqual([".github/workflows/ci.yml"]);
    expect(agent.err).toContain("agents may not edit .github/workflows/ci.yml");
  });

  it("blocks agents from dependency, release and audit files", () => {
    for (const p of [
      "package.json",
      "pnpm-lock.yaml",
      "server.json",
      "src/audit/logger.ts",
      "scripts/check-phi.mjs",
      "scripts/risk-tier.mjs",
      "docs/agents/adding-a-tool.md",
    ]) {
      expect(run([p], true).status).toBe(1);
    }
  });
});

describe("assertionDelta", async () => {
  const { assertionDelta } = await import("../scripts/risk-tier.mjs");

  it("counts removed assertions in tests only", () => {
    const diff = [
      "+++ b/tests/a.test.ts",
      "-    expect(a).toBe(1);",
      "-    expect(b).toBe(2);",
      "+    expect(a).toBe(1);",
      "+++ b/src/x.ts",
      "-    expect(c);",
    ].join("\n");
    expect(assertionDelta(diff)).toBe(-1);
  });
});
