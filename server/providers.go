package controlplane

import (
	"context"
	"sync"
)

type EmailMessage struct {
	To, Subject, Body, Kind string
	OrderID, LicenseID      string
}

type EmailSender interface {
	Send(ctx context.Context, msg EmailMessage) error
}

type LocalOutbox struct {
	mu       sync.Mutex
	Messages []EmailMessage
}

func (o *LocalOutbox) Send(_ context.Context, msg EmailMessage) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.Messages = append(o.Messages, msg)
	return nil
}

type SMSMessage struct {
	To, Body string
}

type SMSSender interface {
	Send(ctx context.Context, msg SMSMessage) error
}

type FakeSMS struct {
	mu       sync.Mutex
	Messages []SMSMessage
}

func (f *FakeSMS) Send(_ context.Context, msg SMSMessage) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Messages = append(f.Messages, msg)
	return nil
}
