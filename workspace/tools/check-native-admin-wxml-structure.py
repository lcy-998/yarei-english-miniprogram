"""Check native admin WXML tag nesting without running cloud-backed pages."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1] / "miniprogram" / "pages" / "admin"
PAGES = ("workbench", "organizations", "users", "permissions", "questions", "media-review")


def tags(text: str):
    offset = 0
    while offset < len(text):
        start = text.find("<", offset)
        if start < 0:
            return
        if text.startswith("<!--", start):
            end = text.find("-->", start + 4)
            if end < 0:
                raise ValueError("Unclosed comment")
            offset = end + 3
            continue
        quote = None
        end = start + 1
        while end < len(text):
            char = text[end]
            if quote:
                if char == quote:
                    quote = None
            elif char in ('"', "'"):
                quote = char
            elif char == ">":
                break
            end += 1
        if end >= len(text):
            raise ValueError("Unclosed tag")
        value = text[start + 1:end].strip()
        offset = end + 1
        if value and value[0] not in "!?":
            match = re.match(r"(/?)([A-Za-z][\w:-]*)", value)
            if match:
                yield match.group(1) == "/", match.group(2), value.endswith("/")


for page in PAGES:
    path = ROOT / page / f"{page}.wxml"
    text = path.read_text(encoding="utf-8")
    stack = []
    for closing, name, self_closing in tags(text):
        if closing:
            if not stack or stack[-1] != name:
                raise SystemExit(f"{page}: mismatched closing tag {name}, stack={stack[-3:]}")
            stack.pop()
        elif not self_closing:
            stack.append(name)
    if stack:
        raise SystemExit(f"{page}: unclosed tags {stack[-3:]}")
    print(f"{page}: tags balanced")
