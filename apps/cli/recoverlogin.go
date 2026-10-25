package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	zone "github.com/lrstanley/bubblezone"
)

// Recovering an account through friends (recovery.go) from the login
// screen, like the app's app/recover.tsx: asks with the username and
// password and a one-time key pair, shows the code to read to the
// guardians, waits (the request is kept in a file, so the CLI can be
// closed meanwhile) and, once a day has passed and enough have approved,
// puts the OstrichID together from their shares, logs in and gives the
// account a new one.

const recoveryPollInterval = 15 * time.Second

// savedRecovery is kept in ~/.config/ostrich/recovery-<server>.json,
// readable only by the user: the request's secret and one-time private
// key (not the account's). Not the password: it is asked again.
type savedRecovery struct {
	Server     string `json:"server"`
	ID         string `json:"id"`
	Secret     string `json:"secret"`
	PrivateKey string `json:"private_key"`
	PublicKey  string `json:"public_key"`
	Username   string `json:"username"`
	Threshold  int    `json:"threshold"`
	ReadyAt    string `json:"ready_at"`
	ExpiresAt  string `json:"expires_at"`
	// The new OstrichID, made before it is sent (see loginRecovered).
	NewID string `json:"new_id,omitempty"`
}

type recoveryProgress struct {
	State               string      `json:"state"`
	ReadyAt             string      `json:"ready_at"`
	Approvals           int         `json:"approvals"`
	Threshold           *int        `json:"threshold"`
	Shares              []shareSeal `json:"shares"`
	EncryptedPrivateKey string      `json:"encrypted_private_key"`
}

type recoverLogin struct {
	// Answers for an older request are ignored.
	round    int
	saved    *savedRecovery
	progress *recoveryProgress
	// Username and password (asking); the password again once ready.
	inputs  [2]textinput.Model
	focus   int
	loading bool
	err     string
}

func recoveryPath() (string, bool) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", false
	}

	hash := sha256.Sum256([]byte(serverURL))

	return filepath.Join(dir, "ostrich", "recovery-"+hex.EncodeToString(hash[:6])+".json"), true
}

func loadSavedRecovery() *savedRecovery {
	path, ok := recoveryPath()
	if !ok {
		return nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	var saved savedRecovery

	if json.Unmarshal(data, &saved) != nil || saved.Server != serverURL || saved.ID == "" {
		return nil
	}

	return &saved
}

func writeSavedRecovery(saved *savedRecovery) error {
	path, ok := recoveryPath()
	if !ok {
		return errors.New("no config directory to keep the request in")
	}

	data, err := json.MarshalIndent(saved, "", "  ")
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	tmp := path + ".tmp"

	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}

	return os.Rename(tmp, path)
}

func forgetSavedRecovery() {
	if path, ok := recoveryPath(); ok {
		_ = os.Remove(path)
	}
}

// phase: "ask", "waiting", "ready" or "over".
func (r *recoverLogin) phase() string {
	switch {
	case r.saved == nil:
		return "ask"
	case r.progress == nil:
		return "waiting"
	case r.progress.State == "ready", r.progress.State == "completed" && r.saved.NewID != "":
		return "ready"
	case r.progress.State != "waiting":
		return "over"
	}

	return "waiting"
}

func (r *recoverLogin) focusInput(i int) tea.Cmd {
	r.focus = i

	for j := range r.inputs {
		r.inputs[j].Blur()
	}

	return r.inputs[i].Focus()
}

func (m *model) startRecoverLogin() tea.Cmd {
	m.auth.qrRound++
	r := &recoverLogin{round: m.auth.qrRound, saved: loadSavedRecovery()}
	r.inputs[0] = newInput("@username", 33, false, m.pal)
	r.inputs[1] = newInput("Password", 128, true, m.pal)
	r.inputs[0].SetValue(m.auth.inputs[fieldUsername].Value())
	w := authCardWidth(m.width) - 8

	for i := range r.inputs {
		r.inputs[i].Width = w
	}

	m.auth.recover = r
	m.auth.err = ""

	if r.saved != nil {
		return tea.Batch(r.focusInput(1), m.checkRecovery(r, 0))
	}

	if r.inputs[0].Value() != "" {
		return r.focusInput(1)
	}

	return r.focusInput(0)
}

