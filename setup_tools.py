from pathlib import Path
import shutil

ROOT = Path(__file__).parent
TOOLS = ROOT / "tools"

TOOLS.mkdir(exist_ok=True)

files = {}

files["helpers.py"] = r'''
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

FRONTEND = PROJECT_ROOT / "frontend"

CSS = FRONTEND / "css"
JS = FRONTEND / "js"
COMPONENTS = FRONTEND / "components"

INDEX = FRONTEND / "index.html"
MAIN_CSS = CSS / "main.css"
APP_JS = JS / "app.js"


def read(path):
    return Path(path).read_text(
        encoding="utf-8",
        errors="ignore"
    )


def write(path, text):
    Path(path).parent.mkdir(
        parents=True,
        exist_ok=True
    )

    Path(path).write_text(
        text,
        encoding="utf-8"
    )


def banner(title):
    print("\n" + "="*60)
    print(title)
    print("="*60)
'''

files["analyzer.py"] = r'''
import re
from helpers import *

FUNCTION_PATTERN = re.compile(
    r"function\s+([A-Za-z0-9_]+)\s*\(",
    re.MULTILINE
)

EVENT_PATTERN = re.compile(
    r"addEventListener\s*\(\s*['\"](.*?)['\"]",
    re.MULTILINE
)

SUPABASE_PATTERN = re.compile(
    r"\.from\(\s*['\"](.*?)['\"]",
    re.MULTILINE
)

def analyze():

    banner("TransportDesk JavaScript Analyzer")

    js = read(APP_JS)

    functions = FUNCTION_PATTERN.findall(js)
    events = EVENT_PATTERN.findall(js)
    tables = SUPABASE_PATTERN.findall(js)

    print()

    print(f"Functions : {len(functions)}")

    for f in functions:
        print("  ", f)

    print()

    print(f"Events : {len(set(events))}")

    for e in sorted(set(events)):
        print("  ", e)

    print()

    print(f"Supabase Tables : {len(set(tables))}")

    for t in sorted(set(tables)):
        print("  ", t)
'''

files["builder.py"] = r'''
from helpers import *

def build():

    banner("Module Builder")

    print()

    print("Version 1")

    print()

    print("Ready for automatic module extraction.")
'''

files["dependency.py"] = r'''
from helpers import *

def graph():

    banner("Dependency Graph")

    print()

    print("Version 1")

    print()

    print("Dependency graph generation coming next.")
'''

files["migrate.py"] = r'''
import sys

from analyzer import analyze
from builder import build
from dependency import graph
from splitter import main as split


def usage():

    print("""

TransportDesk Migration Tool

Commands

split

analyze

build

graph

""")


if len(sys.argv) < 2:
    usage()
    quit()

cmd = sys.argv[1].lower()

if cmd == "split":
    split()

elif cmd == "analyze":
    analyze()

elif cmd == "build":
    build()

elif cmd == "graph":
    graph()

else:
    usage()
'''

for filename, content in files.items():
    (TOOLS / filename).write_text(
        content.strip() + "\n",
        encoding="utf-8"
    )

old = TOOLS / "split_frontend.py"
new = TOOLS / "splitter.py"

if old.exists() and not new.exists():
    shutil.copy2(old, new)

print()

print("="*60)
print("TransportDesk Toolchain Installed")
print("="*60)

print()

for f in sorted(TOOLS.glob("*.py")):
    print("✓", f.name)

print()