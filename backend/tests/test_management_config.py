"""Persistent local Management credential configuration."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from auth import verify_password
import management_config
from setup_management import save_credentials


class ManagementConfigTests(unittest.TestCase):
    def test_setup_saves_salted_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            save_credentials("manager", "secret-one", path)
            first = management_config.load_local_credentials(path)
            self.assertEqual(first[management_config.USERNAME_KEY], "manager")
            self.assertTrue(verify_password("secret-one", first[management_config.PASSWORD_HASH_KEY]))
            self.assertFalse(verify_password("incorrect", first[management_config.PASSWORD_HASH_KEY]))
            self.assertNotIn("secret-one", path.read_text(encoding="utf-8"))
            save_credentials("manager", "secret-one", path)
            second = management_config.load_local_credentials(path)
            self.assertNotEqual(first[management_config.PASSWORD_HASH_KEY],
                                second[management_config.PASSWORD_HASH_KEY])
            with patch.object(management_config, "_local_credentials", second), \
                 patch.dict(os.environ, {}, clear=True):
                self.assertEqual(management_config.management_credentials(),
                                 ("manager", second[management_config.PASSWORD_HASH_KEY]))

    def test_config_path_is_relative_to_backend_module(self):
        self.assertEqual(management_config.CONFIG_PATH,
                         Path(management_config.__file__).resolve().parent / ".env")

    def test_explicit_environment_can_override_local_config(self):
        with patch.object(management_config, "_local_credentials", {
            management_config.USERNAME_KEY: "local",
            management_config.PASSWORD_HASH_KEY: "local-hash",
        }), patch.dict(os.environ, {
            management_config.USERNAME_KEY: "deployment",
            management_config.PASSWORD_HASH_KEY: "deployment-hash",
        }):
            self.assertEqual(management_config.management_credentials(),
                             ("deployment", "deployment-hash"))


if __name__ == "__main__":
    unittest.main()
