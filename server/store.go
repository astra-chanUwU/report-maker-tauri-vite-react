package controlplane

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type License struct {
	ID                 string
	KeyHash            string
	Plan               string
	Status             string
	Features           map[string]bool
	MaxDevices         int
	CustomerID         string
	OrderID            string
	DeliveryCiphertext string
	CreatedAt          time.Time
}

type Activation struct {
	ID              string
	LicenseID       string
	DevicePublicKey string
	Platform        string
	AppVersion      string
	CreatedAt       time.Time
	LastSeen        time.Time
	RevokedAt       *time.Time
}

type Customer struct {
	ID              string
	FirstName       string
	LastName        string
	Email           string
	Phone           string
	PhoneVerifiedAt *time.Time
	WebAuthnID      string
	PasswordHash    string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type PhoneChallenge struct {
	ID         string
	CustomerID string
	CodeHash   string
	ExpiresAt  time.Time
	ConsumedAt *time.Time
	CreatedAt  time.Time
}

type AdminSession struct {
	ID         string
	TokenHash  string
	ExpiresAt  time.Time
	CreatedAt  time.Time
	LastSeenAt time.Time
}

type WebAuthnChallenge struct {
	ID          string
	CustomerID  string
	Kind        string
	SessionJSON []byte
	ExpiresAt   time.Time
	ConsumedAt  *time.Time
}

type WebAuthnCredential struct {
	ID             string
	CustomerID     string
	CredentialJSON []byte
	CreatedAt      time.Time
	LastUsedAt     *time.Time
}

type MagicLink struct {
	ID         string
	CustomerID string
	TokenHash  string
	ExpiresAt  time.Time
	ConsumedAt *time.Time
	CreatedAt  time.Time
}

type CustomerSession struct {
	ID         string
	CustomerID string
	TokenHash  string
	ExpiresAt  time.Time
	CreatedAt  time.Time
	LastSeenAt time.Time
}

type Order struct {
	ID          string
	CustomerID  string
	LicenseID   string
	Plan        string
	FirstName   string
	LastName    string
	Email       string
	Phone       string
	AmountRials int64
	Authority   string
	PaymentRef  string
	Status      string
	CreatedAt   time.Time
	PaidAt      *time.Time
}

type FulfillResult struct {
	Order      *Order
	License    *License
	LicenseKey string
	Created    bool
}

type PaymentAttempt struct {
	ID          string
	OrderID     string
	Provider    string
	Authority   string
	Reference   string
	AmountRials int64
	Status      string
	CreatedAt   time.Time
	VerifiedAt  *time.Time
}

type DownloadRecord struct {
	ID        string
	OrderID   string
	LicenseID string
	Artifact  string
	CreatedAt time.Time
}

// DownloadEntitlement is the paid-order + license boundary S02 sets after verify.
type DownloadEntitlement struct {
	OrderID   string
	LicenseID string
}

type Store struct{ db *sql.DB }

// OpenStore opens a persistent SQLite store. Use :memory: for isolated tests.
func OpenStore(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		path = ":memory:"
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// NewStore preserves the small in-memory constructor used by tests and local callers.
func NewStore() *Store {
	store, err := OpenStore(":memory:")
	if err != nil {
		panic(err)
	}
	return store
}
func (s *Store) Close() error { return s.db.Close() }

func migrate(db *sql.DB) error {
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
 features_json TEXT NOT NULL, max_devices INTEGER NOT NULL, customer_id TEXT REFERENCES customers(id),
 order_id TEXT REFERENCES orders(id), delivery_ciphertext TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS licenses_order_idx ON licenses(order_id);
CREATE TABLE IF NOT EXISTS activations (
 id TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id), device_public_key TEXT NOT NULL,
 platform TEXT NOT NULL, app_version TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS activations_license_idx ON activations(license_id);
CREATE UNIQUE INDEX IF NOT EXISTS activations_live_device_idx ON activations(license_id, device_public_key) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), license_id TEXT REFERENCES licenses(id),
 plan TEXT NOT NULL, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL,
 phone TEXT NOT NULL DEFAULT '', amount_rials INTEGER NOT NULL, authority TEXT UNIQUE,
 payment_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created_at TEXT NOT NULL, paid_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_authority_idx ON orders(authority);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id);
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
	if err != nil {
		return err
	}
	// Existing installations created before customer identity was introduced
	// need the new nullable-at-rest fields. SQLite has no IF NOT EXISTS form for
	// ALTER TABLE, so tolerate the duplicate-column error on subsequent starts.
	for _, statement := range []string{
		`ALTER TABLE customers ADD COLUMN webauthn_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE customers ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE customers ADD COLUMN phone_verified_at TEXT`,
		`ALTER TABLE orders ADD COLUMN license_id TEXT REFERENCES licenses(id)`,
		`ALTER TABLE licenses ADD COLUMN customer_id TEXT REFERENCES customers(id)`,
		`ALTER TABLE licenses ADD COLUMN order_id TEXT REFERENCES orders(id)`,
		`ALTER TABLE licenses ADD COLUMN delivery_ciphertext TEXT NOT NULL DEFAULT ''`,
	} {
		if _, alterErr := db.Exec(statement); alterErr != nil && !strings.Contains(strings.ToLower(alterErr.Error()), "duplicate column") {
			return alterErr
		}
	}
	return nil
}

