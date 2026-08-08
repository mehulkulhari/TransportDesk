from pathlib import Path
import re

# ------------------------------------------------------------
# TransportDesk Frontend Splitter v1.0
# ------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent

SOURCE_HTML = PROJECT_ROOT / "transport_platform (10).html"

FRONTEND = PROJECT_ROOT / "frontend"

INDEX_HTML = FRONTEND / "index.html"
MAIN_CSS = FRONTEND / "css" / "main.css"
APP_JS = FRONTEND / "js" / "app.js"


def read_source():
    if not SOURCE_HTML.exists():
        raise FileNotFoundError(
            f"\nCannot find:\n{SOURCE_HTML}\n"
            "Place transport_platform (10).html in the project root."
        )

    return SOURCE_HTML.read_text(
        encoding="utf-8",
        errors="ignore"
    )


def extract_css(html):

    match = re.search(
        r"<style.*?>(.*?)</style>",
        html,
        re.DOTALL | re.IGNORECASE
    )

    return match.group(1).strip() if match else ""


def extract_js(html):

    scripts = re.findall(
        r"<script(?![^>]*src)[^>]*>(.*?)</script>",
        html,
        re.DOTALL | re.IGNORECASE
    )

    return "\n\n".join(s.strip() for s in scripts)


def create_index(html):

    html = re.sub(
        r"<style.*?</style>",
        '<link rel="stylesheet" href="css/main.css">',
        html,
        flags=re.DOTALL | re.IGNORECASE
    )

    html = re.sub(
        r"<script(?![^>]*src).*?</script>",
        '<script type="module" src="js/app.js"></script>',
        html,
        flags=re.DOTALL | re.IGNORECASE
    )

    return html


def save(path, text):

    path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    path.write_text(
        text,
        encoding="utf-8"
    )


def main():

    print("\nTransportDesk Frontend Splitter\n")

    html = read_source()

    css = extract_css(html)
    js = extract_js(html)
    index = create_index(html)

    save(MAIN_CSS, css)
    save(APP_JS, js)
    save(INDEX_HTML, index)

    print("Done.\n")

    print("Generated:")
    print("  frontend/index.html")
    print("  frontend/css/main.css")
    print("  frontend/js/app.js")


if __name__ == "__main__":
    main()