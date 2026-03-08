"""Entry point: python -m waves"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from pathlib import Path

from waves.audio import AudioCapture
from waves.config import load as load_config
from waves.server import WavesServer
from waves.store import Store


def main() -> None:
    verbose = "-v" in sys.argv or "--verbose" in sys.argv

    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    # Suppress noisy aiosqlite debug logs
    logging.getLogger("aiosqlite").setLevel(logging.WARNING)
    log = logging.getLogger("waves")

    # Paths (same as Go daemon)
    home = Path.home()
    data_dir = home / "Library" / "Application Support" / "Waves"
    data_dir.mkdir(parents=True, exist_ok=True)
    socket_path = str(data_dir / "daemon.sock")
    db_path = str(data_dir / "waves.db")
    model_dir = str(data_dir / "models")

    # Load config
    cfg = load_config()
    log.info("Config loaded (transcription: %s, summarization: %s)",
             cfg.transcription.provider, cfg.summarization.provider)

    asyncio.run(_run(socket_path, db_path, data_dir, model_dir, cfg, log))


async def _run(socket_path, db_path, data_dir, model_dir, cfg, log) -> None:
    # Open store
    store = Store(db_path)
    await store.open()
    log.info("Database opened at %s", db_path)

    # Audio capture
    audio = AudioCapture()

    # Server
    server = WavesServer(
        socket_path=socket_path,
        data_dir=str(data_dir),
        store=store,
        config=cfg,
        audio=audio,
    )

    # Set up transcription provider
    if cfg.transcription.provider == "whisper-local":
        from waves.providers.transcription.whisper_local import WhisperLocal
        server.transcriber = WhisperLocal(
            model_dir=model_dir,
            binary=cfg.transcription.whisper.binary,
            language=cfg.transcription.language,
        )
        log.info("Transcription provider: whisper-local")
    else:
        log.warning("Transcription provider '%s' not yet implemented", cfg.transcription.provider)

    # Handle shutdown
    loop = asyncio.get_event_loop()
    stop = asyncio.Event()

    def _shutdown(signum, frame):
        log.info("Shutting down...")
        stop.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Run server until stop signal
    serve_task = asyncio.create_task(server.serve())

    await stop.wait()

    serve_task.cancel()
    try:
        await serve_task
    except asyncio.CancelledError:
        pass

    await store.close()
    log.info("Stopped")


if __name__ == "__main__":
    main()
