package controlplane

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestSchemaMigrationFreshInstall(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fresh.db")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore fresh: %v", err)
	}
	defer store.Close()

	version, err := readSchemaVersion(store.db)
	if err != nil || version != currentSchemaVersion {
		t.Fatalf("schema version = %d err=%v want %d", version, err, currentSchemaVersion)
	}
	if err := assertLicenseDeliveryColumns(store.db); err != nil {
		t.Fatal(err)
	}
}

func TestSchemaMigrationPreS02Upgrade(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	if err := seedPreS02Database(path); err != nil {
		t.Fatalf("seed legacy db: %v", err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore legacy upgrade: %v", err)
	}
	defer store.Close()

	if _, ok := store.GetCustomer("cus_legacy"); !ok {
		t.Fatal("customer row lost during upgrade")
	}
	order, ok := store.GetOrder("ord_legacy_1")
	if !ok || order.Email != "legacy@example.com" || order.Status != "paid" {
		t.Fatalf("order row missing or changed: ok=%v order=%+v", ok, order)
	}
	if _, ok := store.FindLicenseByID("lic_legacy_1"); !ok {
		t.Fatal("license row lost during upgrade")
	}
	if err := assertLicenseDeliveryColumns(store.db); err != nil {
		t.Fatal(err)
	}
}

func TestSchemaMigrationRepeatedStartup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "repeat.db")
	if err := seedPreS02Database(path); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		store, err := OpenStore(path)
		if err != nil {
			t.Fatalf("OpenStore pass %d: %v", i+1, err)
		}
		if _, ok := store.GetCustomer("cus_legacy"); !ok {
			t.Fatalf("pass %d: customer row lost", i+1)
		}
		store.Close()
	}
}

func TestSchemaMigrationNoSuchColumnOrderIDRegression(t *testing.T) {
	path := filepath.Join(t.TempDir(), "regression.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys=ON;`); err != nil {
		t.Fatal(err)
	}
	if err := migrationV1Baseline(db); err != nil {
		t.Fatal(err)
	}
	if err := migrationV2CustomerIdentity(db); err != nil {
		t.Fatal(err)
	}
	now := formatTime(time.Now().UTC())
	if _, err := db.Exec(`INSERT INTO customers(id,first_name,last_name,email,phone,webauthn_id,password_hash,created_at,updated_at) VALUES('cus_reg','Legacy','User','reg@example.com','09120000001','','',?,?)`, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO licenses(id,key_hash,plan,status,features_json,max_devices,created_at) VALUES('lic_reg','abc','perpetual','active','{}',3,?)`, now); err != nil {
		t.Fatal(err)
	}
	db.Close()

	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("upgrade must not fail with missing order_id column: %v", err)
	}
	store.Close()
}

func TestSchemaMigrationPreservesSessionRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.db")
	if err := seedPreS02Database(path); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	session, ok := store.FindCustomerSession("hash_legacy")
	if !ok || session.CustomerID != "cus_legacy" {
		t.Fatalf("session lost after migration: ok=%v session=%+v", ok, session)
	}
}

func seedPreS02Database(path string) error {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err := db.Exec(`PRAGMA foreign_keys=ON;`); err != nil {
		return err
	}
	if err := migrationV1Baseline(db); err != nil {
		return err
	}
	if err := migrationV2CustomerIdentity(db); err != nil {
		return err
	}
	now := formatTime(time.Now().UTC())
	if _, err := db.Exec(`INSERT INTO customers(id,first_name,last_name,email,phone,webauthn_id,password_hash,created_at,updated_at) VALUES('cus_legacy','Ada','Lovelace','legacy@example.com','09120000000','','',?,?)`, now, now); err != nil {
		return err
	}
	if _, err := db.Exec(`INSERT INTO licenses(id,key_hash,plan,status,features_json,max_devices,created_at) VALUES('lic_legacy_1','deadbeef','perpetual','active','{"core_export":true}',3,?)`, now); err != nil {
		return err
	}
	if _, err := db.Exec(`INSERT INTO orders(id,customer_id,plan,first_name,last_name,email,phone,amount_rials,authority,payment_ref,status,created_at,paid_at) VALUES('ord_legacy_1','cus_legacy','perpetual','Ada','Lovelace','legacy@example.com','09120000000',1000000,'auth_legacy','ref_legacy','paid',?,?)`, now, now); err != nil {
		return err
	}
	if _, err := db.Exec(`INSERT INTO customer_sessions(id,customer_id,token_hash,expires_at,created_at,last_seen_at) VALUES('sess_legacy','cus_legacy','hash_legacy',?, ?, ?)`, formatTime(time.Now().UTC().Add(24*time.Hour)), now, now); err != nil {
		return err
	}
	return nil
}

func assertLicenseDeliveryColumns(db *sql.DB) error {
	for _, query := range []string{
		`SELECT license_id FROM orders LIMIT 1`,
		`SELECT order_id, delivery_ciphertext FROM licenses LIMIT 1`,
	} {
		if _, err := db.Exec(query); err != nil {
			return err
		}
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS licenses_order_idx ON licenses(order_id)`); err != nil {
		return err
	}
	return nil
}
