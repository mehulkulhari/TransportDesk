"""AST-aware (token based) primitives for the TransportDesk JS migration.

The project intentionally uses no third-party parser: the scanner understands
comments, strings, regex literals and template literals, so braces in any of
those constructs cannot make a function extraction drift.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterable

IDENT = re.compile(r"[A-Za-z_$][\w$]*")
KEYWORDS = {
    "as", "async", "await", "break", "case", "catch", "class", "const",
    "continue", "debugger", "default", "delete", "do", "else", "export",
    "extends", "false", "finally", "for", "from", "function", "get", "if",
    "import", "in", "instanceof", "let", "new", "null", "of", "return",
    "set", "static", "super", "switch", "this", "throw", "true", "try",
    "typeof", "undefined", "var", "void", "while", "with", "yield",
}


@dataclass(frozen=True)
class Function:
    name: str
    start: int
    end: int
    text: str
    params: tuple[str, ...]


def _skip_string(text: str, i: int, quote: str) -> int:
    i += 1
    while i < len(text):
        if text[i] == "\\":
            i += 2
        elif text[i] == quote:
            return i + 1
        else:
            i += 1
    return i


def _skip_regex(text: str, i: int) -> int:
    """Skip a JavaScript regular-expression literal beginning at ``/``."""
    i += 1; in_class = False
    while i < len(text):
        if text[i] == "\\": i += 2; continue
        if text[i] == "[": in_class = True
        elif text[i] == "]": in_class = False
        elif text[i] == "/" and not in_class:
            i += 1
            while i < len(text) and text[i].isalpha(): i += 1
            return i
        elif text[i] == "\n": return i
        i += 1
    return i


def _skip_template(text: str, i: int) -> int:
    # A template expression is scanned as normal JavaScript until its matching }.
    i += 1
    while i < len(text):
        if text[i] == "\\":
            i += 2; continue
        if text[i] == "`":
            return i + 1
        if text.startswith("${", i):
            # Interpolations can themselves contain nested template strings.
            # If the source uses a construct our small scanner cannot balance,
            # treat the complete literal as opaque instead of risking a split.
            try:
                end = matching(text, i + 1, "{", "}")
                i = end + 1
            except ValueError:
                i += 2
        else:
            i += 1
    return i


def _skip_comment_or_literal(text: str, i: int) -> int:
    if text.startswith("//", i):
        end = text.find("\n", i + 2)
        return len(text) if end < 0 else end + 1
    if text.startswith("/*", i):
        end = text.find("*/", i + 2)
        return len(text) if end < 0 else end + 2
    if text[i] in "'\"": return _skip_string(text, i, text[i])
    if text[i] == "`": return _skip_template(text, i)
    # A slash after an operator/opening delimiter begins a regex literal. This
    # distinction prevents /"/g from being mistaken for a quoted string.
    if text[i] == "/":
        prev = i - 1
        while prev >= 0 and text[prev].isspace(): prev -= 1
        if prev < 0 or text[prev] in "([{:;,=!?&|+-*~%^<>":
            return _skip_regex(text, i)
    return i


def matching(text: str, start: int, opening: str = "{", closing: str = "}") -> int:
    """Return index of the matching delimiter; fail loudly on invalid JS."""
    if start >= len(text) or text[start] != opening:
        raise ValueError(f"expected {opening!r} at {start}")
    depth, i = 1, start + 1
    while i < len(text):
        j = _skip_comment_or_literal(text, i)
        if j != i:
            i = j; continue
        if text[i] == opening: depth += 1
        elif text[i] == closing:
            depth -= 1
            if not depth: return i
        i += 1
    raise ValueError(f"unclosed {opening!r} beginning at {start}")


def _line_start(text: str, pos: int) -> int:
    return text.rfind("\n", 0, pos) + 1


def _parameters(header: str) -> tuple[str, ...]:
    match = re.search(r"\((.*)\)", header, re.S)
    if not match: return ()
    return tuple(x for x in IDENT.findall(match.group(1)) if x not in KEYWORDS)


def extract_functions(text: str) -> list[Function]:
    """Extract top-level named function declarations using structural scanning."""
    found: list[Function] = []
    level = 0; i = 0
    pattern = re.compile(r"(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")
    while i < len(text):
        j = _skip_comment_or_literal(text, i)
        if j != i: i = j; continue
        ch = text[i]
        if ch == "{": level += 1; i += 1; continue
        if ch == "}": level = max(0, level - 1); i += 1; continue
        if level == 0:
            match = pattern.match(text, i)
            if match:
                body_open = text.find("{", match.end())
                if body_open < 0: raise ValueError(f"no body for {match.group(1)}")
                end = matching(text, body_open) + 1
                begin = _line_start(text, i)
                found.append(Function(match.group(1), begin, end, text[begin:end],
                                      _parameters(text[i:body_open])))
                i = end; continue
        i += 1
    return found


def blank_ranges(text: str, ranges: Iterable[tuple[int, int]]) -> str:
    chars = list(text)
    for begin, end in ranges:
        for i in range(begin, end):
            if chars[i] != "\n": chars[i] = " "
    return "".join(chars)


def identifiers(text: str) -> set[str]:
    """Identifiers outside comments/literals, adequate for dependency reporting."""
    names: set[str] = set(); i = 0
    while i < len(text):
        j = _skip_comment_or_literal(text, i)
        if j != i: i = j; continue
        match = IDENT.match(text, i)
        if match:
            word = match.group(0)
            if word not in KEYWORDS: names.add(word)
            i = match.end()
        else: i += 1
    return names


MODULES = (
    "utils", "maps", "dashboard", "students", "pickup", "temporary", "routes",
    "reports", "buspage", "admission", "ask", "bulk",
)

RULES = {
    "utils": ("fetchall", "toast", "hav", "esc", "rs", "rupee", "norm", "pick", "digits", "isodate", "table", "reptable", "statcard"),
    "maps": ("google", "baselayer", "editmap", "setpin", "routemap", "mapchecked", "fitmap", "togglebus", "isolate", "orderstops"),
    "dashboard": ("dashboard",),
    "students": ("student", "history"),
    "pickup": ("pickup",),
    "temporary": ("temp",),
    "routes": ("route",),
    "reports": ("report", "geography", "heat", "repcsv"),
    "buspage": ("buspage",),
    "admission": ("admission", "adpin", "suggest", "assignadmission"),
    "ask": ("ask", "rpc"),
    "bulk": ("bulk", "csv", "chunkupsert"),
}


def classify(fn: Function) -> str:
    # Names are the strongest signal in this legacy, event-handler-heavy file.
    # Keep this explicit list ahead of body keyword scoring (``renderList`` and
    # ``table`` otherwise look like generic utility code).
    explicit = {
        "fetchAll": "utils", "toast": "utils", "hav": "utils", "renderList": "students",
        "openStudent": "students", "saveStudent": "students", "loadHistory": "students",
        "searchStudents": "students", "searchTemp": "temporary", "openTemp": "temporary",
        "loadGoogle": "maps", "attachGoogle": "maps", "addBaseLayer": "maps",
        "initEditMap": "maps", "setPin": "maps", "openRouteMap": "maps",
        "toggleBus": "maps", "syncSelAll": "maps", "setCheckedBuses": "maps",
        "isolate": "maps", "fitMapChecked": "maps", "fitMap": "maps",
        "orderStops": "routes", "renderBulk": "bulk", "bindCsvUpload": "bulk",
        "chunkUpsert": "bulk", "applyCsv": "bulk", "renderReports": "reports",
        "repSection": "reports", "downloadRepCsv": "reports", "buildGeography": "reports",
        "drawHeat": "reports", "renderAdmission": "admission", "setAdPin": "admission",
        "suggest": "admission", "assignAdmission": "admission", "renderBusPage": "buspage",
        "loadBusPage": "buspage", "parseAsk": "ask", "rpc": "ask", "renderAsk": "ask",
    }
    if fn.name in explicit:
        return explicit[fn.name]
    haystack = (fn.name + " " + fn.text).lower()
    scores = {module: sum(haystack.count(token) for token in tokens)
              for module, tokens in RULES.items()}
    winner, score = max(scores.items(), key=lambda item: item[1])
    return winner if score else "utils"


def top_level_imports(text: str) -> list[str]:
    imports = re.findall(r"(?m)^\s*import\s+[\s\S]*?;\s*$", text)
    result: list[str] = []
    for item in imports:
        normalized = " ".join(item.split())
        if normalized not in {" ".join(x.split()) for x in result}: result.append(item.strip())
    return result


def remove_imports(text: str) -> str:
    return re.sub(r"(?m)^\s*import\s+[\s\S]*?;\s*$", "", text)


def declared_globals(runtime: str) -> set[str]:
    # Only top-level declarations matter: functions use these via the global bridge.
    names: set[str] = set()
    for statement in split_statements(runtime):
        if re.match(r"^\s*(?:let|const|var)\b", statement):
            for name in re.findall(r"(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?:=|,|;|$)", statement):
                names.add(name)
    return names


def top_level_declarations(text: str) -> set[str]:
    """Return names declared by top-level ``let``/``const``/``var`` statements."""
    names: set[str] = set(); level = 0; i = 0
    while i < len(text):
        j = _skip_comment_or_literal(text, i)
        if j != i: i = j; continue
        if text[i] == "{": level += 1; i += 1; continue
        if text[i] == "}": level = max(0, level - 1); i += 1; continue
        match = re.match(r"(?:let|const|var)\s+", text[i:]) if level == 0 else None
        before = text[i - 1] if i else " "
        if match and not (before.isalnum() or before in "_$"):
            begin = i + match.end(); end = begin; inner = 0
            while end < len(text):
                k = _skip_comment_or_literal(text, end)
                if k != end: end = k; continue
                if text[end] in "({[": inner += 1
                elif text[end] in ")}]": inner -= 1
                elif text[end] == ";" and inner == 0: break
                end += 1
            declaration = text[begin:end]
            items: list[str] = []; start = 0; depth = 0; p = 0
            while p < len(declaration):
                k = _skip_comment_or_literal(declaration, p)
                if k != p: p = k; continue
                if declaration[p] in "({[": depth += 1
                elif declaration[p] in ")}]": depth -= 1
                elif declaration[p] == "," and depth == 0:
                    items.append(declaration[start:p]); start = p + 1
                p += 1
            items.append(declaration[start:])
            for item in items:
                name = re.match(r"\s*([A-Za-z_$][\w$]*)", item)
                if name: names.add(name.group(1))
            i = end + 1; continue
        i += 1
    return names


def split_statements(text: str) -> list[str]:
    result: list[str] = []; start = 0; i = 0; depth = 0
    while i < len(text):
        j = _skip_comment_or_literal(text, i)
        if j != i: i = j; continue
        if text[i] in "({[": depth += 1
        elif text[i] in ")}]": depth = max(0, depth - 1)
        elif text[i] == ";" and depth == 0:
            result.append(text[start:i + 1]); start = i + 1
        i += 1
    if text[start:].strip(): result.append(text[start:])
    return result


def globalize_declarations(runtime: str) -> str:
    """Turn simple top-level declarations into global properties for module access.

    Complex declarations are deliberately retained. The verifier flags them rather
    than making a lossy rewrite.
    """
    output: list[str] = []
    for stmt in split_statements(runtime):
        # ``blank_ranges`` leaves leading comments intact, so keep that prefix
        # while still recognizing the following declaration.
        match = re.match(r"^(\s*(?:(?://[^\n]*(?:\n|$)|/\*.*?\*/\s*)*))(let|const|var)\s+(.+);\s*$", stmt, re.S)
        if not match:
            output.append(stmt); continue
        indent, _, rhs = match.groups()
        # A declaration list is safe only when commas occur at the outer level.
        pieces: list[str] = []; start = 0; level = 0; i = 0
        while i < len(rhs):
            j = _skip_comment_or_literal(rhs, i)
            if j != i: i = j; continue
            if rhs[i] in "({[": level += 1
            elif rhs[i] in ")}]": level -= 1
            elif rhs[i] == "," and level == 0:
                pieces.append(rhs[start:i]); start = i + 1
            i += 1
        pieces.append(rhs[start:])
        assigns = []
        for piece in pieces:
            item = re.match(r"\s*([A-Za-z_$][\w$]*)\s*(?:=\s*(.*))?$", piece, re.S)
            if not item: assigns = []; break
            name, value = item.groups()
            assigns.append(f"{indent}globalThis.{name} = {value.strip() if value else 'undefined'};")
        output.append("\n".join(assigns) if assigns else stmt)
    return "".join(output)


def module_text(module: str, functions: list[Function]) -> str:
    body = "\n\n".join(re.sub(r"^(\s*)(?:export\s+)?(async\s+)?function\s+", r"\1export \2function ", fn.text, count=1)
                       for fn in functions)
    names = ", ".join(fn.name for fn in functions)
    compatibility = ""
    if module == "utils":
        # app.js defines these legacy helpers during its initialization. Export
        # call-through functions so existing modules can import them without
        # capturing an undefined value before app.js has run.
        compatibility = ("\n// Legacy helper exports retained for bootstrap compatibility.\n"
                         "export const $ = (...args) => globalThis.$(...args);\n"
                         "export const esc = (...args) => globalThis.esc(...args);\n"
                         "export const rs = (...args) => globalThis.rs(...args);\n"
                         "export const rupee = (...args) => globalThis.rupee(...args);\n")
    elif module == "temporary":
        # This was an inline listener in the legacy file, but bootstrap imports
        # it as an initializer. Keep that public API after splitting.
        compatibility = ("\nexport function initTemporary() {\n"
                         "  let timer;\n"
                         "  $('tq').addEventListener('input', event => {\n"
                         "    clearTimeout(timer);\n"
                         "    timer = setTimeout(() => searchTemp(event.target.value), 220);\n"
                         "  });\n"
                         "}\n")
    return (f"// Generated by tools/autorefactor.py. Do not edit while migration is repeatable.\n"
            f"// Functions access legacy runtime state through the global bridge in app.js.\n\n"
            f"{body}\n{compatibility}\nObject.assign(globalThis, {{ {names} }});\n")
