// Package store persists panel state in SQLite: settings, admin sessions,
// clients with their locations, daily traffic and an audit log.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, keeps CGO_ENABLED=0
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

// ErrConflict is returned when a unique field is already taken.
var ErrConflict = errors.New("already exists")

// Store wraps the database handle.
type Store struct{ db *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clients (
	id            INTEGER PRIMARY KEY,
	name          TEXT NOT NULL UNIQUE,
	note          TEXT NOT NULL DEFAULT '',
	enabled       INTEGER NOT NULL DEFAULT 1,
	speed_mbps    INTEGER NOT NULL DEFAULT 0,
	traffic_limit INTEGER NOT NULL DEFAULT 0,
	used_bytes    INTEGER NOT NULL DEFAULT 0,
	expires_at    TEXT NOT NULL DEFAULT '',
	refresh       TEXT NOT NULL DEFAULT '',
	sub_token     TEXT NOT NULL UNIQUE,
	created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
	id         INTEGER PRIMARY KEY,
	client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
	name       TEXT NOT NULL DEFAULT '',
	enabled    INTEGER NOT NULL DEFAULT 1,
	endpoint   TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS traffic (
	client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
	day       TEXT NOT NULL,
	down      INTEGER NOT NULL DEFAULT 0,
	up        INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (client_id, day)
);
CREATE TABLE IF NOT EXISTS audit (
	id     INTEGER PRIMARY KEY,
	ts     INTEGER NOT NULL,
	action TEXT NOT NULL,
	detail TEXT NOT NULL DEFAULT ''
);
`

// Open opens (and migrates) the database at path.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() } //nolint:wrapcheck // passthrough

// Setting returns a setting value or "" when unset.
func (s *Store) Setting(key string) string {
	var v string
	_ = s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v)
	return v
}

// SetSetting stores a setting value.
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings(key,value) VALUES(?,?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return wrap(err)
}

// CreateSession stores a hashed session token.
func (s *Store) CreateSession(tokenHash string, ttl time.Duration) error {
	_, _ = s.db.Exec(`DELETE FROM sessions WHERE expires < ?`, time.Now().Unix())
	_, err := s.db.Exec(`INSERT INTO sessions(token,expires) VALUES(?,?)`, tokenHash, time.Now().Add(ttl).Unix())
	return wrap(err)
}

// SessionValid reports whether a hashed token exists and is not expired.
func (s *Store) SessionValid(tokenHash string) bool {
	var exp int64
	if s.db.QueryRow(`SELECT expires FROM sessions WHERE token=?`, tokenHash).Scan(&exp) != nil {
		return false
	}
	return exp > time.Now().Unix()
}

// DeleteSession removes a session; all == true removes every session.
func (s *Store) DeleteSession(tokenHash string, all bool) {
	if all {
		_, _ = s.db.Exec(`DELETE FROM sessions`)
		return
	}
	_, _ = s.db.Exec(`DELETE FROM sessions WHERE token=?`, tokenHash)
}

// AuditEntry is one audit log row.
type AuditEntry struct {
	TS     int64  `json:"ts"`
	Action string `json:"action"`
	Detail string `json:"detail"`
}

// Audit appends an audit entry.
func (s *Store) Audit(action, detail string) {
	_, _ = s.db.Exec(`INSERT INTO audit(ts,action,detail) VALUES(?,?,?)`, time.Now().Unix(), action, detail)
	_, _ = s.db.Exec(`DELETE FROM audit WHERE id <= (SELECT MAX(id) - 5000 FROM audit)`)
}

// AuditLog returns the latest entries, newest first.
func (s *Store) AuditLog(limit int) ([]AuditEntry, error) {
	rows, err := s.db.Query(`SELECT ts,action,detail FROM audit ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, wrap(err)
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.TS, &e.Action, &e.Detail); err != nil {
			return nil, wrap(err)
		}
		out = append(out, e)
	}
	return out, wrap(rows.Err())
}

// RandomToken returns n random bytes as hex.
func RandomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func wrap(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return fmt.Errorf("db: %w", err)
}

func (s *Store) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return wrap(err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return wrap(tx.Commit())
}
