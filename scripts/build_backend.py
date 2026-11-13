"""Freeze the Python engine for the current platform/architecture (no cross-freeze)."""
from pathlib import Path
import os
import subprocess
import sys
import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--distpath', default='build/backend')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
cmd = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
       '--name', 'surveyapps-backend', '--distpath', str(root/args.distpath),
       '--workpath', str(root/'build/pyinstaller'), '--specpath', str(root/'build'),
       '--collect-all', 'dash', '--collect-all', 'plotly', '--collect-all', 'narwhals',
       '--copy-metadata', 'dash', '--copy-metadata', 'plotly',
       '--add-data', f"{root / 'backend' / 'assets'}{os.pathsep}assets",
       str(root/'backend/server.py')]
subprocess.run(cmd, cwd=root, check=True)
