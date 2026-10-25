package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"

	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/curve25519"
)

// Recovery through friends, the same as the app's
// (apps/mobile-web/src/crypto/crypto.ts, see the description there): the
// OstrichID split among guardians with Shamir's secret sharing over
// GF(256), each share sealed for its guardian, and sealed again for the
// device that recovers.

const (
	recoveryInfo     = "ostrich/v1 recovery"
	recoveryCodeInfo = "ostrich/v1 recovery code"
)

// GF(256) with the AES polynomial, by logarithms (generator 3).
var gfExp, gfLog = func() ([510]byte, [256]byte) {
	var exp [510]byte
	var log [256]byte
	x := 1

	for i := range 255 {
		exp[i], exp[i+255] = byte(x), byte(x)
		log[x] = byte(i)
		next := x ^ x<<1

		if x&0x80 != 0 {
			next ^= 0x11b
		}

		x = next & 0xff
	}

	return exp, log
}()

func gfMul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}

	return gfExp[int(gfLog[a])+int(gfLog[b])]
}

func gfDiv(a, b byte) byte {
	if a == 0 {
		return 0
	}

	return gfExp[int(gfLog[a])+255-int(gfLog[b])]
}

// splitSecret: total shares (x, then a byte per byte of the secret), any
// threshold of which give the secret back; coefficients: secret length ×
// (threshold − 1) random bytes.
func splitSecret(secret []byte, total, threshold int, coefficients []byte) ([][]byte, error) {
	if threshold < 2 || threshold > total || total > 255 || len(coefficients) != len(secret)*(threshold-1) {
		return nil, errors.New("choose at least 2 shares out of no more than all of them")
	}

	shares := make([][]byte, total)

	for x := 1; x <= total; x++ {
		share := make([]byte, len(secret)+1)
		share[0] = byte(x)

		for i, s := range secret {
			var y byte

			for c := threshold - 2; c >= 0; c-- {
				y = gfMul(y^coefficients[i*(threshold-1)+c], byte(x))
			}

			share[i+1] = y ^ s
		}

		shares[x-1] = share
	}

	return shares, nil
}

// combineShares: the secret from threshold or more shares (Lagrange at 0).
func combineShares(shares [][]byte) ([]byte, error) {
	if len(shares) < 2 {
		return nil, errors.New("not enough shares")
	}

	seen := map[byte]bool{}

	for _, share := range shares {
		if len(share) != len(shares[0]) || share[0] == 0 || seen[share[0]] {
			return nil, errors.New("the shares are not of one secret")
		}

		seen[share[0]] = true
	}

	secret := make([]byte, len(shares[0])-1)

	for i := range secret {
		var value byte

		for j, share := range shares {
			weight := byte(1)

			for m, other := range shares {
				if m != j {
					weight = gfMul(weight, gfDiv(other[0], other[0]^share[0]))
				}
			}

			value ^= gfMul(share[i+1], weight)
		}

		secret[i] = value
	}

	return secret, nil
}

func recoveryAEAD(ownPrivate []byte, otherPublic, context string) (interface {
	Seal(dst, nonce, plaintext, additionalData []byte) []byte
	Open(dst, nonce, ciphertext, additionalData []byte) ([]byte, error)
}, error) {
	other, err := base64.StdEncoding.DecodeString(otherPublic)
	if err != nil {
		return nil, errors.New("invalid key")
	}

	shared, err := curve25519.X25519(ownPrivate, other)
	if err != nil {
		return nil, err
	}

	return chacha20poly1305.NewX(hkdf32(shared, []byte(context), []byte(recoveryInfo)))
}

// sealForRecovery seals data for a public key with a one-time key;
// context binds it (whose share, which request).
func sealForRecovery(recipientPublic string, data []byte, context string) (sealed, sealerPublic string, err error) {
	own := randomBytes(curve25519.ScalarSize)

	if sealerPublic, err = publicKeyOf(own); err != nil {
		return "", "", err
	}

	aead, err := recoveryAEAD(own, recipientPublic, context)
	if err != nil {
		return "", "", err
	}

	nonce := randomBytes(chacha20poly1305.NonceSizeX)
	out := aead.Seal(nonce, nonce, data, []byte(recoveryInfo+"\x00"+context))

	return base64.StdEncoding.EncodeToString(out), sealerPublic, nil
}

// openForRecovery: an error if it was not sealed for this key in this
// context.
func openForRecovery(ownPrivate []byte, sealerPublic, sealed, context string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil || len(data) < chacha20poly1305.NonceSizeX {
		return nil, errors.New("invalid share")
	}

	aead, err := recoveryAEAD(ownPrivate, sealerPublic, context)
	if err != nil {
		return nil, err
	}

	return aead.Open(nil, data[:chacha20poly1305.NonceSizeX], data[chacha20poly1305.NonceSizeX:], []byte(recoveryInfo+"\x00"+context))
}

func shareContext(setupID, guardianID string) string { return "share:" + setupID + ":" + guardianID }

func requestContext(requestID string) string { return "request:" + requestID }

// recoveryCode: "381 904", compared aloud between the one recovering and
// a guardian.
func recoveryCode(publicKey string) (string, error) {
	key, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil {
		return "", errors.New("invalid key")
	}

	hash := sha256.Sum256(append([]byte(recoveryCodeInfo), key...))
	digits := fmt.Sprintf("%06d", binary.BigEndian.Uint32(hash[:4])%1_000_000)

	return digits[:3] + " " + digits[3:], nil
}

// recoverOstrichID: the OstrichID from the shares the guardians gave, or
// "": tries each threshold of them (one guardian could have sent a wrong
// share) until the ID opens the account's private key.
func recoverOstrichID(shares [][]byte, threshold int, encryptedPrivateKey string) string {
	var pick func(from int, chosen [][]byte) string

	pick = func(from int, chosen [][]byte) string {
		if len(chosen) == threshold {
			secret, err := combineShares(chosen)
			if err != nil {
				return ""
			}

			id := normalizeOstrichID(string(secret))

			if id == "" {
				return ""
			}

			if _, err := openPrivateKey(deriveFromOstrichID(id), encryptedPrivateKey); err != nil {
				return ""
			}

			return id
		}

		for i := from; i <= len(shares)-(threshold-len(chosen)); i++ {
			if id := pick(i+1, append(append([][]byte{}, chosen...), shares[i])); id != "" {
				return id
			}
		}

		return ""
	}

	if threshold < 2 || len(shares) < threshold {
		return ""
	}

	return pick(0, nil)
}
