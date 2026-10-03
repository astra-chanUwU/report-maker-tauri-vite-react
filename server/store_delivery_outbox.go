package controlplane

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

const (
	deliveryStatusPending = "pending"
	deliveryStatusSent    = "sent"
	deliveryStatusFailed  = "failed"
	deliveryChannelEmail  = "email"
	deliveryChannelSMS    = "sms"
)

type DeliveryOutboxRow struct {
	ID              string
	Channel         string
	ToAddress       string
	Subject         string
	Body            string
	Kind            string
	OrderID         string
	LicenseID       string
	IdempotencyKey  string
	Status          string
	AttemptCount    int
	LastError       string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	SentAt          *time.Time
}

func (s *Store) EnqueueEmailDelivery(msg EmailMessage) (*DeliveryOutboxRow, bool, error) {
	return s.enqueueDelivery(deliveryChannelEmail, strings.TrimSpace(msg.To), strings.TrimSpace(msg.Subject), msg.Body, msg.Kind, msg.OrderID, msg.LicenseID, msg.IdempotencyKey)
}

func (s *Store) EnqueueSMSDelivery(msg SMSMessage) (*DeliveryOutboxRow, bool, error) {
	return s.enqueueDelivery(deliveryChannelSMS, strings.TrimSpace(msg.To), "", msg.Body, msg.Kind, "", "", msg.IdempotencyKey)
}

func (s *Store) enqueueDelivery(channel, to, subject, body, kind, orderID, licenseID, idempotencyKey string) (*DeliveryOutboxRow, bool, error) {
	if s == nil || s.db == nil {
		return nil, false, errors.New("store unavailable")
	}
	if to == "" || body == "" {
		return nil, false, errors.New("delivery recipient or body missing")
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey != "" {
		if row, ok, err := s.findDeliveryByIdempotency(channel, idempotencyKey); err != nil {
			return nil, false, err
		} else if ok {
			return row, true, nil
		}
	}
	now := time.Now().UTC()
	row := &DeliveryOutboxRow{
		ID: randomID("dlv_"), Channel: channel, ToAddress: to, Subject: subject, Body: body,
		Kind: kind, OrderID: orderID, LicenseID: licenseID, IdempotencyKey: idempotencyKey,
		Status: deliveryStatusPending, CreatedAt: now, UpdatedAt: now,
	}
	_, err := s.db.Exec(`INSERT INTO delivery_outbox(
 id, channel, to_address, subject, body, kind, order_id, license_id, idempotency_key,
 status, attempt_count, last_error, created_at, updated_at, sent_at
) VALUES(?,?,?,?,?,?,?,?,?,?,0,'',?,?,NULL)`,
		row.ID, row.Channel, row.ToAddress, row.Subject, row.Body, row.Kind, row.OrderID, row.LicenseID, row.IdempotencyKey,
		row.Status, formatTime(row.CreatedAt), formatTime(row.UpdatedAt),
	)
	if err != nil {
		return nil, false, err
	}
	return row, false, nil
}

func (s *Store) findDeliveryByIdempotency(channel, key string) (*DeliveryOutboxRow, bool, error) {
	row := s.db.QueryRow(`SELECT id, channel, to_address, subject, body, kind, order_id, license_id, idempotency_key,
 status, attempt_count, last_error, created_at, updated_at, sent_at
 FROM delivery_outbox WHERE channel = ? AND idempotency_key = ? LIMIT 1`, channel, key)
	return scanDeliveryRow(row)
}

func (s *Store) ListPendingDeliveries(limit int) ([]*DeliveryOutboxRow, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store unavailable")
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id, channel, to_address, subject, body, kind, order_id, license_id, idempotency_key,
 status, attempt_count, last_error, created_at, updated_at, sent_at
 FROM delivery_outbox WHERE status = ? ORDER BY updated_at ASC LIMIT ?`, deliveryStatusPending, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*DeliveryOutboxRow
	for rows.Next() {
		row, ok, err := scanDeliveryRows(rows)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, row)
		}
	}
	return out, rows.Err()
}

func (s *Store) MarkDeliverySent(id string) error {
	if s == nil || s.db == nil {
		return errors.New("store unavailable")
	}
	now := formatTime(time.Now().UTC())
	_, err := s.db.Exec(`UPDATE delivery_outbox SET status = ?, attempt_count = attempt_count + 1, last_error = '', updated_at = ?, sent_at = ? WHERE id = ?`,
		deliveryStatusSent, now, now, id,
	)
	return err
}

func (s *Store) UpdateDeliveryAttempt(id string, attemptCount int, lastError, status string) error {
	if s == nil || s.db == nil {
		return errors.New("store unavailable")
	}
	now := formatTime(time.Now().UTC())
	_, err := s.db.Exec(`UPDATE delivery_outbox SET status = ?, attempt_count = ?, last_error = ?, updated_at = ? WHERE id = ?`,
		status, attemptCount, lastError, now, id,
	)
	return err
}

func scanDeliveryRow(row *sql.Row) (*DeliveryOutboxRow, bool, error) {
	var (
		item                                                                 DeliveryOutboxRow
		createdAt, updatedAt, sentAt                                         string
	)
	err := row.Scan(&item.ID, &item.Channel, &item.ToAddress, &item.Subject, &item.Body, &item.Kind,
		&item.OrderID, &item.LicenseID, &item.IdempotencyKey, &item.Status, &item.AttemptCount, &item.LastError,
		&createdAt, &updatedAt, &sentAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	item.CreatedAt, _ = parseTime(createdAt)
	item.UpdatedAt, _ = parseTime(updatedAt)
	if sentAt != "" {
		if t, err := parseTime(sentAt); err == nil {
			item.SentAt = &t
		}
	}
	return &item, true, nil
}

func scanDeliveryRows(rows *sql.Rows) (*DeliveryOutboxRow, bool, error) {
	var (
		item                                                                 DeliveryOutboxRow
		createdAt, updatedAt, sentAt                                         string
	)
	err := rows.Scan(&item.ID, &item.Channel, &item.ToAddress, &item.Subject, &item.Body, &item.Kind,
		&item.OrderID, &item.LicenseID, &item.IdempotencyKey, &item.Status, &item.AttemptCount, &item.LastError,
		&createdAt, &updatedAt, &sentAt,
	)
	if err != nil {
		return nil, false, err
	}
	item.CreatedAt, _ = parseTime(createdAt)
	item.UpdatedAt, _ = parseTime(updatedAt)
	if sentAt != "" {
		if t, err := parseTime(sentAt); err == nil {
			item.SentAt = &t
		}
	}
	return &item, true, nil
}
