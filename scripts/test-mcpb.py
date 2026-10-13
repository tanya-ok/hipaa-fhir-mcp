"""Negative archive cases for the Desktop bundle boundary."""
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("gate", Path(__file__).with_name("check-mcpb.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class PayloadGate(unittest.TestCase):
    def check_payload(self, extra=None, development=False):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "bundle.mcpb"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("manifest.json", json.dumps({"version": "0.3.0", "server": {"entry_point": "dist/server.js"}}))
                package = {"version": "0.3.0"}
                if development:
                    package["devDependencies"] = {"example": "1"}
                bundle.writestr("package.json", json.dumps(package))
                bundle.writestr("LICENSE", "Synthetic fixture")
                bundle.writestr("dist/server.js", "// Synthetic fixture")
                bundle.writestr("node_modules/@modelcontextprotocol/sdk/package.json", "{}")
                if extra:
                    bundle.writestr(extra, "synthetic refused payload")
            return gate.verify(archive)

    def test_minimal_payload(self):
        self.assertEqual(self.check_payload(), 5)

    def test_private_and_unexpected_paths(self):
        for path in [".beads/issues.jsonl", "dist/.env", "dist/token.key", "dist/state.db", "site/index.html", "node_modules/pkg/.git/config", "node_modules/.modules.yaml", "node_modules/.pnpm-workspace-state-v1.json"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.check_payload(path)

    def test_traversal(self):
        for path in ["../outside", "/absolute", "dist/../outside", "dist\\outside"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.check_payload(path)

    def test_symlink(self):
        link = zipfile.ZipInfo("dist/link")
        link.create_system = 3
        link.external_attr = 0o120777 << 16
        with self.assertRaises(ValueError):
            self.check_payload(link)

    def test_development_metadata(self):
        with self.assertRaises(ValueError):
            self.check_payload(development=True)


if __name__ == "__main__":
    unittest.main()
