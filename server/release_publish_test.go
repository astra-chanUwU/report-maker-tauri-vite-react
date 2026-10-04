package controlplane

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPublishReleaseManifestUpdatesChecksums(t *testing.T) {
	root := t.TempDir()
	rel := "windows-x64/app.exe"
	payload := []byte("publish-release-test")
	_ = os.MkdirAll(filepath.Join(root, "windows-x64"), 0o755)
	_ = os.WriteFile(filepath.Join(root, rel), payload, 0o644)
	manifest := filepath.Join(t.TempDir(), "releases.json")
	got, err := PublishReleaseManifest(manifest, root, []PublishReleaseEntry{{ID: "desktop-windows-x64", Version: "1", Filename: "app.exe", RelativePath: rel, Platform: "Windows x64", Description: "t"}})
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	if got[0].SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatal("sha mismatch")
	}
}

func TestVerifyArtifactChecksumRejectsMismatch(t *testing.T) {
	p := filepath.Join(t.TempDir(), "f")
	_ = os.WriteFile(p, []byte("x"), 0o644)
	if VerifyArtifactChecksum(p, strings.Repeat("a", 64)) == nil {
		t.Fatal("want error")
	}
}

func TestOpenArtifactFileRejectsSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("windows symlinks")
	}
	root := t.TempDir()
	tgt := filepath.Join(root, "real")
	_ = os.WriteFile(tgt, []byte("r"), 0o644)
	if err := os.Symlink(tgt, filepath.Join(root, "link")); err != nil {
		t.Skip(err)
	}
	if _, _, err := OpenArtifactFile(root, "link"); err == nil {
		t.Fatal("want reject")
	}
}

func TestFixtureArtifactsMatchEmbeddedManifest(t *testing.T) {
	root, _ := filepath.Abs("testdata/artifacts")
	c, err := LoadReleaseCatalog(root, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range c.Artifacts {
		p, _ := c.ResolveArtifactPath(a.RelativePath)
		if err := VerifyArtifactChecksum(p, a.SHA256); err != nil {
			t.Fatalf("%s: %v", a.ID, err)
		}
	}
}
