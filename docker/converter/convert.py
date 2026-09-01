#!/usr/bin/env python3
"""
DOC/DOCX -> PDF -> page images.

Bytes in, bytes out. Nothing here reaches the network or touches a path outside
its own scratch directory, and every run cleans up in a finally block: a
conversion that fails must not leave the worker holding a temp directory or a
wedged soffice profile, because after enough of those it stops converting
anything at all.
"""
import os
import re
import shutil
import struct
import subprocess
import tempfile

CONVERSION_TIMEOUT = int(os.environ.get("CONVERSION_TIMEOUT_MS", "60000")) / 1000
RENDER_TIMEOUT = int(os.environ.get("RENDER_TIMEOUT_MS", "30000")) / 1000
MAX_PAGES = int(os.environ.get("MAX_PAGES", "50"))
RENDER_WIDTH = int(os.environ.get("RENDER_WIDTH_PX", "1240"))
SCRATCH_ROOT = os.environ.get("SCRATCH_DIR", "/scratch")


class Refused(Exception):
    """A document we will not process. Carries the reason the caller reports."""

    def __init__(self, failure):
        super().__init__(failure)
        self.failure = failure


def page_count(pdf_path):
    out = subprocess.run(["pdfinfo", pdf_path], capture_output=True, timeout=15, text=True)
    for line in out.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", 1)[1].strip())
    return None


def page_sizes(pdf_path, pages):
    """
    Real width/height in PDF points for EVERY page.

    Pages in one document are not necessarily the same size and are not
    necessarily A4 — a scanned appendix can be Letter and a plan can be
    landscape. Assuming one shape puts a signature in the wrong place on any
    document that does not match, so the actual numbers are read per page.
    """
    out = subprocess.run(
        ["pdfinfo", "-f", "1", "-l", str(pages), pdf_path],
        capture_output=True, timeout=30, text=True,
    )
    sizes = {}
    for line in out.stdout.splitlines():
        # "Page 3 size: 841.89 x 595.276 pts (A4)"
        m = re.match(r"Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts", line)
        if m:
            sizes[int(m.group(1))] = (float(m.group(2)), float(m.group(3)))
    return sizes


def png_dimensions(path):
    """Pixel size straight from the PNG IHDR — no image library needed."""
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def run_job(source_bytes, kind):
    """Returns a result dict. Never raises Refused to the caller — it is caught."""
    scratch = tempfile.mkdtemp(prefix="convert-", dir=SCRATCH_ROOT)
    try:
        return _convert(scratch, source_bytes, kind)
    except Refused as refusal:
        return {"ok": False, "failure": refusal.failure}
    finally:
        # Runs on success, on refusal, and on an unhandled exception. A leaked
        # scratch directory per bad upload fills the tmpfs, and then every later
        # conversion fails for an unrelated reason.
        shutil.rmtree(scratch, ignore_errors=True)


def _convert(scratch, source_bytes, kind):
    source = os.path.join(scratch, f"source.{kind}")
    with open(source, "wb") as f:
        f.write(source_bytes)

    out_dir = os.path.join(scratch, "out")
    os.makedirs(out_dir, exist_ok=True)

    if kind == "pdf":
        pdf_path = source
    else:
        # A per-run LibreOffice profile: two concurrent conversions sharing one
        # profile is the classic way a soffice worker wedges permanently.
        profile = os.path.join(scratch, "profile")
        try:
            subprocess.run(
                [
                    "soffice", "--headless", "--norestore", "--nolockcheck",
                    "--nodefault", "--nologo",
                    f"-env:UserInstallation=file://{profile}",
                    "--convert-to", "pdf", "--outdir", scratch, source,
                ],
                capture_output=True, timeout=CONVERSION_TIMEOUT, check=False,
            )
        except subprocess.TimeoutExpired:
            raise Refused("timeout")

        produced = [f for f in os.listdir(scratch) if f.lower().endswith(".pdf")]
        if not produced:
            raise Refused("conversion_failed")
        pdf_path = os.path.join(scratch, produced[0])

    try:
        pages = page_count(pdf_path)
    except subprocess.TimeoutExpired:
        raise Refused("timeout")
    except Exception:
        raise Refused("unreadable")

    if pages is None:
        raise Refused("unreadable")

    # Checked from the page count BEFORE rasterising, so a 500-page upload never
    # becomes 500 render jobs.
    if pages > MAX_PAGES:
        raise Refused("too_many_pages")

    try:
        subprocess.run(
            [
                "pdftoppm", "-png", "-r", "150",
                # Scale width only; -1 keeps each page's own aspect ratio, so a
                # landscape page stays landscape.
                "-scale-to-x", str(RENDER_WIDTH), "-scale-to-y", "-1",
                pdf_path, os.path.join(out_dir, "page"),
            ],
            capture_output=True, timeout=RENDER_TIMEOUT, check=False,
        )
    except subprocess.TimeoutExpired:
        raise Refused("timeout")

    images = sorted(
        (f for f in os.listdir(out_dir) if f.endswith(".png")),
        key=lambda name: int(re.search(r"(\d+)", name).group(1)),
    )
    if not images:
        raise Refused("unreadable")

    sizes = page_sizes(pdf_path, pages)

    page_info = []
    for index, name in enumerate(images, start=1):
        dims = png_dimensions(os.path.join(out_dir, name))
        pts = sizes.get(index)
        # A page whose geometry cannot be measured is refused rather than
        # defaulted: a guessed page size puts every field on it in the wrong place.
        if not dims or not pts:
            raise Refused("unreadable")
        page_info.append({
            "page": index,
            "imageWidth": dims[0], "imageHeight": dims[1],
            "widthPt": pts[0], "heightPt": pts[1],
        })

    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()

    image_bytes = []
    for name in images:
        with open(os.path.join(out_dir, name), "rb") as f:
            image_bytes.append(f.read())

    return {
        "ok": True,
        "pages": pages,
        "pageInfo": page_info,
        "pdf": pdf_bytes,
        "images": image_bytes,
    }
