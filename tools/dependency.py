from helpers import *
import re

CALL_PATTERN = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\s*\(')
FUNCTION_PATTERN = re.compile(
    r'function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{',
    re.MULTILINE
)


def extract_functions(js):

    funcs = []

    matches = list(FUNCTION_PATTERN.finditer(js))

    for i, match in enumerate(matches):

        name = match.group(1)

        start = match.end()

        end = matches[i+1].start() if i+1 < len(matches) else len(js)

        body = js[start:end]

        funcs.append((name, body))

    return funcs


def graph():

    banner("Dependency Graph")

    js = read(APP_JS)

    funcs = extract_functions(js)

    names = {f[0] for f in funcs}

    print()

    for name, body in funcs:

        calls = []

        for c in CALL_PATTERN.findall(body):

            if c in names and c != name:

                calls.append(c)

        calls = sorted(set(calls))

        print(name)

        if calls:

            for c in calls:

                print(f"   └── {c}")

        else:

            print("   └── (no internal dependencies)")

        print()