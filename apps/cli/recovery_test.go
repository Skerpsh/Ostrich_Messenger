package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// The same vectors are checked by apps/mobile-web/src/crypto/recovery.test.ts,
// so the app and the CLI can be each other's guardians.
func TestRecoveryCrypto(t *testing.T) {
	data, err := os.ReadFile("../../shared/test-vectors/crypto-vectors.json")
	if err != nil {
		t.Fatal(err)
	}

	var all struct {
		OstrichID   string `json:"ostrich_id"`
		PrivateKeyA string `json:"private_key_a"`
		PublicKeyA  string `json:"public_key_a"`
		PrivateKeyB string `json:"private_key_b"`
		MemberIDB   string `json:"member_id_b"`
		SenderID    string `json:"sender_id"`
		Recovery    struct {
			SecretHex       string   `json:"secret_hex"`
			CoefficientsHex string   `json:"coefficients_hex"`
			SharesHex       []string `json:"shares_hex"`
			SetupID         string   `json:"setup_id"`
			SealedShare     string   `json:"sealed_share"`
			SealerPublicKey string   `json:"sealer_public_key"`
			RecoveryCode    string   `json:"recovery_code"`
		} `json:"recovery"`
	}

	if err := json.Unmarshal(data, &all); err != nil {
		t.Fatal(err)
	}

	v := all.Recovery
	secret, _ := hex.DecodeString(v.SecretHex)
	coefficients, _ := hex.DecodeString(v.CoefficientsHex)

	if string(secret) != strings.ReplaceAll(all.OstrichID, "-", "") {
		t.Fatal("the secret is not the OstrichID")
	}

	shares, err := splitSecret(secret, 5, 3, coefficients)
	if err != nil {
		t.Fatal(err)
	}

	for i, share := range shares {
		if hex.EncodeToString(share) != v.SharesHex[i] {
			t.Errorf("share %d: %x", i+1, share)
		}
	}

	for _, pick := range [][]int{{0, 1, 2}, {4, 2, 0}, {1, 3, 4}, {0, 1, 2, 3, 4}} {
		var some [][]byte

		for _, i := range pick {
			some = append(some, shares[i])
		}

		if got, err := combineShares(some); err != nil || !bytes.Equal(got, secret) {
			t.Errorf("%v: %q, %v", pick, got, err)
		}
	}

	if got, _ := combineShares(shares[:2]); bytes.Equal(got, secret) {
		t.Error("two shares gave the secret")
	}

	privateB, _ := base64.StdEncoding.DecodeString(all.PrivateKeyB)
	share, err := openForRecovery(privateB, v.SealerPublicKey, v.SealedShare, shareContext(v.SetupID, all.MemberIDB))

	if err != nil || hex.EncodeToString(share) != v.SharesHex[1] {
		t.Fatalf("sealed share: %x, %v", share, err)
	}

	if _, err := openForRecovery(privateB, v.SealerPublicKey, v.SealedShare, shareContext(v.SetupID, all.SenderID)); err == nil {
		t.Error("opened for another guardian")
	}

	sealed, sealer, err := sealForRecovery(all.PublicKeyA, share, requestContext("r1"))
	privateA, _ := base64.StdEncoding.DecodeString(all.PrivateKeyA)

	if opened, err2 := openForRecovery(privateA, sealer, sealed, requestContext("r1")); err != nil || err2 != nil || !bytes.Equal(opened, share) {
		t.Errorf("sealed again: %v %v", err, err2)
	}

	if code, err := recoveryCode(all.PublicKeyA); err != nil || code != v.RecoveryCode {
		t.Errorf("code %q, %v", code, err)
	}
}

func TestRecoverOstrichID(t *testing.T) {
	id := "K7QM3XRA9TPWH2DCM8VN"
	material, _ := createAccountKeys(deriveFromOstrichID(id))
	shares, err := splitSecret([]byte(id), 5, 3, randomBytes(len(id)*2))
	if err != nil {
		t.Fatal(err)
	}

	wrong := append([]byte{}, shares[1]...)

	for i := 1; i < len(wrong); i++ {
		wrong[i] ^= 0x55
	}

	if got := recoverOstrichID([][]byte{shares[0], wrong, shares[2], shares[3]}, 3, material.EncryptedPrivateKey); got != id {
		t.Fatalf("past a wrong share: %q", got)
	}

	if got := recoverOstrichID([][]byte{shares[0], wrong, shares[2]}, 3, material.EncryptedPrivateKey); got != "" {
		t.Fatalf("with a wrong share among too few: %q", got)
	}

	if got := recoverOstrichID(shares[:2], 3, material.EncryptedPrivateKey); got != "" {
		t.Fatalf("too few: %q", got)
	}
}
