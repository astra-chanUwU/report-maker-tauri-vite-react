package controlplane

import (
	"context"
	"time"
)

const outboxFlushInterval = 10 * time.Second

type persistentEmailSender struct {
	store       *Store
	underlying  EmailSender
	maxAttempts int
}

type persistentSMSSender struct {
	store       *Store
	underlying  SMSSender
	maxAttempts int
}

func wrapPersistentEmail(store *Store, underlying EmailSender) EmailSender {
	return &persistentEmailSender{
		store: store, underlying: underlying,
		maxAttempts: envInt("REPORT_OUTBOX_MAX_ATTEMPTS", 10),
	}
}

func wrapPersistentSMS(store *Store, underlying SMSSender) SMSSender {
	return &persistentSMSSender{
		store: store, underlying: underlying,
		maxAttempts: envInt("REPORT_OUTBOX_MAX_ATTEMPTS", 10),
	}
}

func (p *persistentEmailSender) Send(ctx context.Context, msg EmailMessage) error {
	row, existing, err := p.store.EnqueueEmailDelivery(msg)
	if err != nil {
		return err
	}
	if existing && row.Status == deliveryStatusSent {
		return nil
	}
	return p.dispatch(ctx, row)
}

func (p *persistentEmailSender) dispatch(ctx context.Context, row *DeliveryOutboxRow) error {
	if row == nil {
		return nil
	}
	if p.underlying == nil {
		return p.store.MarkDeliverySent(row.ID)
	}
	err := p.underlying.Send(ctx, EmailMessage{
		To: row.ToAddress, Subject: row.Subject, Body: row.Body, Kind: row.Kind,
		OrderID: row.OrderID, LicenseID: row.LicenseID, IdempotencyKey: row.IdempotencyKey,
	})
	if err == nil {
		return p.store.MarkDeliverySent(row.ID)
	}
	attempts := row.AttemptCount + 1
	status := deliveryStatusPending
	if attempts >= p.maxAttempts {
		status = deliveryStatusFailed
	}
	_ = p.store.UpdateDeliveryAttempt(row.ID, attempts, redactSecrets(err.Error()), status)
	return err
}

func (p *persistentSMSSender) Send(ctx context.Context, msg SMSMessage) error {
	row, existing, err := p.store.EnqueueSMSDelivery(msg)
	if err != nil {
		return err
	}
	if existing && row.Status == deliveryStatusSent {
		return nil
	}
	return p.dispatch(ctx, row)
}

func (p *persistentSMSSender) dispatch(ctx context.Context, row *DeliveryOutboxRow) error {
	if row == nil {
		return nil
	}
	if p.underlying == nil {
		return p.store.MarkDeliverySent(row.ID)
	}
	err := p.underlying.Send(ctx, SMSMessage{
		To: row.ToAddress, Body: row.Body, Kind: row.Kind, IdempotencyKey: row.IdempotencyKey,
	})
	if err == nil {
		return p.store.MarkDeliverySent(row.ID)
	}
	attempts := row.AttemptCount + 1
	status := deliveryStatusPending
	if attempts >= p.maxAttempts {
		status = deliveryStatusFailed
	}
	_ = p.store.UpdateDeliveryAttempt(row.ID, attempts, redactSecrets(err.Error()), status)
	return err
}

func (a *App) flushPendingDeliveries(ctx context.Context) {
	if a == nil || a.store == nil {
		return
	}
	rows, err := a.store.ListPendingDeliveries(50)
	if err != nil {
		return
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return
		}
		switch row.Channel {
		case deliveryChannelEmail:
			if sender, ok := a.email.(*persistentEmailSender); ok {
				_ = sender.dispatch(ctx, row)
			}
		case deliveryChannelSMS:
			if sender, ok := a.sms.(*persistentSMSSender); ok {
				_ = sender.dispatch(ctx, row)
			}
		}
	}
}

func (a *App) maybeFlushOutbox(ctx context.Context) {
	if a == nil {
		return
	}
	now := time.Now().UnixNano()
	last := a.lastOutboxFlush.Load()
	if now-last < int64(outboxFlushInterval) {
		return
	}
	if !a.lastOutboxFlush.CompareAndSwap(last, now) {
		return
	}
	go a.flushPendingDeliveries(context.Background())
}
