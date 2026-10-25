package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

// The apps' synced settings (shared/test-vectors: written by crypto.ts):
// the CLI reads them, and what it writes back reads the same.
func TestSyncedLook(t *testing.T) {
	data, err := os.ReadFile("../../shared/test-vectors/crypto-vectors.json")
	if err != nil {
		t.Fatal(err)
	}

	var all struct {
		PrivateKeyA string `json:"private_key_a"`
		Settings    struct {
			UserID    string `json:"user_id"`
			JSON      string `json:"json"`
			Encrypted string `json:"encrypted"`
		} `json:"settings"`
	}

	if err := json.Unmarshal(data, &all); err != nil {
		t.Fatal(err)
	}

	key, _ := base64.StdEncoding.DecodeString(all.PrivateKeyA)
	plain, err := decryptSettings(all.Settings.Encrypted, key, all.Settings.UserID)

	if err != nil || plain != all.Settings.JSON {
		t.Fatalf("decrypted %q, %v", plain, err)
	}

	// Not someone else's.
	if _, err := decryptSettings(all.Settings.Encrypted, key, "another-user"); err == nil {
		t.Error("opened for another user")
	}

	var settings map[string]any
	_ = json.Unmarshal([]byte(plain), &settings)

	if theme, accent := syncedLook(settings); theme != "light" || accent != "teal" {
		t.Errorf("look %q %q", theme, accent)
	}

	// Unknown values are not taken.
	if theme, accent := syncedLook(map[string]any{"look": map[string]any{"theme": "sepia", "accent": "plaid"}}); theme != "" || accent != "" {
		t.Errorf("took %q %q", theme, accent)
	}

	if _, accent := syncedLook(map[string]any{"look": map[string]any{"accent": "#12ab34"}}); accent != "#12ab34" {
		t.Errorf("own accent %q", accent)
	}

	// Written back: only the theme and accent change.
	merged, _ := json.Marshal(withLook(settings, "dark", "gold"))
	var check map[string]any
	_ = json.Unmarshal(merged, &check)
	look := check["look"].(map[string]any)

	if look["theme"] != "dark" || look["accent"] != "gold" || look["preferences"].(map[string]any)["textSize"] != "large" ||
		check["chats"].(map[string]any)["x"] == nil || check["v"] != float64(1) {
		t.Errorf("merged: %s", merged)
	}

	if fresh := withLook(nil, "system", "orange"); fresh["v"] != 1 || fresh["look"].(map[string]any)["accent"] != "orange" {
		t.Errorf("new: %v", fresh)
	}

	again, err := encryptSettings(plain, key, all.Settings.UserID)

	if back, _ := decryptSettings(again, key, all.Settings.UserID); err != nil || back != plain {
		t.Fatal("round trip")
	}
}
