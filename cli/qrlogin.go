package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	zone "github.com/lrstanley/bubblezone"
)

// Logging in with a QR code, without the password or the OstrichID
// (backend/src/routes/device-links.ts): the terminal shows a QR code with
// a link id and a one-time public key; a logged-in app scans it (Settings
// → Devices → Link a device) and sends the account's private key sealed
// for that key. The terminal asks for the session with a secret that is
// not in the QR code, so seeing the code is not enough to log in.

const qrPollInterval = 2 * time.Second

// qrLogin is the QR code being shown on the login screen.
type qrLogin struct {
	// Answers for an older code are ignored.
	round      int
	id, secret string
	private    []byte
	// The QR code's text; empty while the link is being made.
	text string
	err  string
}

type deviceLink struct {
	ID     string `json:"id"`
	Secret string `json:"secret"`
}

type deviceLinkAnswer struct {
	Status          string       `json:"status"`
	Token           string       `json:"token"`
	User            Account      `json:"user"`
	Keys            *AccountKeys `json:"keys"`
	SealedKey       string       `json:"sealed_key"`
	SealerPublicKey string       `json:"sealer_public_key"`
}

// postPublic sends v as JSON in a POST request without a session.
func postPublic(path string, v, out any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("failed to encode request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, serverURL+path, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	return doJSON(req, out)
}

// startQRLogin makes a new link and shows its code.
func (m *model) startQRLogin() tea.Cmd {
	// Only ever goes up, so nothing from a closed code acts on a new one.
	m.auth.qrRound++
	round := m.auth.qrRound

	private, public := newLinkKeys()
	m.auth.qr = &qrLogin{round: round, private: private}
	m.auth.err = ""

	return task(func() func(*model) tea.Cmd {
		var link deviceLink
		err := postPublic("/api/device-links", map[string]any{}, &link)

		return func(m *model) tea.Cmd {
			qr := m.auth.qr

			if qr == nil || qr.round != round || m.stage != stageAuth {
				return nil
			}

			if err != nil {
				qr.err = err.Error()
				return nil
			}

			qr.id, qr.secret = link.ID, link.Secret
			qr.text = "ostrich-login:" + link.ID + ":" + public

			return m.pollQRLogin(qr)
		}
	})
}

// pollQRLogin asks in a moment whether the code was scanned and approved.
func (m *model) pollQRLogin(qr *qrLogin) tea.Cmd {
	round, id, secret := qr.round, qr.id, qr.secret

	return tea.Tick(qrPollInterval, func(time.Time) tea.Msg {
		var answer deviceLinkAnswer
		err := postPublic("/api/device-links/"+url.PathEscape(id)+"/session", map[string]string{"secret": secret}, &answer)

		return resultMsg{apply: func(m *model) tea.Cmd {
			return m.onQRAnswer(round, answer, err)
		}}
	})
}

func (m *model) onQRAnswer(round int, answer deviceLinkAnswer, err error) tea.Cmd {
	qr := m.auth.qr

	if qr == nil || qr.round != round || m.stage != stageAuth {
		return nil
	}

	var apiErr *apiError

	switch {
	// Expired: a new code.
	case errors.As(err, &apiErr) && apiErr.status == http.StatusNotFound:
		return m.startQRLogin()
	case errors.As(err, &apiErr):
		qr.err = err.Error()
		return nil
	// Offline for a moment: asked again.
	case err != nil, answer.Status != "approved":
		return m.pollQRLogin(qr)
	}

	key, err := openLinkSeal(qr.private, answer.SealerPublicKey, answer.SealedKey, qr.id)

	if err == nil && answer.Keys != nil {
		// Not the account's key: not from one of its devices.
		if public, _ := publicKeyOf(key); public != answer.Keys.PublicKey {
			err = errors.New("the device that scanned the code sent a wrong key")
		}
	}

	if err != nil || answer.Keys == nil || answer.Token == "" {
		qr.err = "Could not log in with this code. Show a new one (r) and try again."
		return nil
	}

	remember := m.auth.remember
	m.auth.qr = nil
	cmd := m.startSession(&LoginResponse{Token: answer.Token, User: answer.User, Keys: answer.Keys, PrivateKey: key})

	if remember {
		cmd = tea.Batch(cmd, m.rememberSession())
	}

	return cmd
}

func (m *model) updateQRLoginKey(msg tea.KeyMsg) tea.Cmd {
	switch msg.String() {
	case "esc":
		m.auth.qr = nil
	case "r":
		return m.startQRLogin()
	case "ctrl+r":
		m.auth.remember = !m.auth.remember
	}

	return nil
}

func (m *model) updateQRLoginMouse(msg tea.MouseMsg) tea.Cmd {
	switch {
	case clicked(msg, "qrlogin:back"):
		m.auth.qr = nil
	case clicked(msg, "qrlogin:remember"):
		m.auth.remember = !m.auth.remember
	}

	return nil
}

func (m model) qrLoginView() string {
	p := m.pal
	qr := m.auth.qr
	w := authCardWidth(m.width)
	inner := w - 4

	lines := []string{bold("Log in with a QR code", p.text, p.panel), ""}

	switch {
	case qr.err != "":
		for _, line := range wrap(sanitize(qr.err), inner) {
			lines = append(lines, seg(line, p.danger, p.panel))
		}

		lines = append(lines, "")
	case qr.text == "":
		lines = append(lines, center(seg("Making a code…", p.muted, p.panel), inner, p.panel), "")
	default:
		code, err := qrLines(qr.text)
		if err != nil {
			lines = append(lines, seg(clip(err.Error(), inner), p.danger, p.panel))
		}

		for _, line := range code {
			lines = append(lines, center(line, inner, p.panel))
		}

		lines = append(lines, "")
	}

	for i, step := range []string{
		"Open Ostrich on a phone where you are logged in",
		"Settings → Devices → Link a device",
		"Point the camera at this code and confirm",
	} {
		lines = append(lines, seg(fmt.Sprintf("%d  ", i+1), p.accent, p.panel)+seg(clip(step, inner-3), p.textSoft, p.panel))
	}

	box := "☐"

	if m.auth.remember {
		box = "☑"
	}

	lines = append(lines,
		"",
		zone.Mark("qrlogin:remember", seg(box+" ", p.accent, p.panel)+seg("Remember me on this computer", p.text, p.panel)),
		"",
		zone.Mark("qrlogin:back", m.button("Log in with a password", inner, false, true)),
	)

	// The code needs the room: the logo only on tall terminals.
	block := m.card(lines, w)

	if m.height >= len(lines)+8 {
		block = strings.Join([]string{
			center(bold(logo[0], p.accent, p.bg), w, p.bg),
			center(bold(logo[1], p.accent, p.bg), w, p.bg),
			blank(w, p.bg),
		}, "\n") + "\n" + block
	}

	return m.screen(block, "r New code   Ctrl+R Remember me   Esc Back")
}
