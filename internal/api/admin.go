package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/yttrix/olc-ui/internal/store"
)

// maxRestoreSize bounds an uploaded backup.
const maxRestoreSize = 256 << 20

func (s *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	devs, err := s.store.Devices(id)
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, devs)
}

func (s *Server) handleDeviceAction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		HWID   string `json:"hwid"`
		Action string `json:"action"` // block, unblock, delete
	}
	if !readJSON(w, r, &in) {
		return
	}
	var err error
	switch in.Action {
	case "block", "unblock":
		err = s.store.SetDeviceBlocked(id, in.HWID, in.Action == "block")
	case "delete":
		err = s.store.DeleteDevice(id, in.HWID)
	default:
		writeErr(w, http.StatusBadRequest, "unknown action")
		return
	}
	if err != nil {
		storeErr(w, err)
		return
	}
	s.store.Audit("device_"+in.Action, fmt.Sprintf("%d %s", id, in.HWID))
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleBackup(w http.ResponseWriter, _ *http.Request) {
	f, err := os.CreateTemp(s.tmpDir, "backup-*.db")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)
	if err := s.store.Backup(path); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	data, err := os.Open(path)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer data.Close()
	name := "olc-ui-backup-" + time.Now().Format("2006-01-02-1504") + ".db"
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	if st, err := data.Stat(); err == nil {
		w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	}
	_, _ = io.Copy(w, data)
	s.store.Audit("backup_downloaded", name)
}

func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRestoreSize)
	file, _, err := r.FormFile("backup")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "upload a backup file in the \"backup\" field")
		return
	}
	defer file.Close()
	tmp, err := os.CreateTemp(s.tmpDir, "restore-*.db")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	path := tmp.Name()
	defer os.Remove(path)
	_, err = io.Copy(tmp, file)
	tmp.Close()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "upload failed: "+err.Error())
		return
	}
	sum, err := s.store.Restore(r.Context(), path)
	if errors.Is(err, store.ErrNotBackup) {
		writeErr(w, http.StatusBadRequest, "this file is not an olc-ui backup")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.Audit("backup_restored", fmt.Sprintf("%d clients, %d locations", sum.Clients, sum.Locations))
	s.sup.Kick()
	writeJSON(w, sum)
}

func (s *Server) handleSystem(w http.ResponseWriter, _ *http.Request) {
	resp := map[string]any{"version": s.version, "tls": nil}
	if s.certStatus != nil {
		resp["tls"] = s.certStatus()
	}
	writeJSON(w, resp)
}

// tempDir returns a writable directory for backup files.
func tempDir(dataDir string) string {
	dir := filepath.Join(dataDir, "run")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return os.TempDir()
	}
	return dir
}
