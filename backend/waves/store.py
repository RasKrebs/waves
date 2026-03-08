"""Async SQLite storage — sessions + segments tables (same schema as Go daemon)."""

from __future__ import annotations

import aiosqlite
from dataclasses import dataclass


@dataclass
class Session:
    id: str
    title: str
    started_at: int  # unix milliseconds
    ended_at: int | None = None
    audio_path: str = ""
    status: str = "recording"
    summary: str = ""
    model_used: str = ""


@dataclass
class Segment:
    id: int
    session_id: str
    start_ms: int
    end_ms: int
    text: str


class Store:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def open(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._migrate()

    async def close(self) -> None:
        if self._db:
            await self._db.close()

    async def _migrate(self) -> None:
        assert self._db
        await self._db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                started_at  INTEGER NOT NULL,
                ended_at    INTEGER,
                audio_path  TEXT,
                status      TEXT NOT NULL DEFAULT 'recording',
                summary     TEXT DEFAULT '',
                model_used  TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS segments (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL REFERENCES sessions(id),
                start_ms    INTEGER NOT NULL,
                end_ms      INTEGER NOT NULL,
                text        TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id);
        """)
        await self._db.commit()

    async def create_session(self, sess: Session) -> None:
        assert self._db
        await self._db.execute(
            "INSERT INTO sessions (id, title, started_at, audio_path, status, model_used) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (sess.id, sess.title, sess.started_at, sess.audio_path, sess.status, sess.model_used),
        )
        await self._db.commit()

    async def update_session(self, sess: Session) -> None:
        assert self._db
        await self._db.execute(
            "UPDATE sessions SET title=?, ended_at=?, status=?, summary=?, model_used=? WHERE id=?",
            (sess.title, sess.ended_at, sess.status, sess.summary, sess.model_used, sess.id),
        )
        await self._db.commit()

    async def get_session(self, id_prefix: str) -> Session | None:
        assert self._db
        async with self._db.execute(
            "SELECT id, title, started_at, ended_at, audio_path, status, summary, model_used "
            "FROM sessions WHERE id LIKE ? LIMIT 1",
            (id_prefix + "%",),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            return self._row_to_session(row)

    async def list_sessions(self, limit: int = 20) -> list[Session]:
        assert self._db
        async with self._db.execute(
            "SELECT id, title, started_at, ended_at, audio_path, status, summary, model_used "
            "FROM sessions ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
            return [self._row_to_session(r) for r in rows]

    async def count_sessions(self) -> int:
        assert self._db
        async with self._db.execute("SELECT COUNT(*) FROM sessions") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0

    async def add_segment(self, seg: Segment) -> None:
        assert self._db
        await self._db.execute(
            "INSERT INTO segments (session_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)",
            (seg.session_id, seg.start_ms, seg.end_ms, seg.text),
        )
        await self._db.commit()

    async def get_segments(self, session_id: str) -> list[Segment]:
        assert self._db
        async with self._db.execute(
            "SELECT id, session_id, start_ms, end_ms, text FROM segments "
            "WHERE session_id = ? ORDER BY start_ms",
            (session_id,),
        ) as cur:
            rows = await cur.fetchall()
            return [Segment(id=r[0], session_id=r[1], start_ms=r[2], end_ms=r[3], text=r[4]) for r in rows]

    async def full_transcript(self, session_id: str) -> str:
        segs = await self.get_segments(session_id)
        return " ".join(s.text for s in segs)

    @staticmethod
    def _row_to_session(row) -> Session:
        return Session(
            id=row[0],
            title=row[1],
            started_at=row[2],
            ended_at=row[3],
            audio_path=row[4] or "",
            status=row[5],
            summary=row[6] or "",
            model_used=row[7] or "",
        )
