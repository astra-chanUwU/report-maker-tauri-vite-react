package controlplane

import (
	"path/filepath"
	"testing"
)

func TestSQLiteLicensePersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report-maker.db")
	first, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.SeedLicense("RM-PERSIST-1234-KEY0", "perpetual", map[string]bool{"core_export": true}, 3); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	license, ok := second.FindLicense("RM-PERSIST-1234-KEY0")
	if !ok || license.Plan != "perpetual" || !license.Features["core_export"] {
		t.Fatalf("license did not persist: %#v, found=%v", license, ok)
	}
}