func LicenseKeyHash(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func (s *Store) SeedLicense(key, plan string, features map[string]bool, maxDevices int) error {
	encoded, err := json.Marshal(features)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO licenses(id,key_hash,plan,status,features_json,max_devices,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET status=excluded.status`, "lic_dev_1", LicenseKeyHash(key), plan, "active", string(encoded), maxDevices, formatTime(time.Now().UTC()))
	return err
}
func (s *Store) FindLicense(key string) (*License, bool) {
	return s.FindLicenseByHash(LicenseKeyHash(key))
}
func (s *Store) FindLicenseByHash(hash string) (*License, bool) {
	row := s.db.QueryRow(`SELECT id,key_hash,plan,status,features_json,max_devices,COALESCE(customer_id,''),COALESCE(order_id,''),COALESCE(delivery_ciphertext,''),created_at FROM licenses WHERE key_hash=?`, hash)
	return scanLicense(row)
}
func (s *Store) FindLicenseByID(id string) (*License, bool) {
	row := s.db.QueryRow(`SELECT id,key_hash,plan,status,features_json,max_devices,COALESCE(customer_id,''),COALESCE(order_id,''),COALESCE(delivery_ciphertext,''),created_at FROM licenses WHERE id=?`, id)
	return scanLicense(row)
}
func scanLicense(row interface{ Scan(...any) error }) (*License, bool) {
	var value License
	var encoded, created string
	if err := row.Scan(&value.ID, &value.KeyHash, &value.Plan, &value.Status, &encoded, &value.MaxDevices, &value.CustomerID, &value.OrderID, &value.DeliveryCiphertext, &created); err != nil {
		return nil, false
	}
	if json.Unmarshal([]byte(encoded), &value.Features) != nil {
		return nil, false
	}
	value.CreatedAt, _ = parseTime(created)
	return &value, true
}
func (s *Store) GetActivation(id string) (*Activation, bool) {
	row := s.db.QueryRow(`SELECT id,license_id,device_public_key,platform,app_version,created_at,last_seen,revoked_at FROM activations WHERE id=?`, id)
	return scanActivation(row)
}
func (s *Store) FindActivationByDevice(licenseID, device string) (*Activation, bool) {
	row := s.db.QueryRow(`SELECT id,license_id,device_public_key,platform,app_version,created_at,last_seen,revoked_at FROM activations WHERE license_id=? AND device_public_key=? AND revoked_at IS NULL`, licenseID, device)
	return scanActivation(row)
}
func scanActivation(row interface{ Scan(...any) error }) (*Activation, bool) {
	var value Activation
	var created, last, revoked sql.NullString
	if err := row.Scan(&value.ID, &value.LicenseID, &value.DevicePublicKey, &value.Platform, &value.AppVersion, &created, &last, &revoked); err != nil {
		return nil, false
	}
	value.CreatedAt, _ = parseTime(created.String)
	value.LastSeen, _ = parseTime(last.String)
	if revoked.Valid {
		parsed, _ := parseTime(revoked.String)
		value.RevokedAt = &parsed
	}
	return &value, true
}
func (s *Store) ActiveDeviceCount(licenseID string) int {
	var count int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM activations WHERE license_id=? AND revoked_at IS NULL`, licenseID).Scan(&count)
	return count
}
func (s *Store) PutActivation(value *Activation) error {
	_, err := s.db.Exec(`INSERT INTO activations(id,license_id,device_public_key,platform,app_version,created_at,last_seen,revoked_at) VALUES(?,?,?,?,?,?,?,?)`, value.ID, value.LicenseID, value.DevicePublicKey, value.Platform, value.AppVersion, formatTime(value.CreatedAt), formatTime(value.LastSeen), nullableTime(value.RevokedAt))
	return err
}
func (s *Store) TouchActivation(id string) error {
	_, err := s.db.Exec(`UPDATE activations SET last_seen=? WHERE id=?`, formatTime(time.Now().UTC()), id)
	return err
}
func (s *Store) RevokeActivation(id string) bool {
	now := formatTime(time.Now().UTC())
	_, err := s.db.Exec(`UPDATE activations SET revoked_at=?,last_seen=? WHERE id=? AND revoked_at IS NULL`, now, now, id)
	return err == nil
}
func normalizeEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

// CheckoutIdentityConflict records checkout contact that differed from a verified account.
type CheckoutIdentityConflict struct {
	Field string
}

func (s *Store) PutCustomer(value *Customer) error {
	value.Email = normalizeEmail(value.Email)
	_, err := s.db.Exec(`INSERT INTO customers(id,first_name,last_name,email,phone,phone_verified_at,webauthn_id,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,email=excluded.email,phone=excluded.phone,phone_verified_at=COALESCE(excluded.phone_verified_at,customers.phone_verified_at),webauthn_id=CASE WHEN excluded.webauthn_id <> '' THEN excluded.webauthn_id ELSE customers.webauthn_id END,password_hash=CASE WHEN excluded.password_hash <> '' THEN excluded.password_hash ELSE customers.password_hash END,updated_at=excluded.updated_at`, value.ID, value.FirstName, value.LastName, value.Email, value.Phone, nullableTime(value.PhoneVerifiedAt), value.WebAuthnID, value.PasswordHash, formatTime(value.CreatedAt), formatTime(value.UpdatedAt))
	return err
}

// EnsureCheckoutCustomer finds or creates the durable account for checkout email.
func (s *Store) EnsureCheckoutCustomer(firstName, lastName, email, phone string) (*Customer, []CheckoutIdentityConflict, error) {
	email = normalizeEmail(email)
	now := time.Now().UTC()
	if existing, ok := s.FindCustomerByEmail(email); ok {
		updated, conflicts := mergeCheckoutIntoCustomer(existing, firstName, lastName, phone, now)
		return updated, conflicts, s.PutCustomer(updated)
	}
	customer := &Customer{
		ID: randomID("cus_"), FirstName: firstName, LastName: lastName, Email: email, Phone: phone,
		CreatedAt: now, UpdatedAt: now,
	}
	return customer, nil, s.PutCustomer(customer)
}

func mergeCheckoutIntoCustomer(existing *Customer, firstName, lastName, phone string, now time.Time) (*Customer, []CheckoutIdentityConflict) {
	updated := *existing
	updated.UpdatedAt = now
	updated.Email = normalizeEmail(existing.Email)
	var conflicts []CheckoutIdentityConflict
	if existing.PhoneVerifiedAt != nil {
		if phone != "" && phone != existing.Phone {
			conflicts = append(conflicts, CheckoutIdentityConflict{Field: "phone"})
		}
		if lastName != "" && lastName != existing.LastName {
			conflicts = append(conflicts, CheckoutIdentityConflict{Field: "last_name"})
		}
		if strings.TrimSpace(updated.FirstName) == "" && firstName != "" {
			updated.FirstName = firstName
		}
		return &updated, conflicts
	}
	if firstName != "" {
		updated.FirstName = firstName
	}
	if lastName != "" {
		updated.LastName = lastName
	}
	if phone != "" {
		updated.Phone = phone
	}
	return &updated, conflicts
}

func (s *Store) CountCustomers() int {
	var count int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM customers`).Scan(&count)
	return count
}

func (s *Store) GetCustomer(id string) (*Customer, bool) {
	row := s.db.QueryRow(`SELECT id,first_name,last_name,email,phone,phone_verified_at,webauthn_id,password_hash,created_at,updated_at FROM customers WHERE id=?`, id)
	return scanCustomer(row)
}

func (s *Store) FindCustomerByEmail(email string) (*Customer, bool) {
	email = normalizeEmail(email)
	if email == "" {
		return nil, false
	}
	row := s.db.QueryRow(`SELECT id,first_name,last_name,email,phone,phone_verified_at,webauthn_id,password_hash,created_at,updated_at FROM customers WHERE lower(email)=lower(?) ORDER BY created_at LIMIT 1`, email)
	return scanCustomer(row)
}

func scanCustomer(row interface{ Scan(...any) error }) (*Customer, bool) {
	var value Customer
	var created, updated string
	var phoneVerified sql.NullString
	if err := row.Scan(&value.ID, &value.FirstName, &value.LastName, &value.Email, &value.Phone, &phoneVerified, &value.WebAuthnID, &value.PasswordHash, &created, &updated); err != nil {
		return nil, false
	}
	value.CreatedAt, _ = parseTime(created)
	value.UpdatedAt, _ = parseTime(updated)
	if phoneVerified.Valid {
		parsed, _ := parseTime(phoneVerified.String)
		value.PhoneVerifiedAt = &parsed
	}
	return &value, true
}

func (s *Store) PutWebAuthnCredential(value *WebAuthnCredential) error {
	_, err := s.db.Exec(`INSERT INTO webauthn_credentials(id,customer_id,credential_json,created_at,last_used_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET credential_json=excluded.credential_json,last_used_at=excluded.last_used_at`, value.ID, value.CustomerID, value.CredentialJSON, formatTime(value.CreatedAt), nullableTime(value.LastUsedAt))
	return err
}

func (s *Store) ListWebAuthnCredentials(customerID string) ([]WebAuthnCredential, error) {
	rows, err := s.db.Query(`SELECT id,customer_id,credential_json,created_at,last_used_at FROM webauthn_credentials WHERE customer_id=? ORDER BY created_at`, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var values []WebAuthnCredential
	for rows.Next() {
		var value WebAuthnCredential
		var created, last sql.NullString
		if err := rows.Scan(&value.ID, &value.CustomerID, &value.CredentialJSON, &created, &last); err != nil {
			return nil, err
		}
		value.CreatedAt, _ = parseTime(created.String)
		if last.Valid {
			parsed, _ := parseTime(last.String)
			value.LastUsedAt = &parsed
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) FindCustomerByWebAuthnID(id string) (*Customer, bool) {
	row := s.db.QueryRow(`SELECT id,first_name,last_name,email,phone,phone_verified_at,webauthn_id,password_hash,created_at,updated_at FROM customers WHERE webauthn_id=?`, id)
	return scanCustomer(row)
}

func (s *Store) TouchWebAuthnCredential(id string, credentialJSON []byte) error {
	_, err := s.db.Exec(`UPDATE webauthn_credentials SET credential_json=?,last_used_at=? WHERE id=?`, credentialJSON, formatTime(time.Now().UTC()), id)
	return err
}

func (s *Store) PutWebAuthnChallenge(value *WebAuthnChallenge) error {
	_, err := s.db.Exec(`INSERT INTO webauthn_challenges(id,customer_id,kind,session_json,expires_at,consumed_at) VALUES(?,?,?,?,?,?)`, value.ID, value.CustomerID, value.Kind, value.SessionJSON, formatTime(value.ExpiresAt), nullableTime(value.ConsumedAt))
	return err
}

func (s *Store) ConsumeWebAuthnChallenge(id, kind string) (*WebAuthnChallenge, bool) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, false
	}
	defer tx.Rollback()
	var value WebAuthnChallenge
	var expires, consumed sql.NullString
	if err := tx.QueryRow(`SELECT id,customer_id,kind,session_json,expires_at,consumed_at FROM webauthn_challenges WHERE id=? AND kind=?`, id, kind).Scan(&value.ID, &value.CustomerID, &value.Kind, &value.SessionJSON, &expires, &consumed); err != nil {
		return nil, false
	}
	value.ExpiresAt, _ = parseTime(expires.String)
	if consumed.Valid {
		parsed, _ := parseTime(consumed.String)
		value.ConsumedAt = &parsed
	}
	if value.ConsumedAt != nil || !value.ExpiresAt.After(time.Now().UTC()) {
		return nil, false
	}
	now := time.Now().UTC()
	if _, err := tx.Exec(`UPDATE webauthn_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL`, formatTime(now), id); err != nil {
		return nil, false
	}
	if err := tx.Commit(); err != nil {
		return nil, false
	}
	value.ConsumedAt = &now
	return &value, true
}

func (s *Store) PutMagicLink(value *MagicLink) error {
	_, err := s.db.Exec(`INSERT INTO magic_links(id,customer_id,token_hash,expires_at,consumed_at,created_at) VALUES(?,?,?,?,?,?)`, value.ID, value.CustomerID, value.TokenHash, formatTime(value.ExpiresAt), nullableTime(value.ConsumedAt), formatTime(value.CreatedAt))
	return err
}

func (s *Store) ConsumeMagicLink(tokenHash string) (*MagicLink, bool) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, false
	}
	defer tx.Rollback()
	var value MagicLink
	var expires, consumed, created sql.NullString
	if err := tx.QueryRow(`SELECT id,customer_id,token_hash,expires_at,consumed_at,created_at FROM magic_links WHERE token_hash=?`, tokenHash).Scan(&value.ID, &value.CustomerID, &value.TokenHash, &expires, &consumed, &created); err != nil {
		return nil, false
	}
	value.ExpiresAt, _ = parseTime(expires.String)
	value.CreatedAt, _ = parseTime(created.String)
	if consumed.Valid {
		parsed, _ := parseTime(consumed.String)
		value.ConsumedAt = &parsed
	}
	if value.ConsumedAt != nil || !value.ExpiresAt.After(time.Now().UTC()) {
		return nil, false
	}
	now := time.Now().UTC()
	if _, err := tx.Exec(`UPDATE magic_links SET consumed_at=? WHERE id=? AND consumed_at IS NULL`, formatTime(now), value.ID); err != nil {
		return nil, false
	}
	if err := tx.Commit(); err != nil {
		return nil, false
	}
	value.ConsumedAt = &now
	return &value, true
}

func (s *Store) PutCustomerSession(value *CustomerSession) error {
	_, err := s.db.Exec(`INSERT INTO customer_sessions(id,customer_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)`, value.ID, value.CustomerID, value.TokenHash, formatTime(value.ExpiresAt), formatTime(value.CreatedAt), formatTime(value.LastSeenAt))
	return err
}

func (s *Store) FindCustomerSession(tokenHash string) (*CustomerSession, bool) {
	var value CustomerSession
	var expires, created, last string
	if err := s.db.QueryRow(`SELECT id,customer_id,token_hash,expires_at,created_at,last_seen_at FROM customer_sessions WHERE token_hash=?`, tokenHash).Scan(&value.ID, &value.CustomerID, &value.TokenHash, &expires, &created, &last); err != nil {
		return nil, false
	}
	value.ExpiresAt, _ = parseTime(expires)
	value.CreatedAt, _ = parseTime(created)
	value.LastSeenAt, _ = parseTime(last)
	if !value.ExpiresAt.After(time.Now().UTC()) {
		return nil, false
	}
	return &value, true
}

func (s *Store) TouchCustomerSession(id string) error {
	_, err := s.db.Exec(`UPDATE customer_sessions SET last_seen_at=? WHERE id=?`, formatTime(time.Now().UTC()), id)
	return err
}

func (s *Store) DeleteCustomerSessions(customerID string) error {
	_, err := s.db.Exec(`DELETE FROM customer_sessions WHERE customer_id=?`, customerID)
	return err
}

func (s *Store) DeleteCustomerSession(tokenHash string) error {
	_, err := s.db.Exec(`DELETE FROM customer_sessions WHERE token_hash=?`, tokenHash)
	return err
}

func (s *Store) PutPhoneChallenge(value *PhoneChallenge) error {
	_, err := s.db.Exec(`INSERT INTO phone_challenges(id,customer_id,code_hash,expires_at,consumed_at,created_at) VALUES(?,?,?,?,?,?)`, value.ID, value.CustomerID, value.CodeHash, formatTime(value.ExpiresAt), nullableTime(value.ConsumedAt), formatTime(value.CreatedAt))
	return err
}

func (s *Store) ConsumePhoneChallenge(customerID, codeHash string) (*PhoneChallenge, bool) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, false
	}
	defer tx.Rollback()
	var value PhoneChallenge
	var expires, consumed, created sql.NullString
	if err := tx.QueryRow(`SELECT id,customer_id,code_hash,expires_at,consumed_at,created_at FROM phone_challenges WHERE customer_id=? AND code_hash=? ORDER BY created_at DESC LIMIT 1`, customerID, codeHash).Scan(&value.ID, &value.CustomerID, &value.CodeHash, &expires, &consumed, &created); err != nil {
		return nil, false
	}
	value.ExpiresAt, _ = parseTime(expires.String)
	value.CreatedAt, _ = parseTime(created.String)
	if consumed.Valid {
		parsed, _ := parseTime(consumed.String)
		value.ConsumedAt = &parsed
	}
	if value.ConsumedAt != nil || !value.ExpiresAt.After(time.Now().UTC()) {
		return nil, false
	}
	now := time.Now().UTC()
	if _, err := tx.Exec(`UPDATE phone_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL`, formatTime(now), value.ID); err != nil {
		return nil, false
	}
	if err := tx.Commit(); err != nil {
		return nil, false
	}
	value.ConsumedAt = &now
	return &value, true
}

func (s *Store) PutAdminSession(value *AdminSession) error {
	_, err := s.db.Exec(`INSERT INTO admin_sessions(id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)`, value.ID, value.TokenHash, formatTime(value.ExpiresAt), formatTime(value.CreatedAt), formatTime(value.LastSeenAt))
	return err
}

func (s *Store) FindAdminSession(tokenHash string) (*AdminSession, bool) {
	var value AdminSession
	var expires, created, last string
	if err := s.db.QueryRow(`SELECT id,token_hash,expires_at,created_at,last_seen_at FROM admin_sessions WHERE token_hash=?`, tokenHash).Scan(&value.ID, &value.TokenHash, &expires, &created, &last); err != nil {
		return nil, false
	}
	value.ExpiresAt, _ = parseTime(expires)
	value.CreatedAt, _ = parseTime(created)
	value.LastSeenAt, _ = parseTime(last)
	if !value.ExpiresAt.After(time.Now().UTC()) {
		return nil, false
	}
	return &value, true
}

func (s *Store) TouchAdminSession(id string) error {
	_, err := s.db.Exec(`UPDATE admin_sessions SET last_seen_at=? WHERE id=?`, formatTime(time.Now().UTC()), id)
	return err
}

func (s *Store) DeleteAdminSession(tokenHash string) error {
	_, err := s.db.Exec(`DELETE FROM admin_sessions WHERE token_hash=?`, tokenHash)
	return err
}
func (s *Store) PutOrder(value *Order) error {
	_, err := s.db.Exec(`INSERT INTO orders(id,customer_id,license_id,plan,first_name,last_name,email,phone,amount_rials,authority,payment_ref,status,created_at,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, value.ID, nullableString(value.CustomerID), nullableString(value.LicenseID), value.Plan, value.FirstName, value.LastName, value.Email, value.Phone, value.AmountRials, nullableString(value.Authority), value.PaymentRef, value.Status, formatTime(value.CreatedAt), nullableTime(value.PaidAt))
	return err
}
func (s *Store) GetOrder(id string) (*Order, bool) {
	row := s.db.QueryRow(`SELECT id,COALESCE(customer_id,''),COALESCE(license_id,''),plan,first_name,last_name,email,phone,amount_rials,COALESCE(authority,''),payment_ref,status,created_at,paid_at FROM orders WHERE id=?`, id)
	return scanOrder(row)
}
func (s *Store) FindOrderByAuthority(authority string) (*Order, bool) {
	row := s.db.QueryRow(`SELECT id,COALESCE(customer_id,''),COALESCE(license_id,''),plan,first_name,last_name,email,phone,amount_rials,COALESCE(authority,''),payment_ref,status,created_at,paid_at FROM orders WHERE authority=?`, authority)
	return scanOrder(row)
}
func (s *Store) ListCustomerOrders(customerID string) ([]Order, error) {
	rows, err := s.db.Query(`SELECT id,COALESCE(customer_id,''),COALESCE(license_id,''),plan,first_name,last_name,email,phone,amount_rials,COALESCE(authority,''),payment_ref,status,created_at,paid_at FROM orders WHERE customer_id=? ORDER BY created_at DESC`, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var values []Order
	for rows.Next() {
		order, ok := scanOrder(rows)
		if !ok {
			continue
		}
		values = append(values, *order)
	}
	return values, rows.Err()
}
func scanOrder(row interface{ Scan(...any) error }) (*Order, bool) {
	var value Order
	var created, paid sql.NullString
	if err := row.Scan(&value.ID, &value.CustomerID, &value.LicenseID, &value.Plan, &value.FirstName, &value.LastName, &value.Email, &value.Phone, &value.AmountRials, &value.Authority, &value.PaymentRef, &value.Status, &created, &paid); err != nil {
		return nil, false
	}
	value.CreatedAt, _ = parseTime(created.String)
	if paid.Valid {
		parsed, _ := parseTime(paid.String)
		value.PaidAt = &parsed
	}
	return &value, true
}
func (s *Store) MarkOrderPaid(id, paymentRef string) (*Order, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row := tx.QueryRow(`SELECT id,COALESCE(customer_id,''),COALESCE(license_id,''),plan,first_name,last_name,email,phone,amount_rials,COALESCE(authority,''),payment_ref,status,created_at,paid_at FROM orders WHERE id=?`, id)
	order, ok := scanOrder(row)
	if !ok {
		return nil, errors.New("order not found")
	}
	if order.Status == "paid" {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return order, nil
	}
	if order.Status != "pending" {
		return nil, errors.New("order is not payable")
	}
	now := time.Now().UTC()
	if _, err := tx.Exec(`UPDATE orders SET status='paid',payment_ref=?,paid_at=? WHERE id=? AND status='pending'`, paymentRef, formatTime(now), id); err != nil {
		return nil, err
	}
	order.Status, order.PaymentRef, order.PaidAt = "paid", paymentRef, &now
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return order, nil
}

func (s *Store) FulfillOrderPayment(orderID, paymentRef string, deliveryKey []byte, plan ProductPlan) (*FulfillResult, error) {
	if len(deliveryKey) != 32 {
		return nil, errors.New("delivery key required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row := tx.QueryRow(`SELECT id,COALESCE(customer_id,''),COALESCE(license_id,''),plan,first_name,last_name,email,phone,amount_rials,COALESCE(authority,''),payment_ref,status,created_at,paid_at FROM orders WHERE id=?`, orderID)
	order, ok := scanOrder(row)
	if !ok {
		return nil, errors.New("order not found")
	}
	if order.Status == "paid" {
		if order.LicenseID != "" {
			return s.fulfillExistingPaidOrder(tx, order, deliveryKey)
		}
	} else if order.Status != "pending" {
		return nil, errors.New("order is not payable")
	} else {
		now := time.Now().UTC()
		if _, err := tx.Exec(`UPDATE orders SET status='paid',payment_ref=?,paid_at=? WHERE id=? AND status='pending'`, paymentRef, formatTime(now), orderID); err != nil {
			return nil, err
		}
		order.Status, order.PaymentRef, order.PaidAt = "paid", paymentRef, &now
	}
	catalogPlan, ok := PlanFromCatalog(order.Plan)
	if !ok {
		return nil, errors.New("unknown plan")
	}
	plan = catalogPlan
	plainKey, err := GenerateLicenseKey()
	if err != nil {
		return nil, err
	}
	for attempts := 0; attempts < 5; attempts++ {
		var exists int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM licenses WHERE key_hash=?`, LicenseKeyHash(plainKey)).Scan(&exists); err != nil {
			return nil, err
		}
		if exists == 0 {
			break
		}
		plainKey, err = GenerateLicenseKey()
		if err != nil {
			return nil, err
		}
	}
	encrypted, err := EncryptLicenseKey(deliveryKey, plainKey)
	if err != nil {
		return nil, err
	}
	featuresJSON, err := json.Marshal(plan.Features)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	licenseID := randomID("lic_")
	if _, err := tx.Exec(`INSERT INTO licenses(id,key_hash,plan,status,features_json,max_devices,customer_id,order_id,delivery_ciphertext,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, licenseID, LicenseKeyHash(plainKey), plan.ID, "active", string(featuresJSON), plan.MaxDevices, nullableString(order.CustomerID), orderID, encrypted, formatTime(now)); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE orders SET license_id=? WHERE id=?`, licenseID, orderID); err != nil {
		return nil, err
	}
	order.LicenseID = licenseID
	license := &License{ID: licenseID, KeyHash: LicenseKeyHash(plainKey), Plan: plan.ID, Status: "active", Features: cloneFeatures(plan.Features), MaxDevices: plan.MaxDevices, CustomerID: order.CustomerID, OrderID: orderID, DeliveryCiphertext: encrypted, CreatedAt: now}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &FulfillResult{Order: order, License: license, LicenseKey: plainKey, Created: true}, nil
}

func (s *Store) fulfillExistingPaidOrder(tx *sql.Tx, order *Order, deliveryKey []byte) (*FulfillResult, error) {
	licenseRow := tx.QueryRow(`SELECT id,key_hash,plan,status,features_json,max_devices,COALESCE(customer_id,''),COALESCE(order_id,''),COALESCE(delivery_ciphertext,''),created_at FROM licenses WHERE id=?`, order.LicenseID)
	license, ok := scanLicense(licenseRow)
	if !ok {
		return nil, errors.New("license not found")
	}
	result := &FulfillResult{Order: order, License: license, Created: false}
	if deliveryKey != nil && license.DeliveryCiphertext != "" {
		plain, err := DecryptLicenseKey(deliveryKey, license.DeliveryCiphertext)
		if err != nil {
			return nil, err
		}
		result.LicenseKey = plain
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Store) CountProvisionedLicenses() int {
	var count int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM licenses WHERE order_id IS NOT NULL AND order_id <> ''`).Scan(&count)
	return count
}

func (s *Store) CountLicensesForOrder(orderID string) int {
	var count int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM licenses WHERE order_id=?`, orderID).Scan(&count)
	return count
}
func (s *Store) PutPaymentAttempt(value *PaymentAttempt) error {
	_, err := s.db.Exec(`INSERT INTO payment_attempts(id,order_id,provider,authority,reference,amount_rials,status,created_at,verified_at) VALUES(?,?,?,?,?,?,?,?,?)`, value.ID, value.OrderID, value.Provider, value.Authority, value.Reference, value.AmountRials, value.Status, formatTime(value.CreatedAt), nullableTime(value.VerifiedAt))
	return err
}
func (s *Store) RecordDownload(value *DownloadRecord) error {
	_, err := s.db.Exec(`INSERT INTO download_records(id,order_id,license_id,artifact,created_at) VALUES(?,?,?,?,?)`, value.ID, nullableString(value.OrderID), nullableString(value.LicenseID), value.Artifact, formatTime(value.CreatedAt))
	return err
}

// CustomerDownloadEntitlement returns the newest paid order with a license for the customer.
// S02 will set license_id during payment provisioning; until then tests may insert rows directly.
func (s *Store) CustomerDownloadEntitlement(customerID string) (DownloadEntitlement, bool) {
	row := s.db.QueryRow(`
SELECT id, COALESCE(license_id,'') FROM orders
WHERE customer_id=? AND status='paid' AND license_id IS NOT NULL AND license_id <> ''
ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 1`, customerID)
	var ent DownloadEntitlement
	if err := row.Scan(&ent.OrderID, &ent.LicenseID); err != nil || ent.LicenseID == "" {
		return DownloadEntitlement{}, false
	}
	return ent, true
}

func (s *Store) CustomerEntitledForLicense(customerID, licenseID string) (bool, error) {
	var count int
	err := s.db.QueryRow(`
SELECT COUNT(*) FROM orders
WHERE customer_id=? AND status='paid' AND license_id=?`, customerID, licenseID).Scan(&count)
	return count > 0, err
}

// FindLicensesByCustomer lists licenses linked to paid orders for a customer.
func (s *Store) FindLicensesByCustomer(customerID string) ([]License, error) {
	rows, err := s.db.Query(`
SELECT l.id,l.key_hash,l.plan,l.status,l.features_json,l.max_devices,COALESCE(l.customer_id,''),COALESCE(l.order_id,''),COALESCE(l.delivery_ciphertext,''),l.created_at
FROM licenses l
INNER JOIN orders o ON o.license_id=l.id
WHERE o.customer_id=? AND o.status='paid'
GROUP BY l.id
ORDER BY l.created_at DESC`, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var licenses []License
	for rows.Next() {
		license, ok := scanLicense(rows)
		if !ok {
			continue
		}
		licenses = append(licenses, *license)
	}
	return licenses, rows.Err()
}

// InsertPaidOrderWithLicense is a test helper until S02 owns real provisioning.
func (s *Store) InsertPaidOrderWithLicense(customerID string, license *License, orderID string) (*Order, error) {
	if license == nil {
		return nil, errors.New("license required")
	}
	encoded, err := json.Marshal(license.Features)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	order := &Order{
		ID: orderID, CustomerID: customerID, LicenseID: license.ID, Plan: license.Plan,
		Status: "paid", CreatedAt: now, PaidAt: &now,
	}
	if orderID == "" {
		order.ID = "ord_test_" + license.ID
	}
	if _, err := tx.Exec(`INSERT INTO orders(id,customer_id,license_id,plan,first_name,last_name,email,phone,amount_rials,authority,payment_ref,status,created_at,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, order.ID, order.CustomerID, nil, order.Plan, "Test", "Customer", "test@example.com", "09120000000", 1000000, nil, "test-ref", order.Status, formatTime(order.CreatedAt), formatTime(now)); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`INSERT INTO licenses(id,key_hash,plan,status,features_json,max_devices,customer_id,order_id,delivery_ciphertext,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, license.ID, license.KeyHash, license.Plan, license.Status, string(encoded), license.MaxDevices, customerID, order.ID, license.DeliveryCiphertext, formatTime(now)); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE orders SET license_id=? WHERE id=?`, license.ID, order.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return order, nil
}
func (s *Store) Idempotent(scope, key string) ([]byte, bool) {
	var response []byte
	if err := s.db.QueryRow(`SELECT response FROM idempotency WHERE scope=? AND key=?`, scope, key).Scan(&response); err != nil {
		return nil, false
	}
	return append([]byte(nil), response...), true
}
func (s *Store) PutIdempotent(scope, key string, value []byte) error {
	_, err := s.db.Exec(`INSERT INTO idempotency(scope,key,response,created_at) VALUES(?,?,?,?) ON CONFLICT(scope,key) DO NOTHING`, scope, key, value, formatTime(time.Now().UTC()))
	return err
}
func cloneFeatures(value map[string]bool) map[string]bool {
	copy := map[string]bool{}
	for key, item := range value {
		copy[key] = item
	}
	return copy
}
func formatTime(value time.Time) string         { return value.UTC().Format(time.RFC3339Nano) }
func parseTime(value string) (time.Time, error) { return time.Parse(time.RFC3339Nano, value) }
func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return formatTime(*value)
}
func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
