#!/usr/bin/env python3
"""Render reviewed click-read boxes on a page image for visual QA."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("page_image", type=Path)
    parser.add_argument("manifest_json", type=Path)
    parser.add_argument("output_image", type=Path)
    args = parser.parse_args()

    image = Image.open(args.page_image).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.load_default()
    manifest = json.loads(args.manifest_json.read_text(encoding="utf-8"))

    for index, zone in enumerate(manifest["clickReadZones"], start=1):
        for area_index, bbox in enumerate(zone["hitAreas"]):
            left = int(bbox["x"] * image.width)
            top = int(bbox["y"] * image.height)
            right = int((bbox["x"] + bbox["width"]) * image.width)
            bottom = int((bbox["y"] + bbox["height"]) * image.height)
            draw.rounded_rectangle(
                (left, top, right, bottom),
                radius=8,
                fill=(243, 185, 28, 58),
                outline=(23, 100, 216, 255),
                width=3,
            )
            if area_index == 0:
                label = f"{index}"
                draw.rounded_rectangle(
                    (left, max(0, top - 22), left + 24, top + 2),
                    radius=4,
                    fill=(23, 100, 216, 255),
                )
                draw.text((left + 8, max(0, top - 19)), label, fill="white", font=font)

    result = Image.alpha_composite(image, overlay).convert("RGB")
    args.output_image.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output_image, quality=94)


if __name__ == "__main__":
    main()