// checkRecovery asks, after delay, how the request is going.
func (m *model) checkRecovery(r *recoverLogin, delay time.Duration) tea.Cmd {
	round, id, secret := r.round, r.saved.ID, r.saved.Secret

	ask := func() tea.Msg {
		var progress recoveryProgress
		err := postPublic("/api/recovery/requests/"+url.PathEscape(id)+"/status", map[string]string{"secret": secret}, &progress)

		return resultMsg{apply: func(m *model) tea.Cmd {
			r := m.auth.recover

			if r == nil || r.round != round || m.stage != stageAuth {
				return nil
			}

			var apiErr *apiError

			switch {
			case errors.As(err, &apiErr) && apiErr.status == http.StatusNotFound:
				progress = recoveryProgress{State: "expired"}
			case errors.As(err, &apiErr):
				r.err = err.Error()
				return nil
			case err != nil:
				// Offline for a moment: asked again.
				return m.checkRecovery(r, recoveryPollInterval)
			}

			r.progress = &progress

			if progress.State == "waiting" {
				return m.checkRecovery(r, recoveryPollInterval)
			}

			return nil
		}}
	}

	if delay == 0 {
		return ask
	}

	return tea.Tick(delay, func(time.Time) tea.Msg { return ask() })
}

func (m *model) updateRecoverLoginKey(msg tea.KeyMsg) tea.Cmd {
	r := m.auth.recover

	if r.loading {
		return nil
	}

	phase := r.phase()

	switch key := msg.String(); {
	case key == "esc":
		m.auth.recover = nil
		return nil
	case key == "ctrl+r":
		m.auth.remember = !m.auth.remember
		return nil
	case phase == "waiting" && key == "ctrl+x", phase == "over" && key == "enter":
		forgetSavedRecovery()
		return m.startRecoverLogin()
	case phase == "waiting" && key == "ctrl+n":
		return m.checkRecovery(r, 0)
	case phase == "ask" && (key == "tab" || key == "down" || key == "up" || key == "shift+tab"):
		return r.focusInput(1 - r.focus)
	case phase == "ask" && key == "enter" && r.focus == 0:
		return r.focusInput(1)
	case phase == "ask" && key == "enter":
		return m.askRecovery()
	case phase == "ready" && key == "enter":
		return m.finishRecovery()
	case phase != "ask" && phase != "ready":
		return nil
	}

	var cmd tea.Cmd
	r.inputs[r.focus], cmd = r.inputs[r.focus].Update(msg)
	r.err = ""

	return cmd
}

func (m *model) updateRecoverLoginMouse(msg tea.MouseMsg) tea.Cmd {
	r := m.auth.recover

	switch {
	case r.loading:
	case clicked(msg, "recover:back"):
		m.auth.recover = nil
	case clicked(msg, "recover:remember"):
		m.auth.remember = !m.auth.remember
	case clicked(msg, "recover:submit"):
		if r.phase() == "ask" {
			return m.askRecovery()
		}

		return m.finishRecovery()
	case clicked(msg, "recover:forget"):
		forgetSavedRecovery()
		return m.startRecoverLogin()
	case clicked(msg, "recover:field:0") && r.phase() == "ask":
		return r.focusInput(0)
	case clicked(msg, "recover:field:1"):
		return r.focusInput(1)
	}

	return nil
}

