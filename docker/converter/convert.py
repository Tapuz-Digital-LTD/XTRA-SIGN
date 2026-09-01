#!/usr/bin/env python3
"""
DOC/DOCX -> PDF -> page images, inside the isolated converter container.

Reads a job on stdin, writes a JSON result on stdout. Nothing here reaches the
network or touches a path outside the scratch directory.

Every subprocess gets a timeout and every run cleans up in a finally block: a
conversion that fails must not leave the worker holding a temp directory or a
zombie soffice profile, because after enough of those the worker stops
converting anything.
"""
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile

CONVERSION_TIMEOUT = int(os.environ.get("CONVERSION_TIMEOUT_MS", "60000")) / 1000
RENDER_TIMEOUT = int(os.environ.get("RENDER_TIMEOUT_MS", "30000")) / 1000
MAX_PAGES = int(os.environ.get("MAX_PAGES", "50"))
RENDER_WIDTH = int(os.environ.get("RENDER_WIDTH_PX", "1240"))


def fail(reason):
    json.dump({"ok": False, "failure": reason}, sys.stdout)
    sys.stdout.flush()
    sys.exit(0)


def page_count(pdf_path):
    out = subprocess.run(
        ["pdfinfo", pdf_path], capture_output=True, timeout=15, text=True
    )
    for line in out.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", 1)[1].strip())
    return None


def page_sizes(pdf_path, pages):
    """
    Real width/height in PDF points for EVERY page.

    Pages in one document are not necessarily the same size, and they are not
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


def main():
    job = json.load(sys.stdin)
    source = job["sourcePath"]
    kind = job["kind"]
    out_dir = job["outputDir"]

    # LibreOffice writes its user profile into HOME. A per-run directory means
    # two concurrent conversions cannot corrupt each other's profile, which is
    # the classic way a soffice worker wedges permanently.
    scratch = tempfile.mkdtemp(prefix="convert-", dir=os.environ.get("SCRATCH_DIR", "/tmp"))

    try:
        if kind == "pdf":
            pdf_path = source
        else:
            profile = os.path.join(scratch, "profile")
            try:
                subprocess.run(
                    [
                        "soffice",
                        "--headless",
                        "--norestore",
                        "--nolockcheck",
                        "--nodefault",
                        "--nologo",
                        f"-env:UserInstallation=file://{profile}",
                        "--convert-to",
                        "pdf",
                        "--outdir",
                        scratch,
                        source,
                    ],
                    capture_output=True,
                    timeout=CONVERSION_TIMEOUT,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                fail("timeout")

            produced = [f for f in os.listdir(scratch) if f.lower().endswith(".pdf")]
            if not produced:
                fail("conversion_failed")
            pdf_path = os.path.join(scratch, produced[0])

        try:
            pages = page_count(pdf_path)
        except subprocess.TimeoutExpired:
            fail("timeout")
        except Exception:
            fail("unreadable")

        if pages is None:
            fail("unreadable")
        if pages > MAX_PAGES:
            fail("too_many_pages")

        os.makedirs(out_dir, exist_ok=True)
        try:
            subprocess.run(
                [
                    "pdftoppm",
                    "-png",
                    "-r", "150",
                    # Scale width only; -1 keeps each page's own aspect ratio,
                    # so a landscape page stays landscape.
                    "-scale-to-x", str(RENDER_WIDTH),
                    "-scale-to-y", "-1",
                    pdf_path,
                    os.path.join(out_dir, "page"),
                ],
                capture_output=True,
                timeout=RENDER_TIMEOUT,
                check=False,
            )
        except subprocess.TimeoutExpired:
            fail("timeout")

        images = sorted(f for f in os.listdir(out_dir) if f.endswith(".png"))
        if not images:
            fail("unreadable")

        result_pdf = os.path.join(out_dir, "document.pdf")
        if os.path.abspath(pdf_path) != os.path.abspath(result_pdf):
            shutil.copyfile(pdf_path, result_pdf)

        sizes = page_sizes(pdf_path, pages)

        page_info = []
        for index, name in enumerate(images, start=1):
            dims = png_dimensions(os.path.join(out_dir, name))
            pts = sizes.get(index)
            page_info.append({
                "page": index,
                "image": name,
                "imageWidth": dims[0] if dims else None,
                "imageHeight": dims[1] if dims else None,
                "widthPt": pts[0] if pts else None,
                "heightPt": pts[1] if pts else None,
            })

        json.dump(
            {
                "ok": True,
                "pages": pages,
                "pdf": result_pdf,
                "images": images,
                "pageInfo": page_info,
            },
            sys.stdout,
        )
        sys.stdout.flush()

    finally:
        # Runs on success, on failure, and on an unhandled exception. A leaked
        # scratch directory per bad upload fills the tmpfs and then every later
        # conversion fails for an unrelated reason.
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    main()
