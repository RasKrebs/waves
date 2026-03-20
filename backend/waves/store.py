"""Async SQLite storage — sessions + segments tables (same schema as Go daemon)."""

from __future__ import annotations

import aiosqlite
from dataclasses import dataclass


@dataclass
class Project:
    id: str
    name: str
    created_at: int  # unix milliseconds
    description: str = ""


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
    project_id: str | None = None
    meeting_type: str | None = None


@dataclass
class Segment:
    id: int
    session_id: str
    start_ms: int
    end_ms: int
    text: str


@dataclass
class Note:
    id: str
    session_id: str
    project_id: str | None
    content: str
    note_type: str = "meeting-notes"  # meeting-notes, action-items, etc.
    created_at: int = 0
    updated_at: int = 0


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

            CREATE TABLE IF NOT EXISTS projects (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                description TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS notes (
                id          TEXT PRIMARY KEY,
                session_id  TEXT NOT NULL REFERENCES sessions(id),
                project_id  TEXT REFERENCES projects(id),
                content     TEXT NOT NULL DEFAULT '',
                note_type   TEXT NOT NULL DEFAULT 'meeting-notes',
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id);
            CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
        """)

        # Add project_id column to sessions if missing (migration for existing DBs)
        async with self._db.execute("PRAGMA table_info(sessions)") as cur:
            cols = {row[1] for row in await cur.fetchall()}
        if "project_id" not in cols:
            await self._db.execute("ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)")
        if "meeting_type" not in cols:
            await self._db.execute("ALTER TABLE sessions ADD COLUMN meeting_type TEXT")

        await self._db.commit()

    # -- Projects --

    async def create_project(self, proj: Project) -> None:
        assert self._db
        await self._db.execute(
            "INSERT INTO projects (id, name, created_at, description) VALUES (?, ?, ?, ?)",
            (proj.id, proj.name, proj.created_at, proj.description),
        )
        await self._db.commit()

    async def update_project(self, proj: Project) -> None:
        assert self._db
        await self._db.execute(
            "UPDATE projects SET name=?, description=? WHERE id=?",
            (proj.name, proj.description, proj.id),
        )
        await self._db.commit()

    async def delete_project(self, project_id: str) -> None:
        assert self._db
        # Unassign sessions first
        await self._db.execute(
            "UPDATE sessions SET project_id = NULL WHERE project_id = ?", (project_id,)
        )
        # Unassign notes
        await self._db.execute(
            "UPDATE notes SET project_id = NULL WHERE project_id = ?", (project_id,)
        )
        await self._db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        await self._db.commit()

    async def get_project(self, project_id: str) -> Project | None:
        assert self._db
        async with self._db.execute(
            "SELECT id, name, created_at, description FROM projects WHERE id = ?",
            (project_id,),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            return Project(id=row[0], name=row[1], created_at=row[2], description=row[3] or "")

    async def list_projects(self) -> list[Project]:
        assert self._db
        async with self._db.execute(
            "SELECT id, name, created_at, description FROM projects ORDER BY created_at DESC"
        ) as cur:
            rows = await cur.fetchall()
            return [Project(id=r[0], name=r[1], created_at=r[2], description=r[3] or "") for r in rows]

    async def project_session_count(self, project_id: str) -> int:
        assert self._db
        async with self._db.execute(
            "SELECT COUNT(*) FROM sessions WHERE project_id = ?", (project_id,)
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else 0

    # -- Sessions --

    async def create_session(self, sess: Session) -> None:
        assert self._db
        await self._db.execute(
            "INSERT INTO sessions (id, title, started_at, audio_path, status, model_used, project_id, meeting_type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sess.id, sess.title, sess.started_at, sess.audio_path, sess.status, sess.model_used, sess.project_id, sess.meeting_type),
        )
        await self._db.commit()

    async def update_session(self, sess: Session) -> None:
        assert self._db
        await self._db.execute(
            "UPDATE sessions SET title=?, ended_at=?, audio_path=?, status=?, summary=?, model_used=?, project_id=?, meeting_type=? WHERE id=?",
            (sess.title, sess.ended_at, sess.audio_path, sess.status, sess.summary, sess.model_used, sess.project_id, sess.meeting_type, sess.id),
        )
        await self._db.commit()

    async def assign_session_to_project(self, session_id: str, project_id: str | None) -> None:
        assert self._db
        await self._db.execute(
            "UPDATE sessions SET project_id = ? WHERE id = ?", (project_id, session_id)
        )
        await self._db.commit()

    async def list_sessions_for_project(self, project_id: str) -> list[Session]:
        assert self._db
        async with self._db.execute(
            "SELECT id, title, started_at, ended_at, audio_path, status, summary, model_used, project_id, meeting_type "
            "FROM sessions WHERE project_id = ? ORDER BY started_at DESC",
            (project_id,),
        ) as cur:
            rows = await cur.fetchall()
            return [self._row_to_session(r) for r in rows]

    async def delete_segments(self, session_id: str) -> int:
        assert self._db
        async with self._db.execute(
            "DELETE FROM segments WHERE session_id = ?", (session_id,)
        ) as cur:
            count = cur.rowcount
        await self._db.commit()
        return count

    async def delete_session(self, session_id: str) -> str:
        """Delete a session and all its segments and notes. Returns the audio_path."""
        assert self._db
        sess = await self.get_session(session_id)
        audio_path = sess.audio_path if sess else ""
        await self._db.execute("DELETE FROM segments WHERE session_id = ?", (session_id,))
        await self._db.execute("DELETE FROM notes WHERE session_id = ?", (session_id,))
        await self._db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        await self._db.commit()
        return audio_path

    async def get_session(self, id_prefix: str) -> Session | None:
        assert self._db
        async with self._db.execute(
            "SELECT id, title, started_at, ended_at, audio_path, status, summary, model_used, project_id, meeting_type "
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
            "SELECT id, title, started_at, ended_at, audio_path, status, summary, model_used, project_id, meeting_type "
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

    # -- Notes --

    async def create_note(self, note: Note) -> None:
        assert self._db
        await self._db.execute(
            "INSERT INTO notes (id, session_id, project_id, content, note_type, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (note.id, note.session_id, note.project_id, note.content, note.note_type, note.created_at, note.updated_at),
        )
        await self._db.commit()

    async def update_note(self, note: Note) -> None:
        assert self._db
        await self._db.execute(
            "UPDATE notes SET content=?, note_type=?, updated_at=? WHERE id=?",
            (note.content, note.note_type, note.updated_at, note.id),
        )
        await self._db.commit()

    async def get_note(self, note_id: str) -> Note | None:
        assert self._db
        async with self._db.execute(
            "SELECT id, session_id, project_id, content, note_type, created_at, updated_at "
            "FROM notes WHERE id = ?",
            (note_id,),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            return Note(id=row[0], session_id=row[1], project_id=row[2], content=row[3],
                        note_type=row[4], created_at=row[5], updated_at=row[6])

    async def get_notes_for_session(self, session_id: str) -> list[Note]:
        assert self._db
        async with self._db.execute(
            "SELECT id, session_id, project_id, content, note_type, created_at, updated_at "
            "FROM notes WHERE session_id = ? ORDER BY created_at DESC",
            (session_id,),
        ) as cur:
            rows = await cur.fetchall()
            return [Note(id=r[0], session_id=r[1], project_id=r[2], content=r[3],
                         note_type=r[4], created_at=r[5], updated_at=r[6]) for r in rows]

    async def delete_note(self, note_id: str) -> None:
        assert self._db
        await self._db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        await self._db.commit()

    # -- Helpers --

    async def set_meeting_type(self, session_id: str, meeting_type: str | None) -> None:
        assert self._db
        await self._db.execute(
            "UPDATE sessions SET meeting_type = ? WHERE id = ?", (meeting_type, session_id)
        )
        await self._db.commit()

    async def list_unassigned_sessions(self, limit: int = 50) -> list[Session]:
        assert self._db
        async with self._db.execute(
            "SELECT id, title, started_at, ended_at, audio_path, status, summary, model_used, project_id, meeting_type "
            "FROM sessions WHERE (project_id IS NULL OR project_id = '') AND status != 'recording' "
            "ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
            return [self._row_to_session(r) for r in rows]

    # -- Helpers --

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
            project_id=row[8] if len(row) > 8 else None,
            meeting_type=row[9] if len(row) > 9 else None,
        )
