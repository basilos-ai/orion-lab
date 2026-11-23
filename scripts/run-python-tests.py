"""Run the application tests with a disposable device state directory."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


if __name__ == '__main__':
    tests = Path(__file__).resolve().parents[1] / 'tests'
    with TemporaryDirectory(prefix='orion-python-tests-') as home:
        with patch.object(Path, 'home', return_value=Path(home)):
            suite = unittest.defaultTestLoader.discover(str(tests), pattern='test_*.py')
            result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
