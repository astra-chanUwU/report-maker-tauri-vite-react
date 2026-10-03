package controlplane

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"strings"
)

const licenseKeyAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func LoadDeliveryKey(encoded string) ([]byte, error) {
	if encoded == "" {
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, err
		}
		return key, nil
	}
	bytes, err := DecodeBytes(encoded, 32)
	if err != nil || len(bytes) != 32 {
		return nil, fmt.Errorf("REPORT_LICENSE_DELIVERY_KEY must decode to 32 bytes")
	}
	return bytes, nil
}

func GenerateLicenseKey() (string, error) {
	segments := make([]string, 3)
	for i := range segments {
		segment, err := randomLicenseSegment(4)
		if err != nil {
			return "", err
		}
		segments[i] = segment
	}
	return "RM-" + strings.Join(segments, "-"), nil
}

func randomLicenseSegment(length int) (string, error) {
	out := make([]byte, length)
	max := byte(len(licenseKeyAlphabet))
	for i := range out {
		var b [1]byte
		if _, err := rand.Read(b[:]); err != nil {
			return "", err
		}
		out[i] = licenseKeyAlphabet[int(b[0])%int(max)]
	}
	return string(out), nil
}

func EncryptLicenseKey(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return EncodeBytes(ciphertext), nil
}

func DecryptLicenseKey(key []byte, encoded string) (string, error) {
	if encoded == "" {
		return "", errors.New("missing delivery ciphertext")
	}
	ciphertext, err := DecodeBytes(encoded, 4096)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, payload := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, payload, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func MaskLicenseKey(key string) string {
	key = strings.TrimSpace(key)
	if len(key) <= 8 {
		return "RM-****"
	}
	return key[:7] + strings.Repeat("*", len(key)-11) + key[len(key)-4:]
}
