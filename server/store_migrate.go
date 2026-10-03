package controlplane

import (
	"database/sql"
	"fmt"
	"strings"
)

const currentSchemaVersion = 3

func migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return err
	}
	version, err := readSchemaVersion(db)
	if err != nil {
		return err
	}
	steps := []func(*sql.DB) error{
		migrationV1Baseline,
		migrationV2CustomerIdentity,
		migrationV3LicenseDelivery,
	}
	for version < currentSchemaVersion {
		if err := steps[version](db); err != nil {
			return fmt.Errorf("schema migration %d: %w", version+1, err)
		}
		version++
		if err := setSchemaVersion(db, version); err != nil {
			return err
		}
	}
	return nil
}

func readSchemaVersion(db *sql.DB) (int, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_version`).Scan(&count); err != nil {
		return 0, err
	}
	if count == 0 {
		return 0, nil
	}
	var version int
	if err := db.QueryRow(`SELECT version FROM schema_version LIMIT 1`).Scan(&version); err != nil {
		return 0, err
	}
	return version, nil
}

func setSchemaVersion(db *sql.DB, version int) error {
	if _, err := db.Exec(`DELETE FROM schema_version`); err != nil {
		return err
	}
	_, err := db.Exec(`INSERT INTO schema_version(version) VALUES(?)`, version)
	return err
}

func execAlterColumn(db *sql.DB, statement string) error {
	if _, err := db.Exec(statement); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return nil
		}
		return err
	}
	return nil
}

// migrationV1Baseline creates S01 tables without S02 license-delivery columns or
// indexes that reference them. Upgrades add those in migrationV3.
func migrationV1Baseline(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS customers (
 id TEXT PRIMARY KEY, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', webauthn_id TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_email_idx ON customers(email);
CREATE UNIQUE INDEX IF NOT EXISTS customers_webauthn_id_idx ON customers(webauthn_id) WHERE webauthn_id <> '';
CREATE TABLE IF NOT EXISTS webauthn_credentials (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), credential_json BLOB NOT NULL,
 created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS webauthn_credentials_customer_idx ON webauthn_credentials(customer_id);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, session_json BLOB NOT NULL,
 expires_at TEXT NOT NULL, consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry_idx ON webauthn_challenges(expires_at);
CREATE TABLE IF NOT EXISTS magic_links (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS magic_links_expiry_idx ON magic_links(expires_at);
CREATE TABLE IF NOT EXISTS customer_sessions (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_sessions_expiry_idx ON customer_sessions(expires_at);
CREATE TABLE IF NOT EXISTS licenses (
 id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, plan TEXT NOT NULL, status TEXT NOT NULL,
 features_json TEXT NOT NULL, max_devices INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activations (
 id TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id), device_public_key TEXT NOT NULL,
 platform TEXT NOT NULL, app_version TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS activations_license_idx ON activations(license_id);
CREATE UNIQUE INDEX IF NOT EXISTS activations_live_device_idx ON activations(license_id, device_public_key) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), plan TEXT NOT NULL,
 first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL,
 phone TEXT NOT NULL DEFAULT '', amount_rials INTEGER NOT NULL, authority TEXT UNIQUE,
 payment_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created_at TEXT NOT NULL, paid_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_authority_idx ON orders(authority);
CREATE TABLE IF NOT EXISTS payment_attempts (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), provider TEXT NOT NULL,
 authority TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', amount_rials INTEGER NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL, verified_at TEXT
);
CREATE INDEX IF NOT EXISTS payment_attempts_order_idx ON payment_attempts(order_id);
CREATE TABLE IF NOT EXISTS download_records (
 id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id), license_id TEXT REFERENCES licenses(id),
 artifact TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
 scope TEXT NOT NULL, key TEXT NOT NULL, response BLOB NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(scope, key)
);
CREATE TABLE IF NOT EXISTS phone_challenges (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), code_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS phone_challenges_customer_idx ON phone_challenges(customer_id);
CREATE TABLE IF NOT EXISTS admin_sessions (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);`)
	return err
}

func migrationV2CustomerIdentity(db *sql.DB) error {
	for _, statement := range []string{
		`ALTER TABLE customers ADD COLUMN webauthn_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE customers ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE customers ADD COLUMN phone_verified_at TEXT`,
	} {
		if err := execAlterColumn(db, statement); err != nil {
			return err
		}
	}
	return nil
}

func migrationV3LicenseDelivery(db *sql.DB) error {
	for _, statement := range []string{
		`ALTER TABLE orders ADD COLUMN license_id TEXT REFERENCES licenses(id)`,
		`ALTER TABLE licenses ADD COLUMN customer_id TEXT REFERENCES customers(id)`,
		`ALTER TABLE licenses ADD COLUMN order_id TEXT REFERENCES orders(id)`,
		`ALTER TABLE licenses ADD COLUMN delivery_ciphertext TEXT NOT NULL DEFAULT ''`,
	} {
		if err := execAlterColumn(db, statement); err != nil {
			return err
		}
	}
	for _, statement := range []string{
		`CREATE INDEX IF NOT EXISTS licenses_order_idx ON licenses(order_id)`,
		`CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}
