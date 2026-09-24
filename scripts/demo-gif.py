#!/usr/bin/env python3
"""Renders docs/demo.gif: `skope --demo`, its tests, and two faked dry runs.

Every line of output in the GIF comes from actually running the commands it
shows, in a fresh temp directory, against the built CLI (dist/cli.js). Only
the typing and the pauses are staged.

    npm run build && python3 scripts/demo-gif.py      # needs Pillow and jq
"""

import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "demo.gif"

# Narrow and drawn at 2x, so it's still readable when a phone shrinks it to fit.
COLS, ROWS, X = 62, 17, 2
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 15 * X)
BOLD = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 15 * X)
CW, LH = FONT.getlength("m"), 20 * X
PAD, BAR = 16 * X, 30 * X
W, H = round(PAD * 2 + CW * COLS), BAR + PAD * 2 + LH * ROWS

BG, BARBG, FG, DIM = "#1e2127", "#2c313a", "#d7dae0", "#7f848e"
GREEN, CYAN, YELLOW, RED, MAGENTA = "#98c379", "#56b6c2", "#e5c07b", "#e06c75", "#c678dd"

# Split inside its quotes, which the shell keeps as a newline and jq ignores.
JQ = "| jq -r '[.event, .cmd // .chosen // .outcome,\n         .confidence // .reason] | @tsv'"


def colour(line):
    """(colour, bold) for a line of output."""
    first = line.split("\t", 1)[0]
    if line.startswith("PASS"):
        return GREEN, False
    if line.startswith("FAIL") or "gate_failed" in line:
        return RED, True
    if "passed," in line:
        return GREEN, True
    return {"ask": (CYAN, True), "would_do": (YELLOW, True), "would_page": (YELLOW, True), "outcome": (MAGENTA, True)}.get(
        first, (FG, False)
    )


def expand(line):
    """Tabs to 8-column stops, as a terminal shows them, then wrapped to the screen."""
    out = ""
    for ch in line:
        out += " " * (8 - len(out) % 8) if ch == "\t" else ch
    out = out.rstrip()
    return [out[i : i + COLS] for i in range(0, max(len(out), 1), COLS)]




class Term:
    def __init__(self):
        self.lines = []  # (text, colour, bold)
        self.frames = []  # (image, ms)

    def frame(self, ms):
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, W, BAR], fill=BARBG)
        for i, c in enumerate(["#ff5f56", "#ffbd2e", "#27c93f"]):
            d.ellipse([PAD + i * 20 * X, 10 * X, PAD + (i * 20 + 11) * X, 21 * X], fill=c)
        title = "skope: no API key, nothing real runs"
        d.text(((W - FONT.getlength(title)) / 2, 7 * X), title, font=FONT, fill=DIM)
        for row, (text, fill, bold) in enumerate(self.lines[-ROWS:]):
            y = BAR + PAD + row * LH
            if text.startswith("$ "):
                d.text((PAD, y), "$", font=BOLD, fill=GREEN)
                d.text((PAD + CW * 2, y), text[2:], font=FONT, fill=fill)
            else:
                d.text((PAD, y), text, font=BOLD if bold else FONT, fill=fill)
        self.frames.append((img, ms))

    def type(self, text, fill=FG):
        """Types a command a few characters per frame, a line at a time."""
        for n, part in enumerate(text.split("\n")):
            lead = "$ " if n == 0 else "  "
            self.lines.append((lead, fill, False))
            for i in range(0, len(part), 3):
                self.lines[-1] = (lead + part[: i + 3], fill, False)
                self.frame(45)
        self.frame(350)

    def comment(self, text):
        self.lines.append((text, DIM, False))
        self.frame(900)

    def print(self, output, each=0):
        for line in output.rstrip("\n").split("\n"):
            fill, bold = colour(line)
            for part in expand(line):
                self.lines.append((part, fill, bold))
            if each:
                self.frame(each)
        if not each:
            self.frame(100)

    def pause(self, ms):
        self.frame(ms)

    def clear(self):
        self.lines = []


def main():
    work = Path(tempfile.mkdtemp(prefix="skope-gif-"))
    (work / "bin").mkdir()
    (work / "bin" / "skope").write_text(f'#!/bin/sh\nexec node {ROOT / "dist" / "cli.js"} "$@"\n')
    (work / "bin" / "skope").chmod(0o755)
    env = {
        "PATH": f"{work / 'bin'}:{os.environ['PATH']}",
        "HOME": str(work / "home"),
        "XDG_STATE_HOME": str(work / "state"),
        "XDG_CONFIG_HOME": str(work / "config"),
    }
    cwd = [work]

    def sh(cmd, each=0):
        """Types cmd, runs it for real, and prints what it wrote. It's run as typed, line breaks and all."""
        t.type(cmd)
        r = subprocess.run(cmd, shell=True, cwd=cwd[0], env=env, capture_output=True, text=True)
        out = r.stdout + r.stderr
        if out.strip():
            t.print(out, each)

    t = Term()
    t.comment("# Just the binary: no clone, no config, no API key.")
    sh("skope --demo")
    t.pause(3500)
    t.clear()

    t.comment("# Its unit tests fake the commands and the model.")
    t.type("cd skope-demo")
    cwd[0] = work / "skope-demo"
    sh("skope SKILL.md --test > results.jsonl", each=180)
    t.pause(2500)
    t.clear()

    t.comment("# The model is sure, so skope would restart it.")
    dry = "skope SKILL.md --dry-run --fake {} \\\n  --fake-exec commands.yaml \\\n  " + JQ
    sh(dry.format("answers.yaml"), each=140)
    t.pause(3500)
    t.clear()

    t.comment("# Unsure: skope hands off instead of guessing.")
    sh("echo 'Triage.ask: unsure' > unsure.yaml")
    sh(dry.format("unsure.yaml"), each=140)
    t.pause(5000)

    first, rest = t.frames[0][0], t.frames[1:]
    first.save(
        OUT,
        save_all=True,
        append_images=[f for f, _ in rest],
        duration=[ms for _, ms in t.frames],
        loop=0,
        optimize=True,
    )
    print(f"{OUT}: {len(t.frames)} frames, {sum(ms for _, ms in t.frames) / 1000:.1f}s, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
