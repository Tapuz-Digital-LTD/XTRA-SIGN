FROM debian:bookworm-slim

# LibreOffice for DOC/DOCX -> PDF, poppler for PDF -> page images.
# --no-install-recommends keeps out the fonts, Java stack and helper daemons a
# full LibreOffice install drags in, all of which widen the attack surface of
# the one container that opens untrusted files.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui \
      poppler-utils \
      fonts-dejavu-core \
      fonts-noto-core \
      fonts-noto-hinted \
      python3 \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Hebrew coverage: without a font that has Hebrew glyphs, LibreOffice renders
# every Hebrew character as a box and the conversion "succeeds" with an
# unreadable PDF. Fails the build if no Hebrew face is present.
RUN fc-cache -f && test -n "$(fc-list :lang=he)" || (echo "no Hebrew font" && exit 1)

# Unprivileged. LibreOffice needs a writable HOME for its profile, which is why
# the runtime mounts a tmpfs there rather than making the image writable.
RUN useradd --create-home --uid 10001 converter

WORKDIR /app
COPY --chown=converter:converter convert.py server.py ./

USER converter

ENV PYTHONUNBUFFERED=1 \
    CONVERTER_PORT=8080 \
    SCRATCH_DIR=/scratch \
    HOME=/scratch

EXPOSE 8080

# Liveness only — deliberately does not run a conversion, so one slow document
# cannot fail the whole service's health check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["python3", "/app/server.py"]
