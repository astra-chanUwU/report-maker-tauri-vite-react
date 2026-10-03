package controlplane

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

var base64URL = base64.RawURLEncoding

func CanonicalJSON(value any) ([]byte, error) { return canonical(value) }
func canonical(value any) ([]byte, error) {
	switch typed := value.(type) {
	case nil:
		return []byte("null"), nil
	case string:
		return json.Marshal(typed)
	case bool:
		return json.Marshal(typed)
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return json.Marshal(typed)
	case []any:
		var parts []string
		for _, item := range typed {
			bytes, err := canonical(item)
			if err != nil {
				return nil, err
			}
			parts = append(parts, string(bytes))
		}
		return []byte("[" + strings.Join(parts, ",") + "]"), nil
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		var parts []string
		for _, key := range keys {
			bytes, err := canonical(typed[key])
			if err != nil {
				return nil, err
			}
			encodedKey, _ := json.Marshal(key)
			parts = append(parts, string(encodedKey)+":"+string(bytes))
		}
		return []byte("{" + strings.Join(parts, ",") + "}"), nil
	default:
		bytes, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		var generic any
		if err := json.Unmarshal(bytes, &generic); err != nil {
			return nil, err
		}
		return canonical(generic)
	}
}
func EncodeBytes(value []byte) string { return base64URL.EncodeToString(value) }
func DecodeBytes(value string, max int) ([]byte, error) {
	if value == "" || len(value) > max*2 {
		return nil, errors.New("invalid base64url value")
	}
	bytes, err := base64URL.DecodeString(value)
	if err != nil || len(bytes) > max {
		return nil, errors.New("invalid base64url value")
	}
	return bytes, nil
}
func HashHex(value []byte) string { sum := sha256.Sum256(value); return hex.EncodeToString(sum[:]) }
func Sign(private ed25519.PrivateKey, value any) (string, error) {
	bytes, err := CanonicalJSON(value)
	if err != nil {
		return "", err
	}
	return EncodeBytes(ed25519.Sign(private, bytes)), nil
}
func Verify(public ed25519.PublicKey, value any, signature string) bool {
	sig, err := DecodeBytes(signature, ed25519.SignatureSize)
	if err != nil {
		return false
	}
	bytes, err := CanonicalJSON(value)
	return err == nil && ed25519.Verify(public, bytes, sig)
}
func ParseDeviceKey(value string) (ed25519.PublicKey, error) {
	bytes, err := DecodeBytes(value, ed25519.PublicKeySize)
	if err != nil || len(bytes) != ed25519.PublicKeySize {
		return nil, errors.New("device public key must be 32 bytes")
	}
	return ed25519.PublicKey(bytes), nil
}
func LoadSigningKey(encoded string) (ed25519.PrivateKey, error) {
	if encoded == "" {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		return key, err
	}
	bytes, err := DecodeBytes(encoded, ed25519.SeedSize)
	if err != nil || len(bytes) != ed25519.SeedSize {
		return nil, fmt.Errorf("REPORT_SIGNING_PRIVATE_KEY must decode to 32 bytes")
	}
	return ed25519.NewKeyFromSeed(bytes), nil
}
func ISO(value time.Time) string { return value.UTC().Truncate(time.Second).Format(time.RFC3339) }
