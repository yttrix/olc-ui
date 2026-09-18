package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/yttrix/olc-ui/internal/spec"
)

// Client is a subscriber: quotas plus one or more locations.
type Client struct {
	ID           int64      `json:"id"`
	Name         string     `json:"name"`
	Note         string     `json:"note"`
	Enabled      bool       `json:"enabled"`
	SpeedMbps    int        `json:"speed_mbps"`
	TrafficLimit int64      `json:"traffic_limit"` // bytes, 0 = unlimited
	UsedBytes    int64      `json:"used_bytes"`
	ExpiresAt    string     `json:"expires_at"` // YYYY-MM-DD, "" = never
	Refresh      string     `json:"refresh"`
	SubToken     string     `json:"sub_token"`
	CreatedAt    int64      `json:"created_at"`
	Locations    []Location `json:"locations"`
}

// Location is one tunnel endpoint served for a client.
type Location struct {
	ID        int64         `json:"id"`
	ClientID  int64         `json:"client_id"`
	Name      string        `json:"name"`
	Enabled   bool          `json:"enabled"`
	Endpoint  spec.Endpoint `json:"endpoint"`
	CreatedAt int64         `json:"created_at"`
}

// Status values derived from quotas.
const (
	StatusActive   = "active"
	StatusDisabled = "disabled"
	StatusExpired  = "expired"
	StatusOverQuot = "traffic_exceeded"
)

// Status returns the quota status of the client at time now.
func (c Client) Status(now time.Time) string {
	switch {
	case !c.Enabled:
		return StatusDisabled
	case c.ExpiresAt != "" && now.Format(time.DateOnly) > c.ExpiresAt:
		return StatusExpired
	case c.TrafficLimit > 0 && c.UsedBytes >= c.TrafficLimit:
		return StatusOverQuot
	default:
		return StatusActive
	}
}

const clientCols = `id,name,note,enabled,speed_mbps,traffic_limit,used_bytes,expires_at,refresh,sub_token,created_at`

func scanClient(sc interface{ Scan(...any) error }) (Client, error) {
	var c Client
	err := sc.Scan(&c.ID, &c.Name, &c.Note, &c.Enabled, &c.SpeedMbps, &c.TrafficLimit,
		&c.UsedBytes, &c.ExpiresAt, &c.Refresh, &c.SubToken, &c.CreatedAt)
	return c, wrap(err)
}

// Clients returns all clients with their locations, ordered by id.
func (s *Store) Clients() ([]Client, error) {
	rows, err := s.db.Query(`SELECT ` + clientCols + ` FROM clients ORDER BY id`)
	if err != nil {
		return nil, wrap(err)
	}
	var out []Client
	idx := map[int64]int{}
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		c.Locations = []Location{}
		idx[c.ID] = len(out)
		out = append(out, c)
	}
	rows.Close()
	locs, err := s.locations(`ORDER BY id`)
	if err != nil {
		return nil, err
	}
	for _, l := range locs {
		if i, ok := idx[l.ClientID]; ok {
			out[i].Locations = append(out[i].Locations, l)
		}
	}
	if out == nil {
		out = []Client{}
	}
	return out, nil
}

// Client returns one client with locations.
func (s *Store) Client(id int64) (Client, error) {
	c, err := scanClient(s.db.QueryRow(`SELECT `+clientCols+` FROM clients WHERE id=?`, id))
	if err != nil {
		return c, err
	}
	c.Locations, err = s.locations(`WHERE client_id=? ORDER BY id`, id)
	return c, err
}

// ClientBySubToken resolves a subscription token.
func (s *Store) ClientBySubToken(token string) (Client, error) {
	var id int64
	if err := s.db.QueryRow(`SELECT id FROM clients WHERE sub_token=?`, token).Scan(&id); err != nil {
		return Client{}, wrap(err)
	}
	return s.Client(id)
}

// SaveClient inserts (ID == 0) or updates client fields. Usage counters and
// the subscription token are not touched on update.
func (s *Store) SaveClient(c *Client) error {
	if c.ID == 0 {
		c.SubToken = RandomToken(16)
		c.CreatedAt = time.Now().Unix()
		res, err := s.db.Exec(`INSERT INTO clients(name,note,enabled,speed_mbps,traffic_limit,expires_at,refresh,sub_token,created_at)
			VALUES(?,?,?,?,?,?,?,?,?)`, c.Name, c.Note, c.Enabled, c.SpeedMbps, c.TrafficLimit, c.ExpiresAt, c.Refresh, c.SubToken, c.CreatedAt)
		if err != nil {
			return uniq(err)
		}
		c.ID, _ = res.LastInsertId()
		return nil
	}
	res, err := s.db.Exec(`UPDATE clients SET name=?,note=?,enabled=?,speed_mbps=?,traffic_limit=?,expires_at=?,refresh=? WHERE id=?`,
		c.Name, c.Note, c.Enabled, c.SpeedMbps, c.TrafficLimit, c.ExpiresAt, c.Refresh, c.ID)
	if err != nil {
		return uniq(err)
	}
	return affected(res)
}

// DeleteClient removes a client and (by cascade) its locations and traffic.
func (s *Store) DeleteClient(id int64) error {
	res, err := s.db.Exec(`DELETE FROM clients WHERE id=?`, id)
	if err != nil {
		return wrap(err)
	}
	return affected(res)
}

