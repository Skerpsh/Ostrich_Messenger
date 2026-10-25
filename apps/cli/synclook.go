package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"golang.org/x/crypto/chacha20poly1305"
)

// The theme synced with the apps (Settings → Appearance → Sync the theme
// with my devices): the apps keep their personalization on the server
// encrypted with a key of the account's (apps/mobile-web/src/features/
// settings/settings-sync.tsx, crypto.ts encryptSettings); the CLI reads
// its light or dark theme and accent, and writes them back when changed
// here, leaving the rest as it is.

const (
	settingsInfo   = "ostrich/v1 settings"
	settingsPrefix = "s1:"
)

func settingsAEAD(privateKey []byte, userID string) (interface {
	Seal(dst, nonce, plaintext, additionalData []byte) []byte
	Open(dst, nonce, ciphertext, additionalData []byte) ([]byte, error)
}, error) {
	return chacha20poly1305.NewX(hkdf32(privateKey, []byte(userID), []byte(settingsInfo)))
}

func encryptSettings(plain string, privateKey []byte, userID string) (string, error) {
	aead, err := settingsAEAD(privateKey, userID)
	if err != nil {
		return "", err
	}

	nonce := randomBytes(chacha20poly1305.NonceSizeX)
	sealed := aead.Seal(nonce, nonce, []byte(plain), []byte(settingsInfo+"\x00"+userID))

	return settingsPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

func decryptSettings(encrypted string, privateKey []byte, userID string) (string, error) {
	if !strings.HasPrefix(encrypted, settingsPrefix) {
		return "", errors.New("unknown settings format")
	}

	data, err := base64.StdEncoding.DecodeString(encrypted[len(settingsPrefix):])
	if err != nil || len(data) < chacha20poly1305.NonceSizeX {
		return "", errors.New("damaged settings")
	}

	aead, err := settingsAEAD(privateKey, userID)
	if err != nil {
		return "", err
	}

	plain, err := aead.Open(nil, data[:chacha20poly1305.NonceSizeX], data[chacha20poly1305.NonceSizeX:], []byte(settingsInfo+"\x00"+userID))
	if err != nil {
		return "", errors.New("the synced settings are not this account's")
	}

	return string(plain), nil
}

type syncedSettings struct {
	Settings *struct {
		Data string `json:"data"`
	} `json:"settings"`
}

// readSynced: the synced settings as JSON (all of it, to write back), or
// nil when there are none yet.
func readSynced(token string, privateKey []byte, userID string) (map[string]any, error) {
	var answer syncedSettings

	if err := authorizedGet(token, "/api/settings", &answer); err != nil {
		return nil, err
	}

	if answer.Settings == nil {
		return nil, nil
	}

	plain, err := decryptSettings(answer.Settings.Data, privateKey, userID)
	if err != nil {
		return nil, err
	}

	var data map[string]any

	if err := json.Unmarshal([]byte(plain), &data); err != nil {
		return nil, errors.New("damaged settings")
	}

	return data, nil
}

// syncedLook: the theme and accent in the synced settings ("" if unset or
// unknown).
func syncedLook(data map[string]any) (theme, accent string) {
	look, _ := data["look"].(map[string]any)
	theme, _ = look["theme"].(string)
	accent, _ = look["accent"].(string)

	switch theme {
	case "light", "dark", "system":
	default:
		theme = ""
	}

	if !isCustomAccent(accent) && findAccent(accent).id != accent {
		accent = ""
	}

	return theme, accent
}

// loadSyncedLook takes the theme and accent from the synced settings; with
// none there yet, this computer's are saved.
func (m *model) loadSyncedLook() tea.Cmd {
	if m.user == nil || !m.cfg.SyncLook {
		return nil
	}

	token, key, userID := m.user.Token, m.user.PrivateKey, m.user.User.ID

	return task(func() func(*model) tea.Cmd {
		data, err := readSynced(token, key, userID)

		return func(m *model) tea.Cmd {
			if m.user == nil || m.user.Token != token || !m.cfg.SyncLook {
				return nil
			}

			if err != nil {
				return m.failSilently(err)
			}

			if data == nil {
				return m.saveSyncedLook()
			}

			theme, accent := syncedLook(data)

			if theme != "" {
				m.cfg.Theme = theme
			}

			if accent != "" {
				m.cfg.Accent = accent
			}

			m.cfg.save()
			m.applyTheme()

			return nil
		}
	})
}

// saveSyncedLook writes this computer's theme and accent into the synced
// settings, keeping what else is there (the apps' text size, chats'
// looks...).
func (m *model) saveSyncedLook() tea.Cmd {
	if m.user == nil || !m.cfg.SyncLook {
		return nil
	}

	token, key, userID := m.user.Token, m.user.PrivateKey, m.user.User.ID
	theme, accent := m.cfg.Theme, m.cfg.Accent

	return task(func() func(*model) tea.Cmd {
		err := func() error {
			data, err := readSynced(token, key, userID)
			if err != nil {
				return err
			}

			plain, err := json.Marshal(withLook(data, theme, accent))
			if err != nil {
				return err
			}

			encrypted, err := encryptSettings(string(plain), key, userID)
			if err != nil {
				return err
			}

			return authorizedJSON(token, "PUT", "/api/settings", map[string]string{"data": encrypted}, nil)
		}()

		return func(m *model) tea.Cmd {
			if err != nil {
				return tea.Batch(m.showToast("Could not sync the theme: "+err.Error(), true), m.failSilently(err))
			}

			return nil
		}
	})
}

// withLook: the synced settings with this theme and accent, the rest kept
// (or new ones when there are none yet).
func withLook(data map[string]any, theme, accent string) map[string]any {
	if data == nil {
		data = map[string]any{"v": 1, "chats": map[string]any{}}
	}

	look, _ := data["look"].(map[string]any)

	if look == nil {
		look = map[string]any{"preferences": map[string]any{}}
	}

	look["theme"], look["accent"] = theme, accent
	data["look"] = look

	return data
}
