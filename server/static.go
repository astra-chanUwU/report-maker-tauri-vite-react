package controlplane

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed static/*
var staticFS embed.FS

func (a *App) staticRoutes() {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		return
	}
	fileServer := http.FileServer(http.FS(sub))
	a.mux.Handle("GET /static/", http.StripPrefix("/static/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=86400")
		fileServer.ServeHTTP(w, r)
	})))
}
