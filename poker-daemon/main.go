package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Hand struct {
	ID        int    `json:"id"`
	RawJSON   string `json:"raw_json"`
	Analyzed  bool   `json:"analyzed"`
	Timestamp string `json:"timestamp"`
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok","time":"` + time.Now().UTC().Format(time.RFC3339) + `"}`))
}

func parseSQLiteTime(ts string) (time.Time, error) {
	formats := []string{
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05-07:00",
		time.RFC3339,
	}
	for _, f := range formats {
		if t, err := time.Parse(f, ts); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unknown time format: %s", ts)
}

func loadEnv() {
	file, err := os.Open(".env")
	if err != nil {
		return // Ignore if .env doesn't exist
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			if strings.HasPrefix(val, "\"") && strings.HasSuffix(val, "\"") {
				val = val[1 : len(val)-1]
			} else if strings.HasPrefix(val, "'") && strings.HasSuffix(val, "'") {
				val = val[1 : len(val)-1]
			}
			os.Setenv(key, val)
		}
	}
}

func initDB() error {
	dbPath := "hands.db"
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS hands (id INTEGER PRIMARY KEY AUTOINCREMENT, raw_json TEXT, analyzed INTEGER, created_at DATETIME)`)
	if err != nil {
		return err
	}

	var count int
	err = db.QueryRow(`SELECT COUNT(*) FROM hands`).Scan(&count)
	if err != nil {
		return err
	}

	if count == 0 {
		_, err = db.Exec(`INSERT INTO hands (raw_json, analyzed, created_at) VALUES ('{"cards":"AhKd"}', 0, datetime('now'))`)
		if err != nil {
			return err
		}
		_, err = db.Exec(`INSERT INTO hands (raw_json, analyzed, created_at) VALUES ('{"cards":"7c5s"}', 0, datetime('now','-1 hour'))`)
		if err != nil {
			return err
		}
		log.Println("Database seeded with sample hands.")
	}
	return nil
}

func handsHandler(w http.ResponseWriter, r *http.Request) {
	dbPath := "hands.db"
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		http.Error(w, "cannot open database: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	// Query for unanalyzed hands
	rows, err := db.Query(`SELECT id, raw_json, analyzed, created_at FROM hands WHERE analyzed = 0 ORDER BY created_at DESC LIMIT 10`)
	if err != nil {
		http.Error(w, "query error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var hands []Hand
	for rows.Next() {
		var h Hand
		var analyzedInt int
		var ts string
		if err := rows.Scan(&h.ID, &h.RawJSON, &analyzedInt, &ts); err != nil {
			http.Error(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		h.Analyzed = analyzedInt != 0

		// Parse the timestamp and format as RFC3339
		parsedTime, err := parseSQLiteTime(ts)
		if err != nil {
			h.Timestamp = ts
		} else {
			h.Timestamp = parsedTime.Format(time.RFC3339)
		}

		hands = append(hands, h)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "rows error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(hands)
}

func analyzeHandHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := r.URL.Path
	if !strings.HasPrefix(path, "/mcp/hands/") || !strings.HasSuffix(path, "/analyze") {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	idStr := strings.TrimPrefix(path, "/mcp/hands/")
	idStr = strings.TrimSuffix(idStr, "/analyze")

	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid hand ID", http.StatusBadRequest)
		return
	}

	dbPath := "hands.db"
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		http.Error(w, "cannot open database: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	res, err := db.Exec(`UPDATE hands SET analyzed = 1 WHERE id = ?`, id)
	if err != nil {
		http.Error(w, "database update error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		http.Error(w, "error getting rows affected: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if rowsAffected == 0 {
		http.Error(w, "hand not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true}`))
}

func handsDispatcherHandler(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if (path == "/mcp/hands" || path == "/mcp/hands/") && r.Method == http.MethodGet {
		handsHandler(w, r)
		return
	}
	if strings.HasPrefix(path, "/mcp/hands/") && strings.HasSuffix(path, "/analyze") && r.Method == http.MethodPost {
		analyzeHandHandler(w, r)
		return
	}
	http.Error(w, "not found", http.StatusNotFound)
}

func main() {
	loadEnv()

	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	mcpProxyURL, err := url.Parse("http://127.0.0.1:8001")
	if err != nil {
		log.Fatalf("Failed to parse MCP proxy URL: %v", err)
	}
	mcpProxy := httputil.NewSingleHostReverseProxy(mcpProxyURL)
	originalDirector := mcpProxy.Director
	mcpProxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = mcpProxyURL.Host
	}

	sidecarProxyURL, err := url.Parse("http://127.0.0.1:8765")
	if err != nil {
		log.Fatalf("Failed to parse sidecar proxy URL: %v", err)
	}
	sidecarProxy := httputil.NewSingleHostReverseProxy(sidecarProxyURL)
	originalSidecarDirector := sidecarProxy.Director
	sidecarProxy.Director = func(req *http.Request) {
		originalSidecarDirector(req)
		req.Host = sidecarProxyURL.Host
	}

	http.HandleFunc("/query", func(w http.ResponseWriter, r *http.Request) {
		sidecarProxy.ServeHTTP(w, r)
	})

	// Return 404 for OAuth discovery paths so Claude's connector skips auth
	// and connects directly. A 200 (or any non-404) response on these paths
	// makes Claude attempt an OAuth flow and show "couldn't register with
	// LeakSnipe's sign-in service" / ofid_* errors.
	noAuth := func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Not found", http.StatusNotFound)
	}
	http.HandleFunc("/.well-known/oauth-authorization-server", noAuth)
	http.HandleFunc("/.well-known/oauth-protected-resource", noAuth)
	http.HandleFunc("/.well-known/openid-configuration", noAuth)

	// Route MCP client endpoints to python MCP server
	http.HandleFunc("/sse", func(w http.ResponseWriter, r *http.Request) {
		mcpProxy.ServeHTTP(w, r)
	})
	http.HandleFunc("/messages", func(w http.ResponseWriter, r *http.Request) {
		mcpProxy.ServeHTTP(w, r)
	})
	http.HandleFunc("/messages/", func(w http.ResponseWriter, r *http.Request) {
		mcpProxy.ServeHTTP(w, r)
	})
	http.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		mcpProxy.ServeHTTP(w, r)
	})

	http.HandleFunc("/mcp/health", healthHandler)
	http.HandleFunc("/mcp/hands", handsDispatcherHandler)
	http.HandleFunc("/mcp/hands/", handsDispatcherHandler)
	http.HandleFunc("/mcp/claude", claudeProxyHandler)

	// Optional root page for local debugging
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Poker daemon is running – use /mcp/health, /mcp/hands, or /mcp/claude"))
	})

	addr := ":8080"
	log.Printf("Listening on %s …", addr)
	exampleR2Usage() // start R2 client in background
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
