FROM debian:bookworm-slim

# LibreOffice for DOC/DOCX -> PDF, poppler for PDF -> page images.
# --no-install-recommends keeps out the fonts, Java stack and helper daemons
# that come with a full LibreOffice install and widen the attack surface.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui \
      poppler-utils \
      fonts-dejavu-core \
      fonts-noto-core \
      fonts-noto-hinted \
      python3 \
    && rm -rf /var/lib/apt/lists/*

# Hebrew coverage: without a font that has Hebrew glyphs, LibreOffice renders
# every Hebrew character as a box and the conversion "succeeds" with an
# unreadable PDF.
RUN fc-cache -f && fc-list :lang=he | head -5

# Unprivileged. LibreOffice needs a writable HOME for its profile, which is why
# the compose file mounts a tmpfs there rather than making the image writable.
RUN useradd --create-home --uid 10001 converter
USER converter
WORKDIR /work

COPY --chown=converter:converter convert.py /usr/local/bin/convert.py

ENTRYPOINT ["python3", "/usr/local/bin/convert.py"]
