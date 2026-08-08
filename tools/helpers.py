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
