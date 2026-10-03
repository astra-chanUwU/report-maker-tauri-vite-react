package controlplane

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

type rateLimiter struct {
	mu      sync.Mutex
	entries map[string][]time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{entries: map[string][]time.Time{}}
}

func (l *rateLimiter) allow(key string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-window)
	history := l.entries[key]
	filtered := history[:0]
	for _, ts := range history {
		if ts.After(cutoff) {
			filtered = append(filtered, ts)
		}
	}
	if len(filtered) >= limit {
		l.entries[key] = filtered
		return false
	}
	l.entries[key] = append(filtered, now)
	return true
}

func (a *App) clientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
		return forwarded
	}
	host := r.RemoteAddr
	if idx := strings.LastIndex(host, ":"); idx > 0 {
		return host[:idx]
	}
	return host
}

func (a *App) rateLimit(w http.ResponseWriter, r *http.Request, action string, limit int, window time.Duration) bool {
	key := a.clientIP(r) + ":" + action
	if a.rateLimits.allow(key, limit, window) {
		return true
	}
	http.Error(w, "Too many requests. Please try again later.", http.StatusTooManyRequests)
	return false
}
