package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
)

// ErrNotBackup is returned when a restore file is not an olc-ui database.
var ErrNotBackup = errors.New("file is not an olc-ui backup")

// Settings that describe clients and subscriptions travel with a backup;
// access settings (admin login, panel path) stay with the server.
var restoredSettings = []string{"panel_name", "public_host", "sub_refresh", "jitsi_instance"} //nolint:gochecknoglobals // static list

// Backup writes a consistent snapshot of the database to path.
func (s *Store) Backup(path string) error {
	_ = os.Remove(path)
	if _, err := s.db.Exec(`VACUUM INTO ?`, path); err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	return nil
}

// RestoreSummary tells what a restore brought in.
type RestoreSummary struct {
	Clients   int `json:"clients"`
	Locations int `json:"locations"`
}

// Restore replaces clients, locations, traffic, devices and subscription
// settings with those from the backup at path, in one transaction. Admin
// credentials, sessions and the panel path of this server are kept.
func (s *Store) Restore(ctx context.Context, path string) (RestoreSummary, error) {
	var sum RestoreSummary
	if err := checkBackup(path); err != nil {
		return sum, err
	}
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return sum, wrap(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS bk`, path); err != nil {
		return sum, fmt.Errorf("attach backup: %w", err)
	}
	defer func() { _, _ = conn.ExecContext(context.Background(), `DETACH DATABASE bk`) }()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return sum, wrap(err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM main.clients`); err != nil { // cascades
		return sum, wrap(err)
	}
	for _, table := range []string{"clients", "locations", "traffic", "devices"} {
		if err := copyTable(ctx, tx, table); err != nil {
			return sum, err
		}
	}
	for _, key := range restoredSettings {
		if _, err := tx.ExecContext(ctx, `INSERT INTO main.settings(key,value)
			SELECT key,value FROM bk.settings WHERE key=?
			ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key); err != nil {
			return sum, wrap(err)
		}
	}
	_ = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM main.clients`).Scan(&sum.Clients)
	_ = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM main.locations`).Scan(&sum.Locations)
	if err := tx.Commit(); err != nil {
		return sum, wrap(err)
	}
	return sum, nil
}

// copyTable copies the columns both schemas share, so backups from older
// versions restore into newer databases (new columns take their defaults).
func copyTable(ctx context.Context, tx *sql.Tx, table string) error {
	cols := func(schema string) (map[string]bool, []string, error) {
		rows, err := tx.QueryContext(ctx, `SELECT name FROM pragma_table_info(?, ?)`, table, schema)
		if err != nil {
			return nil, nil, wrap(err)
		}
		defer rows.Close()
		set, list := map[string]bool{}, []string{}
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				return nil, nil, wrap(err)
			}
			set[n] = true
			list = append(list, n)
		}
		return set, list, wrap(rows.Err())
	}
	bk, _, err := cols("bk")
	if err != nil {
		return err
	}
	if len(bk) == 0 {
		return nil // table absent in older backups
	}
	_, mainCols, err := cols("main")
	if err != nil {
		return err
	}
	shared := []string{}
	for _, c := range mainCols {
		if bk[c] {
			shared = append(shared, c)
		}
	}
	list := strings.Join(shared, ",")
	if _, err := tx.ExecContext(ctx, `INSERT INTO main.`+table+`(`+list+`) SELECT `+list+` FROM bk.`+table); err != nil {
		return fmt.Errorf("restore %s: %w", table, err)
	}
	return nil
}

func checkBackup(path string) error {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return ErrNotBackup
	}
	defer db.Close()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('clients','locations','settings')`).Scan(&n); err != nil || n != 3 {
		return ErrNotBackup
	}
	return nil
}
