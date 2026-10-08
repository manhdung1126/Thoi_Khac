"""CLI exposure guard; existing localhost/auth/storage behavior is unchanged."""
import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import run


class StartupTests(unittest.TestCase):
    def invoke(self, args, pin=None):
        environment = {} if pin is None else {"CLOUD_ADMIN_PIN": pin}
        output = io.StringIO()
        with patch.dict(os.environ, environment, clear=True), \
             patch.object(sys, "argv", ["run.py", *args]), \
             patch("run.uvicorn.run") as server, \
             patch("run.socket.socket", side_effect=OSError), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                run.main()
                code = 0
            except SystemExit as error:
                code = error.code
        return code, output.getvalue(), server

    def test_lan_refuses_missing_blank_and_development_pin_before_start(self):
        for pin in (None, "", "   ", "2468", " 2468 "):
            with self.subTest(pin=pin):
                code, output, server = self.invoke(["--lan"], pin)
                self.assertEqual(code, 2)
                self.assertIn("CLOUD_ADMIN_PIN", output)
                server.assert_not_called()

    def test_custom_lan_pin_starts_server_without_disclosing_secret(self):
        code, output, server = self.invoke(["--lan"], "private-test-pin")
        self.assertEqual(code, 0)
        self.assertIn("THỜI KHẮC", output)
        self.assertNotIn("private-test-pin", output)
        server.assert_called_once()
        self.assertEqual(server.call_args.args, ("backend.app.main:app",))
        self.assertEqual(server.call_args.kwargs["host"], "0.0.0.0")

    def test_localhost_development_still_starts_without_custom_pin(self):
        for pin in (None, "2468"):
            with self.subTest(pin=pin):
                code, _, server = self.invoke([], pin)
                self.assertEqual(code, 0)
                self.assertEqual(server.call_args.kwargs["host"], "127.0.0.1")
                self.assertEqual(server.call_args.kwargs["port"], 8000)
                self.assertFalse(server.call_args.kwargs["reload"])

    def test_custom_port_and_reload_options_are_preserved(self):
        code, _, server = self.invoke(["--lan", "--port", "8001", "--reload"], "private-test-pin")
        self.assertEqual(code, 0)
        self.assertEqual(server.call_args.kwargs["port"], 8001)
        self.assertTrue(server.call_args.kwargs["reload"])
        self.assertEqual(server.call_args.kwargs["reload_dirs"],
                         [str(Path(run.__file__).resolve().parent / "backend" / "app")])

    def test_lan_rejection_leaves_storage_untouched_in_real_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / "must-not-be-created"
            environment = {**os.environ, "CLOUD_STORAGE_DIR": str(storage)}
            environment.pop("CLOUD_ADMIN_PIN", None)
            result = subprocess.run([sys.executable, str(Path(run.__file__)), "--lan"],
                                    env=environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 2)
            self.assertIn("CLOUD_ADMIN_PIN", result.stderr)
            self.assertNotIn("Started server", result.stderr)
            self.assertFalse(storage.exists())
