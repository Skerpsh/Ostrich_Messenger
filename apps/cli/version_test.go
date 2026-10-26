package main

import (
	"encoding/base64"
	"testing"
)

// A SHA256SUMS signed with the release key (openssl pkeyutl -sign -rawin),
// as release.yml signs them.
const (
	signedSums    = "abc123  ostrich-linux-amd64\n"
	signedSumsSig = "T52wwOBM043caYmZ+GZGmyDjhlfBvkQ4L9AiCYFS+S/X3hoRmyizRxqqQBHzkIKY9vfP5ysmUkaHP5hSq7YjBg=="
)

func TestVerifyRelease(t *testing.T) {
	signature, _ := base64.StdEncoding.DecodeString(signedSumsSig)

	if !verifyRelease([]byte(signedSums), signature) {
		t.Fatal("a release signed with the release key is refused")
	}

	if verifyRelease([]byte("evil00  ostrich-linux-amd64\n"), signature) {
		t.Fatal("a changed SHA256SUMS is accepted")
	}

	if verifyRelease([]byte(signedSums), nil) {
		t.Fatal("a release without a signature is accepted")
	}
}
