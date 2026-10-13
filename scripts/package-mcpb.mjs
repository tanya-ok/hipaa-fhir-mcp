import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] ?? join(root, "hipaa-fhir-mcp.mcpb"));
const scratch = await mkdtemp(join(tmpdir(), "fhir-mcpb-"));
const stage = join(scratch, "extension");
const archive = join(scratch, "extension.mcpb");
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });
try {
  // Only these build inputs enter the temporary packaging directory.
  const emitted = execFileSync("pnpm", ["exec", "tsc", "--listEmittedFiles"], {
    cwd: root,
    encoding: "utf8",
  });
  for (const line of emitted.split("\n")) {
    if (!line.startsWith("TSFILE: ")) continue;
    const source = resolve(line.slice(8).trim());
    const path = relative(join(root, "dist"), source);
    if (!path || path.startsWith(".."))
      throw new Error("Unexpected compiler output");
    const destination = join(stage, "dist", path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  for (const name of [
    "package.json",
    "pnpm-lock.yaml",
    "manifest.json",
    "LICENSE",
  ]) {
    await copyFile(join(root, name), join(stage, name));
  }
  // Hoisted runtime dependencies work after ZIP extraction without pnpm's symlinks.
  run(
    "pnpm",
    [
      "install",
      "--prod",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--config.node-linker=hoisted",
    ],
    stage,
  );
  const pkg = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
  delete pkg.devDependencies;
  delete pkg.scripts;
  await writeFile(
    join(stage, "package.json"),
    `${JSON.stringify(pkg, null, 2)}\n`,
  );
  await rm(join(stage, "pnpm-lock.yaml"));
  await writeFile(
    join(stage, ".mcpbignore"),
    ".pnpm/**\nnode_modules/.pnpm/**\nnode_modules/.modules.yaml\nnode_modules/.pnpm-workspace-state-v1.json\n**/*.pem\n**/*.key\n**/.env*\n",
  );
  run(
    "pnpm",
    ["dlx", "@anthropic-ai/mcpb@2.1.2", "pack", stage, archive],
    stage,
  );
  run("python3", [join(root, "scripts/check-mcpb.py"), archive], root);
  // Refuse to overwrite an existing bundle; failed validation never delivers one.
  await copyFile(archive, output, constants.COPYFILE_EXCL);
  console.log(`Verified local MCP bundle: ${output}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
