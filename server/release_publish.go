package controlplane

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type PublishReleaseEntry struct {
	ID, Version, Filename, RelativePath, Platform, Description string
}

func ComputeFileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func BuildReleaseArtifact(root string, e PublishReleaseEntry) (ReleaseArtifact, error) {
	if strings.TrimSpace(e.ID) == "" || strings.Contains(e.RelativePath, "..") {
		return ReleaseArtifact{}, errors.New("invalid publish entry")
	}
	abs, _ := filepath.Abs(strings.TrimSpace(root))
	p, err := joinArtifactRoot(abs, e.RelativePath)
	if err != nil {
		return ReleaseArtifact{}, err
	}
	info, err := os.Lstat(p)
	if err != nil {
		return ReleaseArtifact{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || info.IsDir() {
		return ReleaseArtifact{}, errors.New("artifact must be a regular file")
	}
	sum, err := ComputeFileSHA256(p)
	if err != nil {
		return ReleaseArtifact{}, err
	}
	a := ReleaseArtifact{ID: e.ID, Version: e.Version, Filename: e.Filename, SHA256: sum, RelativePath: filepath.ToSlash(e.RelativePath), Platform: e.Platform, Description: e.Description}
	return a, validateReleaseArtifact(a)
}

func PublishReleaseManifest(manifest, root string, entries []PublishReleaseEntry) ([]ReleaseArtifact, error) {
	var artifacts []ReleaseArtifact
	if raw, err := os.ReadFile(manifest); err == nil {
		_ = json.Unmarshal(raw, &artifacts)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	byID := map[string]ReleaseArtifact{}
	for _, a := range artifacts {
		byID[a.ID] = a
	}
	for _, e := range entries {
		a, err := BuildReleaseArtifact(root, e)
		if err != nil {
			return nil, err
		}
		byID[a.ID] = a
	}
	out := make([]ReleaseArtifact, 0, len(byID))
	for _, a := range byID {
		out = append(out, a)
	}
	sortReleaseArtifacts(out)
	b, _ := json.MarshalIndent(out, "", "  ")
	b = append(b, '\n')
	return out, os.WriteFile(manifest, b, 0o644)
}

func sortReleaseArtifacts(a []ReleaseArtifact) {
	for i := range a {
		for j := i + 1; j < len(a); j++ {
			if a[j].ID < a[i].ID {
				a[i], a[j] = a[j], a[i]
			}
		}
	}
}

func joinArtifactRoot(root, rel string) (string, error) {
	if strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "\\") || strings.Contains(rel, "..") {
		return "", errors.New("invalid artifact path")
	}
	target := filepath.Clean(filepath.Join(root, filepath.Clean(strings.ReplaceAll(rel, "\\", "/"))))
	prefix := root + string(os.PathSeparator)
	if target != root && !strings.HasPrefix(target, prefix) {
		return "", errors.New("artifact path escapes root")
	}
	return target, nil
}

func VerifyArtifactChecksum(path, expected string) error {
	expected = strings.ToLower(strings.TrimSpace(expected))
	if len(expected) != 64 {
		return errors.New("invalid sha256")
	}
	got, err := ComputeFileSHA256(path)
	if err != nil || got != expected {
		return fmt.Errorf("checksum mismatch")
	}
	return nil
}

func OpenArtifactFile(root, rel string) (*os.File, os.FileInfo, error) {
	p, err := joinArtifactRoot(root, rel)
	if err != nil {
		return nil, nil, err
	}
	info, err := os.Lstat(p)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || info.IsDir() {
		return nil, nil, errors.New("artifact unavailable")
	}
	f, err := os.Open(p)
	return f, info, err
}