func (m *model) askRecovery() tea.Cmd {
	r := m.auth.recover
	username := cleanUsername(r.inputs[0].Value())
	password := r.inputs[1].Value()

	if username == "" || password == "" {
		r.err = "Username and password are required"
		return nil
	}

	r.loading = true
	r.err = ""
	round := r.round

	return task(func() func(*model) tea.Cmd {
		private, public := newLinkKeys()
		var asked struct {
			ID        string `json:"id"`
			Secret    string `json:"secret"`
			Username  string `json:"username"`
			ReadyAt   string `json:"ready_at"`
			ExpiresAt string `json:"expires_at"`
			Threshold int    `json:"threshold"`
		}

		err := postPublic("/api/recovery/requests", map[string]string{"username": username, "password": password, "public_key": public}, &asked)
		var saved *savedRecovery

		if err == nil {
			saved = &savedRecovery{
				Server: serverURL, ID: asked.ID, Secret: asked.Secret,
				PrivateKey: base64.StdEncoding.EncodeToString(private), PublicKey: public,
				Username: asked.Username, Threshold: asked.Threshold, ReadyAt: asked.ReadyAt, ExpiresAt: asked.ExpiresAt,
			}
			err = writeSavedRecovery(saved)
		}

		return func(m *model) tea.Cmd {
			r := m.auth.recover

			if r == nil || r.round != round {
				return nil
			}

			r.loading = false

			if err != nil {
				r.err = err.Error()
				return nil
			}

			r.saved = saved
			r.inputs[1].SetValue("")

			return m.checkRecovery(r, 0)
		}
	})
}

func (m *model) finishRecovery() tea.Cmd {
	r := m.auth.recover
	password := r.inputs[1].Value()

	if password == "" {
		r.err = "Enter your password"
		return nil
	}

	r.loading = true
	r.err = ""
	round := r.round
	saved := *r.saved
	progress := *r.progress
	remember := m.auth.remember

	return task(func() func(*model) tea.Cmd {
		result, err := finishRecovery(&saved, progress, password)

		return func(m *model) tea.Cmd {
			r := m.auth.recover

			if r == nil || r.round != round {
				return nil
			}

			r.loading = false
			r.saved = &saved

			if err != nil {
				r.err = err.Error()
				return nil
			}

			forgetSavedRecovery()
			m.auth.recover = nil
			m.rememberLater = remember
			cmd := m.startSession(result)
			m.recovery.recovered = true

			return cmd
		}
	})
}

// finishRecovery puts the OstrichID together from the guardians' shares
// and logs in with a new one (kept in the file first; saved gets it).
func finishRecovery(saved *savedRecovery, progress recoveryProgress, password string) (*LoginResponse, error) {
	recovered := ""

	if progress.State == "ready" {
		private, err := base64.StdEncoding.DecodeString(saved.PrivateKey)
		if err != nil {
			return nil, err
		}

		var shares [][]byte

		for _, share := range progress.Shares {
			if opened, err := openForRecovery(private, share.SealerPublic, share.Sealed, requestContext(saved.ID)); err == nil {
				shares = append(shares, opened)
			}
		}

		threshold := saved.Threshold

		if progress.Threshold != nil {
			threshold = *progress.Threshold
		}

		if recovered = recoverOstrichID(shares, threshold, progress.EncryptedPrivateKey); recovered == "" {
			return nil, errors.New("the guardians' shares do not give your OstrichID: someone may have sent a wrong one. Ask them to approve again, or start again")
		}
	}

	if saved.NewID == "" {
		saved.NewID = generateOstrichID()

		if err := writeSavedRecovery(saved); err != nil {
			return nil, err
		}
	}

	return loginRecovered(saved.Username, password, recovered, saved.NewID)
}

func isWrongLogin(err error) bool {
	var apiErr *apiError

	return errors.Is(err, errWrongCredentials) || errors.As(err, &apiErr) && apiErr.status == http.StatusUnauthorized
}

// loginRecovered logs in with the recovered OstrichID and replaces it with
// newID; recoveredID "": the server has the new one already.
func loginRecovered(username, password, recoveredID, newID string) (*LoginResponse, error) {
	if recoveredID != "" {
		result, err := loginWithCredentials(username, password, recoveredID)

		switch {
		case err == nil:
			var changed struct {
				Keys *AccountKeys `json:"keys"`
			}

			err = authorizedPost(result.Token, "/api/auth/ostrich-id", map[string]any{
				"password": password,
				"auth_key": deriveFromOstrichID(recoveredID).authKey,
				"keys":     wrapAccountKey(deriveFromOstrichID(newID), result.PrivateKey),
			}, &changed)

			if err != nil {
				return nil, err
			}

			result.Keys = changed.Keys
			result.OstrichID = formatOstrichID(newID)

			return result, nil
		case !isWrongLogin(err):
			return nil, err
		}
		// Already changed by a try whose answer was lost.
	}

	result, err := loginWithCredentials(username, password, newID)

	if isWrongLogin(err) {
		return nil, errors.New("Invalid username or password")
	}

	if err != nil {
		return nil, err
	}

	result.OstrichID = formatOstrichID(newID)

	return result, nil
}

