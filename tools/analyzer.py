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