// ResetUsage zeroes the used traffic counter.
func (s *Store) ResetUsage(id int64) error {
	res, err := s.db.Exec(`UPDATE clients SET used_bytes=0 WHERE id=?`, id)
	if err != nil {
		return wrap(err)
	}
	return affected(res)
}

// RotateSubToken issues a new subscription token (old links stop working).
func (s *Store) RotateSubToken(id int64) (string, error) {
	tok := RandomToken(16)
	res, err := s.db.Exec(`UPDATE clients SET sub_token=? WHERE id=?`, tok, id)
	if err != nil {
		return "", wrap(err)
	}
	return tok, affected(res)
}

// AddUsage accounts traffic deltas per client for today, in one transaction.
func (s *Store) AddUsage(ctx context.Context, deltas map[int64][2]uint64, now time.Time) error {
	day := now.Format(time.DateOnly)
	return s.tx(ctx, func(tx *sql.Tx) error {
		for id, d := range deltas {
			if _, err := tx.Exec(`UPDATE clients SET used_bytes=used_bytes+? WHERE id=?`, d[0]+d[1], id); err != nil {
				return wrap(err)
			}
			if _, err := tx.Exec(`INSERT INTO traffic(client_id,day,down,up) VALUES(?,?,?,?)
				ON CONFLICT(client_id,day) DO UPDATE SET down=down+excluded.down, up=up+excluded.up`,
				id, day, d[0], d[1]); err != nil {
				return wrap(err)
			}
		}
		return nil
	})
}

// DayTraffic is one day of traffic.
type DayTraffic struct {
	Day  string `json:"day"`
	Down int64  `json:"down"`
	Up   int64  `json:"up"`
}

// Traffic returns per-day traffic for the last n days, oldest first, with
// missing days filled with zeros. clientID 0 means all clients.
func (s *Store) Traffic(clientID int64, days int, now time.Time) ([]DayTraffic, error) {
	from := now.AddDate(0, 0, -(days - 1)).Format(time.DateOnly)
	q := `SELECT day, SUM(down), SUM(up) FROM traffic WHERE day >= ?`
	args := []any{from}
	if clientID != 0 {
		q += ` AND client_id=?`
		args = append(args, clientID)
	}
	rows, err := s.db.Query(q+` GROUP BY day`, args...)
	if err != nil {
		return nil, wrap(err)
	}
	defer rows.Close()
	got := map[string]DayTraffic{}
	for rows.Next() {
		var d DayTraffic
		if err := rows.Scan(&d.Day, &d.Down, &d.Up); err != nil {
			return nil, wrap(err)
		}
		got[d.Day] = d
	}
	out := make([]DayTraffic, 0, days)
	for i := days - 1; i >= 0; i-- {
		day := now.AddDate(0, 0, -i).Format(time.DateOnly)
		d := got[day]
		d.Day = day
		out = append(out, d)
	}
	return out, wrap(rows.Err())
}

func (s *Store) locations(where string, args ...any) ([]Location, error) {
	rows, err := s.db.Query(`SELECT id,client_id,name,enabled,endpoint,created_at FROM locations `+where, args...)
	if err != nil {
		return nil, wrap(err)
	}
	defer rows.Close()
	out := []Location{}
	for rows.Next() {
		var l Location
		var raw string
		if err := rows.Scan(&l.ID, &l.ClientID, &l.Name, &l.Enabled, &raw, &l.CreatedAt); err != nil {
			return nil, wrap(err)
		}
		if err := json.Unmarshal([]byte(raw), &l.Endpoint); err != nil {
			return nil, fmt.Errorf("location %d endpoint: %w", l.ID, err)
		}
		out = append(out, l)
	}
	return out, wrap(rows.Err())
}

// Location returns one location.
func (s *Store) Location(id int64) (Location, error) {
	locs, err := s.locations(`WHERE id=?`, id)
	if err != nil {
		return Location{}, err
	}
	if len(locs) == 0 {
		return Location{}, ErrNotFound
	}
	return locs[0], nil
}

// SaveLocation inserts (ID == 0) or updates a location.
func (s *Store) SaveLocation(l *Location) error {
	raw, err := json.Marshal(l.Endpoint)
	if err != nil {
		return fmt.Errorf("marshal endpoint: %w", err)
	}
	if l.ID == 0 {
		l.CreatedAt = time.Now().Unix()
		res, err := s.db.Exec(`INSERT INTO locations(client_id,name,enabled,endpoint,created_at) VALUES(?,?,?,?,?)`,
			l.ClientID, l.Name, l.Enabled, string(raw), l.CreatedAt)
		if err != nil {
			return wrap(err)
		}
		l.ID, _ = res.LastInsertId()
		return nil
	}
	res, err := s.db.Exec(`UPDATE locations SET name=?,enabled=?,endpoint=? WHERE id=?`, l.Name, l.Enabled, string(raw), l.ID)
	if err != nil {
		return wrap(err)
	}
	return affected(res)
}

// DeleteLocation removes a location.
func (s *Store) DeleteLocation(id int64) error {
	res, err := s.db.Exec(`DELETE FROM locations WHERE id=?`, id)
	if err != nil {
		return wrap(err)
	}
	return affected(res)
}

func affected(res sql.Result) error {
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func uniq(err error) error {
	if strings.Contains(err.Error(), "UNIQUE") {
		return ErrConflict
	}
	return wrap(err)
}