func (m model) recoverLoginView() string {
	p := m.pal
	r := m.auth.recover
	w := authCardWidth(m.width)
	inner := w - 4
	lines := []string{""}

	text := func(s string) {
		for _, line := range wrap(s, inner) {
			lines = append(lines, seg(line, p.textSoft, p.bg))
		}

		lines = append(lines, "")
	}

	field := func(i int, label string) {
		lines = append(lines,
			seg(label, p.textSoft, p.bg),
			zone.Mark(fmt.Sprintf("recover:field:%d", i), m.inputBox(r.inputs[i].View(), r.focus == i, inner)),
			"",
		)
	}

	phase := r.phase()
	hints := "Esc back"
	submit := ""

	switch phase {
	case "ask":
		text("Lost your OstrichID? If you chose guardians, a few of them can give it back. Your devices still logged in are warned and can stop it for a day.")
		field(0, "Username")
		field(1, "Password")
		submit = "Ask my guardians"
		hints = "↑↓ field  Enter next / ask  Ctrl+R remember me  Esc back"
	case "waiting":
		text("Call or meet your guardians and read each of them this code. They type it in Settings → Recovery through friends to approve. Do not send it in a message.")
		code, _ := recoveryCode(r.saved.PublicKey)
		lines = append(lines,
			"",
			center(bold(code, p.accent, p.bg), inner, p.bg),
			"",
			"",
		)

		threshold := r.saved.Threshold
		approved := "…"
		readyAt := r.saved.ReadyAt

		if pr := r.progress; pr != nil {
			if pr.Threshold != nil {
				threshold = *pr.Threshold
			}

			approved = fmt.Sprintf("%d", pr.Approvals)
			readyAt = pr.ReadyAt
		}

		when := "The day of waiting is over"

		if ready, err := time.Parse(time.RFC3339, readyAt); err == nil && ready.After(time.Now()) {
			when = "You can log in after " + formatDateTime(readyAt)
		}

		lines = append(lines,
			seg(fmt.Sprintf("%s of %d guardians have approved", approved, threshold), p.text, p.bg),
			seg(clip(when, inner), p.text, p.bg),
			"",
		)
		text("You can close Ostrich meanwhile: this request is kept on this computer until " + formatDateTime(r.saved.ExpiresAt) + ".")
		lines = append(lines, m.link("recover:forget", "Ctrl+X", "Stop recovering", inner, true))
		hints = "Ctrl+N check now  Ctrl+X stop recovering  Esc back"
	case "ready":
		text("Your guardians have given back your OstrichID. Enter your password to log in as @" + sanitize(r.saved.Username) + ": you get a new OstrichID, and your other devices are logged out.")
		field(1, "Password")
		submit = "Log in"
		hints = "Enter log in  Ctrl+R remember me  Esc back"
	case "over":
		switch r.progress.State {
		case "cancelled":
			text("This request was cancelled: from one of the account's devices, or by a newer request, or the guardians were changed.")
		case "completed":
			text("This request was already used.")
		default:
			text("This request has expired.")
		}

		lines = append(lines, m.link("recover:forget", "Enter", "Start again", inner, true))
		hints = "Enter start again  Esc back"
	}

	if r.err != "" {
		for _, line := range wrap(sanitize(r.err), inner) {
			lines = append(lines, seg(line, p.danger, p.bg))
		}

		lines = append(lines, "")
	}

	if submit != "" {
		if r.loading {
			submit = "…"
		}

		lines = append(lines,
			m.checkbox("recover:remember", m.auth.remember, "Remember me on this computer"),
			"",
			zone.Mark("recover:submit", m.button(submit, inner, true, !r.loading)),
		)
	}

	lines = append(lines, "", m.link("recover:back", "Esc", "Back to logging in", inner, true))

	return m.screen(m.box("Recover with friends", lines, w), hints)
}
