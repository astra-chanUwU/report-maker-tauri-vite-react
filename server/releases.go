package controlplane

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed releases.json
var embeddedReleases []byte

type ReleaseArtifact struct {
	ID           string `json:"id"`
	Version      string `json:"version"`
	Filename     string `json:"filename"`
	SHA256       string `json:"sha256"`
	RelativePath string `json:"relative_path"`
	Platform     string `json:"platform"`
	Description  string `json:"description"`
}

type ReleaseCatalog struct {
	Root      string
	Artifacts []ReleaseArtifact
	byID      map[string]ReleaseArtifact
}

func LoadReleaseCatalog(root, manifestPath string) (*ReleaseCatalog, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		root = "artifacts"
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	raw := embeddedReleases
	if manifestPath != "" {
		raw, err = os.ReadFile(manifestPath)
		if err != nil {
			return nil, fmt.Errorf("read release manifest: %w", err)
		}
	}
	var artifacts []ReleaseArtifact
	if err := json.Unmarshal(raw, &artifacts); err != nil {
		return nil, fmt.Errorf("parse release manifest: %w", err)
	}
	catalog := &ReleaseCatalog{Root: absRoot, Artifacts: artifacts, byID: map[string]ReleaseArtifact{}}
	for _, artifact := range artifacts {
		if err := validateReleaseArtifact(artifact); err != nil {
			return nil, err
		}
		if _, exists := catalog.byID[artifact.ID]; exists {
			return nil, fmt.Errorf("duplicate release artifact id %q", artifact.ID)
		}
		catalog.byID[artifact.ID] = artifact
	}
	return catalog, nil
}

func validateReleaseArtifact(artifact ReleaseArtifact) error {
	switch {
	case strings.TrimSpace(artifact.ID) == "":
		return errors.New("release artifact id is required")
	case strings.TrimSpace(artifact.Version) == "":
		return errors.New("release artifact version is required")
	case strings.TrimSpace(artifact.Filename) == "":
		return errors.New("release artifact filename is required")
	case strings.TrimSpace(artifact.RelativePath) == "":
		return errors.New("release artifact relative_path is required")
	case strings.Contains(artifact.RelativePath, ".."):
		return fmt.Errorf("release artifact %q has invalid relative_path", artifact.ID)
	}
	return nil
}

func (c *ReleaseCatalog) Find(id string) (ReleaseArtifact, bool) {
	artifact, ok := c.byID[id]
	return artifact, ok
}

func (c *ReleaseCatalog) ResolveArtifactPath(relativePath string) (string, error) {
	if c == nil {
		return "", errors.New("release catalog unavailable")
	}
	cleanRelative := filepath.Clean(strings.ReplaceAll(relativePath, "\\", "/"))
	if cleanRelative == "." || strings.HasPrefix(cleanRelative, "..") || filepath.IsAbs(cleanRelative) {
		return "", errors.New("invalid artifact path")
	}
	root := filepath.Clean(c.Root)
	target := filepath.Clean(filepath.Join(root, cleanRelative))
	rootPrefix := root + string(os.PathSeparator)
	if target != root && !strings.HasPrefix(target, rootPrefix) {
		return "", errors.New("artifact path escapes root")
	}
	return target, nil
}
