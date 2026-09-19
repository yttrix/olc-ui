package store

import (
	"errors"
	"strings"
	"time"
)

// ErrDeviceLimit is returned when a new device exceeds the client limit.
var ErrDeviceLimit = errors.New("device limit reached")

// ErrDeviceBlocked is returned for a device the admin has blocked.
var ErrDeviceBlocked = errors.New("device blocked")

// Device is a client app installation seen on subscription requests
// (identified by the x-hwid header olcbox sends).
type Device struct {
	HWID      string `json:"hwid"`
	UserAgent string `json:"user_agent"`
	IP        string `json:"ip"`
	FirstSeen int64  `json:"first_seen"`
	LastSeen  int64  `json:"last_seen"`
	Blocked   bool   `json:"blocked"`
}

// TouchDevice records a subscription fetch. A new device is refused once the
// client already has max devices (0 = unlimited); known devices always pass
// unless blocked.
func (s *Store) TouchDevice(clientID int64, hwid, userAgent, ip string, max int) error {
	hwid = strings.TrimSpace(hwid)
	if len(hwid) > 128 {
		hwid = hwid[:128]
	}
	if len(userAgent) > 200 {
		userAgent = userAgent[:200]
	}
	now := time.Now().Unix()
	var blocked bool
	err := s.db.QueryRow(`SELECT blocked FROM devices WHERE client_id=? AND hwid=?`, clientID, hwid).Scan(&blocked)
	switch {
	case err == nil:
		if blocked {
			return ErrDeviceBlocked
		}
		_, err = s.db.Exec(`UPDATE devices SET last_seen=?, user_agent=?, ip=? WHERE client_id=? AND hwid=?`,
			now, userAgent, ip, clientID, hwid)
		return wrap(err)
	case !errors.Is(wrap(err), ErrNotFound):
		return wrap(err)
	}
	if max > 0 {
		var n int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM devices WHERE client_id=? AND blocked=0`, clientID).Scan(&n)
		if n >= max {
			return ErrDeviceLimit
		}
	}
	_, err = s.db.Exec(`INSERT INTO devices(client_id,hwid,user_agent,ip,first_seen,last_seen) VALUES(?,?,?,?,?,?)`,
		clientID, hwid, userAgent, ip, now, now)
	return wrap(err)
}

// Devices lists a client's devices, most recent first.
func (s *Store) Devices(clientID int64) ([]Device, error) {
	rows, err := s.db.Query(`SELECT hwid,user_agent,ip,first_seen,last_seen,blocked FROM devices
		WHERE client_id=? ORDER BY last_seen DESC`, clientID)
	if err != nil {
		return nil, wrap(err)
	}
	defer rows.Close()
	out := []Device{}
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.HWID, &d.UserAgent, &d.IP, &d.FirstSeen, &d.LastSeen, &d.Blocked); err != nil {
			return nil, wrap(err)
		}
		out = append(out, d)
	}
	return out, wrap(rows.Err())
}

// DeviceCounts returns non-blocked device counts per client.
func (s *Store) DeviceCounts() (map[int64]int, error) {
	rows, err := s.db.Query(`SELECT client_id, COUNT(*) FROM devices WHERE blocked=0 GROUP BY client_id`)
	if err != nil {
		return nil, wrap(err)
	}
	defer rows.Close()
	out := map[int64]int{}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, wrap(err)
		}
		out[id] = n
	}
	return out, wrap(rows.Err())
}

// SetDeviceBlocked blocks or unblocks a device.
func (s *Store) SetDeviceBlocked(clientID int64, hwid string, blocked bool) error {
	res, err := s.db.Exec(`UPDATE devices SET blocked=? WHERE client_id=? AND hwid=?`, blocked, clientID, hwid)
	if err != nil {
		return wrap(err)
	}
	return affected(res)
}

// DeleteDevice forgets a device, freeing a slot.
func (s *Store) DeleteDevice(clientID int64, hwid string) error {
	res, err := s.db.Exec(`DELETE FROM devices WHERE client_id=? AND hwid=?`, clientID, hwid)
	if err != nil {
		return wrap(err)
	}
	return affected(res)
}

// SetLastOnline marks clients as seen online at ts.
func (s *Store) SetLastOnline(ids []int64, ts int64) {
	for _, id := range ids {
		_, _ = s.db.Exec(`UPDATE clients SET last_online=? WHERE id=? AND last_online<?`, ts, id, ts)
	}
}

// RoomInUse returns the name of another location that already uses room on
// provider (two tunnel servers in one room interfere with each other).
func (s *Store) RoomInUse(provider, room string, exceptID int64) (string, bool) {
	locs, err := s.locations(`WHERE id<>?`, exceptID)
	if err != nil {
		return "", false
	}
	for _, l := range locs {
		if l.Endpoint.Provider == provider && strings.EqualFold(l.Endpoint.Room, room) {
			var client string
			_ = s.db.QueryRow(`SELECT name FROM clients WHERE id=?`, l.ClientID).Scan(&client)
			name := l.Name
			if name == "" {
				name = l.Endpoint.Room
			}
			return client + " / " + name, true
		}
	}
	return "", false
}
