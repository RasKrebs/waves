package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type DB struct {
	db *sql.DB
}

type Session struct {
	ID        string
	Title     string
	StartedAt time.Time
	EndedAt   *time.Time
	AudioPath string
	Status    string // "recording", "transcribing", "done", "failed"
	Summary   string
	ModelUsed string
}

type Segment struct {
	ID        int64
	SessionID string
	StartMS   int64
	EndMS     int64
	Text      string
}

func New(path string) (*DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)

	store := &DB{db: db}
	if err := store.migrate(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *DB) Close() error {
	return s.db.Close()
}

func (s *DB) migrate() error {
	_, err := s.db.Exec(`
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
	`)
	return err
}

func (s *DB) CreateSession(sess Session) error {
	_, err := s.db.Exec(
		`INSERT INTO sessions (id, title, started_at, audio_path, status, model_used)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		sess.ID, sess.Title, sess.StartedAt.UnixMilli(),
		sess.AudioPath, sess.Status, sess.ModelUsed,
	)
	return err
}

func (s *DB) UpdateSession(sess Session) error {
	var endedAt *int64
	if sess.EndedAt != nil {
		v := sess.EndedAt.UnixMilli()
		endedAt = &v
	}
	_, err := s.db.Exec(
		`UPDATE sessions SET title=?, ended_at=?, status=?, summary=?, model_used=?
		 WHERE id=?`,
		sess.Title, endedAt, sess.Status, sess.Summary, sess.ModelUsed, sess.ID,
	)
	return err
}

func (s *DB) GetSession(idPrefix string) (*Session, error) {
	row := s.db.QueryRow(
		`SELECT id, title, started_at, ended_at, audio_path, status, summary, model_used
		 FROM sessions WHERE id LIKE ? LIMIT 1`,
		idPrefix+"%",
	)
	return scanSession(row)
}

func (s *DB) ListSessions(limit int) ([]Session, error) {
	rows, err := s.db.Query(
		`SELECT id, title, started_at, ended_at, audio_path, status, summary, model_used
		 FROM sessions ORDER BY started_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, *sess)
	}
	return sessions, nil
}

func (s *DB) AddSegment(seg Segment) error {
	_, err := s.db.Exec(
		`INSERT INTO segments (session_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)`,
		seg.SessionID, seg.StartMS, seg.EndMS, seg.Text,
	)
	return err
}

func (s *DB) GetSegments(sessionID string) ([]Segment, error) {
	rows, err := s.db.Query(
		`SELECT id, session_id, start_ms, end_ms, text FROM segments
		 WHERE session_id = ? ORDER BY start_ms`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var segs []Segment
	for rows.Next() {
		var seg Segment
		if err := rows.Scan(&seg.ID, &seg.SessionID, &seg.StartMS, &seg.EndMS, &seg.Text); err != nil {
			return nil, err
		}
		segs = append(segs, seg)
	}
	return segs, nil
}

func (s *DB) FullTranscript(sessionID string) (string, error) {
	segs, err := s.GetSegments(sessionID)
	if err != nil {
		return "", err
	}
	var out string
	for _, seg := range segs {
		if out != "" {
			out += " "
		}
		out += seg.Text
	}
	return out, nil
}

func scanSession(row interface {
	Scan(...interface{}) error
}) (*Session, error) {
	var sess Session
	var startedMS int64
	var endedMS *int64

	err := row.Scan(
		&sess.ID, &sess.Title, &startedMS, &endedMS,
		&sess.AudioPath, &sess.Status, &sess.Summary, &sess.ModelUsed,
	)
	if err != nil {
		return nil, err
	}
	sess.StartedAt = time.UnixMilli(startedMS)
	if endedMS != nil {
		t := time.UnixMilli(*endedMS)
		sess.EndedAt = &t
	}
	return &sess, nil
}
