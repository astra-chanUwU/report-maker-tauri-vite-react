package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	cp "reportmaker/controlplane"
)

func main() {
	m := flag.String("manifest", "releases.json", "")
	r := flag.String("root", "testdata/artifacts", "")
	s := flag.String("spec", "", "")
	flag.Parse()
	entries, err := load(*s)
	if err != nil {
		log.Fatal(err)
	}
	mp, _ := filepath.Abs(*m)
	rp, _ := filepath.Abs(*r)
	out, err := cp.PublishReleaseManifest(mp, rp, entries)
	if err != nil {
		log.Fatal(err)
	}
	for _, a := range out {
		fmt.Printf("%s %s sha256=%s\n", a.ID, a.Version, a.SHA256)
	}
}

func load(spec string) ([]cp.PublishReleaseEntry, error) {
	if spec == "" {
		return []cp.PublishReleaseEntry{
			{ID: "desktop-windows-x64", Version: "1.0.0-fixture", Filename: "ReportMaker_1.0.0_x64-setup.exe", RelativePath: "windows-x64/ReportMaker_1.0.0_x64-setup.exe", Platform: "Windows x64", Description: "Test fixture installer. Replace with signed Tauri build in production."},
			{ID: "desktop-macos-universal", Version: "1.0.0-fixture", Filename: "ReportMaker_1.0.0_universal.dmg", RelativePath: "macos-universal/ReportMaker_1.0.0_universal.dmg", Platform: "macOS universal", Description: "Test fixture disk image. Replace with signed Tauri build in production."},
		}, nil
	}
	b, err := os.ReadFile(spec)
	if err != nil {
		return nil, err
	}
	var e []cp.PublishReleaseEntry
	return e, json.Unmarshal(b, &e)
}
