"""Check the complete ZIP payload, without extracting or printing file contents."""
import json
import stat
import sys
import zipfile
from pathlib import PurePosixPath


def verify(archive):
    required = {"manifest.json", "package.json", "LICENSE", "dist/server.js"}
    roots = {"manifest.json", "package.json", "LICENSE", "dist", "node_modules"}
    forbidden = {".git", ".beads", ".dolt", ".data", ".venv", ".venv-docs", "site", ".cache", ".modules.yaml", ".pnpm-workspace-state-v1.json", ".package-lock.json"}
    with zipfile.ZipFile(archive) as bundle:
        seen = set()
        for entry in bundle.infolist():
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                    or not path.parts or path.parts[0] not in roots
                    or forbidden.intersection(path.parts)
                    or any(p.startswith(".env") for p in path.parts)
                    or path.suffix in {".db", ".pem", ".key"}
                    or stat.S_ISLNK(entry.external_attr >> 16)
                    or entry.filename in seen):
                raise ValueError("Bundle contains a refused path or symlink")
            seen.add(entry.filename)
        if not required.issubset(seen):
            raise ValueError("Bundle lacks required runtime files")
        manifest = json.loads(bundle.read("manifest.json"))
        package = json.loads(bundle.read("package.json"))
        if manifest["version"] != package["version"]:
            raise ValueError("Bundle versions differ")
        if manifest["server"]["entry_point"] != "dist/server.js":
            raise ValueError("Unexpected bundle entry point")
        if "devDependencies" in package or "scripts" in package:
            raise ValueError("Development metadata must not ship")
        if "node_modules/@modelcontextprotocol/sdk/package.json" not in seen:
            raise ValueError("Runtime dependencies are missing")
        return len(seen)


if __name__ == "__main__":
    print(json.dumps({"archive_entries": verify(sys.argv[1]), "payload_gate": "passed"}))
