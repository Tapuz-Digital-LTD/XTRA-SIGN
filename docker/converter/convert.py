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
import shutil
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

        json.dump(
            {"ok": True, "pages": pages, "pdf": result_pdf, "images": images},
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
