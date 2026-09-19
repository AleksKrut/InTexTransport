"""Installer safety and generated-configuration checks, standard library only."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("wizard", ROOT / "scripts/install_wizard.py")
wizard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wizard)


def plan(**changes):
    return dict(bind="192.168.1.50", web_port=8080,
                protocols=["teltonika", "wialon"], external="", **changes)


class InstallerTests(unittest.TestCase):
    def test_address_validation_rejects_urls_and_command_injection(self):
        for value in ("https://gps.example.com", "gps.example.com:5055", "x\ny",
                      "$(touch /tmp/a)", "0.0.0.0", "127.0.0.1", "999.1.1.1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                wizard.validate_host(value)
        self.assertEqual(wizard.validate_host("GPS.Example.com."), "gps.example.com")
        self.assertEqual(wizard.validate_host("192.168.1.50"), "192.168.1.50")

    def test_plan_must_bind_an_actual_interface(self):
        with self.assertRaises(ValueError):
            wizard.validate_plan(plan(), ["192.168.1.51"])
        wizard.validate_plan(plan(), ["192.168.1.50"])

    def test_web_port_cannot_conflict_with_selected_protocol_or_api(self):
        for port in (5027, 8082, 0, 65536):
            values = plan()
            values["web_port"] = port
            with self.subTest(port=port), self.assertRaises(ValueError):
                wizard.validate_plan(values, ["192.168.1.50"])

    def test_generated_bootstrap_never_publishes_lan(self):
        config = wizard.render_override(plan(), bootstrap=True)
        self.assertNotIn("192.168.1.50", config)
        self.assertIn("127.0.0.1:8080:80/tcp", config)
        self.assertIn("127.0.0.1:5027:5027/tcp", config)
        self.assertEqual(config.count("!override"), 2)
        self.assertNotIn("5055", config)

    def test_final_ports_match_only_selected_protocols(self):
        config = wizard.render_override(plan())
        self.assertIn("192.168.1.50:5039:5039/tcp", config)
        self.assertIn('WIALON_PORT: "5039"', config)
        self.assertIn("127.0.0.1:8082:8082/tcp", config)
        self.assertNotIn("5055", config)

    def test_existing_password_is_preserved_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shutil.copy(ROOT / ".env.example", root)
            self.assertTrue(wizard.ensure_env(root))
            original = (root / ".env").read_bytes()
            self.assertFalse(wizard.ensure_env(root))
            self.assertEqual((root / ".env").read_bytes(), original)
            password = original.split(b"POSTGRES_PASSWORD=")[1].strip()
            self.assertEqual(len(password), 64)

    def test_empty_existing_password_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".env").write_text("POSTGRES_PASSWORD=\n")
            with self.assertRaises(ValueError):
                wizard.ensure_env(root)
            self.assertEqual((root / ".env").read_text(), "POSTGRES_PASSWORD=\n")

    def test_foreign_override_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "compose.override.yaml"
            target.write_text("services: {}\n")
            with self.assertRaises(ValueError):
                wizard.write_override(root, plan())
            self.assertEqual(target.read_text(), "services: {}\n")

    def test_own_override_can_resume_from_bootstrap(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            wizard.write_override(root, plan(), bootstrap=True)
            wizard.write_override(root, plan())
            self.assertEqual((root / "compose.override.yaml").read_text(),
                             wizard.render_override(plan()))

    def test_existing_admin_is_not_recreated(self):
        with patch.object(wizard, "api", return_value={"newServer": False, "registration": False}) as api:
            wizard.bootstrap_admin()
        api.assert_called_once_with("/server")

    def test_existing_open_registration_stops_before_lan(self):
        with patch.object(wizard, "api", return_value={"newServer": False, "registration": True}):
            with self.assertRaises(ValueError):
                wizard.bootstrap_admin()

    def test_admin_bootstrap_authenticates_before_completing(self):
        calls = []
        def api(path, body=None, form=False, method=None):
            calls.append((path, body, method))
            if path == "/server":
                return {"newServer": len(calls) == 1, "registration": False}
            if path == "/session" and body:
                return {"administrator": True}
            return {}
        with patch.object(wizard, "api", side_effect=api), \
             patch("builtins.input", side_effect=["Admin", "admin@example.test"]), \
             patch.object(wizard.getpass, "getpass", return_value="test-password-123"):
            self.assertEqual(wizard.bootstrap_admin(), "admin@example.test")
        self.assertEqual(sum(path == "/users" for path, _, _ in calls), 1)
        self.assertEqual(calls[-1], ("/session", None, "DELETE"))

    def test_summary_distinguishes_lan_from_external_and_contains_no_password(self):
        values = plan()
        values["external"] = "203.0.113.5"
        report = wizard.summary(values, "admin@example.test")
        self.assertIn("http://192.168.1.50:8080", report)
        self.assertIn("203.0.113.5:5027", report)
        self.assertIn("не подтверждение доступности", report)
        self.assertNotIn("POSTGRES_PASSWORD", report)

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose is not installed locally")
    def test_real_compose_merge_does_not_leak_default_ports(self):
        if subprocess.run(["docker", "compose", "version"], capture_output=True).returncode:
            self.skipTest("Docker Compose plugin not installed")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            env = root / ".env"
            env.write_text("POSTGRES_PASSWORD=test-only-not-used\n")
            override = root / "override.yaml"
            for bootstrap in (True, False):
                override.write_text(wizard.render_override(plan(), bootstrap=bootstrap))
                command = ["docker", "compose", "--project-directory", str(ROOT),
                    "--env-file", str(env), "-f", str(ROOT / "compose.yaml"),
                    "-f", str(override), "config", "--format", "json"]
                result = subprocess.run(command, check=True, capture_output=True, text=True)
                services = json.loads(result.stdout)["services"]
                ports = services["traccar"]["ports"]
                self.assertEqual({int(p["published"]) for p in ports}, {8082, 5027, 5039})
                expected = "127.0.0.1" if bootstrap else "192.168.1.50"
                self.assertEqual(services["web"]["ports"][0]["host_ip"], expected)
                for port in ports:
                    self.assertEqual(port["host_ip"], "127.0.0.1" if int(port["published"]) == 8082 else expected)


if __name__ == "__main__":
    unittest.main()
