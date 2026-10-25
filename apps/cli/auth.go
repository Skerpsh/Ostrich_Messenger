package main

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/cursor"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	zone "github.com/lrstanley/bubblezone"
)

// Login and registration, and the new account's OstrichID (shown once).

// Same rules as the backend.
var usernameRE = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,32}$`)

var errInvalidUsername = errors.New("username: 3–32 characters, letters, digits, _ . - only")

const minPasswordLength = 8

func validUsername(username string) bool {
	return usernameRE.MatchString(username)
}

// cleanUsername turns "@alice" into "alice".
func cleanUsername(input string) string {
	return strings.TrimPrefix(strings.TrimSpace(input), "@")
}

const (
	fieldUsername = iota
	fieldPassword
	fieldConfirm
	fieldOstrichID
	authFields
)

type authState struct {
	register bool
	// Keep the session for the next start.
	remember bool
	inputs   [authFields]textinput.Model
	// Index into fields().
	focus   int
	loading bool
	err     string
	// E.g. "session expired".
	notice string
	// Logging in with a QR code instead (qrlogin.go), and how many codes
	// have been made (answers for older ones are ignored).
	qr      *qrLogin
	qrRound int
	// Recovering the account through friends instead (recoverlogin.go).
	recover *recoverLogin
}

// newInput is a text input in the app's style.
func newInput(placeholder string, limit int, secret bool, p palette) textinput.Model {
	input := textinput.New()
	input.Prompt = ""
	input.Placeholder = placeholder
	input.CharLimit = limit
	input.Cursor.SetMode(cursor.CursorStatic)

	if secret {
		input.EchoMode = textinput.EchoPassword
		input.EchoCharacter = '•'
	}

	styleInput(&input, p)

	return input
}

func styleInput(input *textinput.Model, p palette) {
	input.TextStyle = lipgloss.NewStyle().Foreground(p.text).Background(p.panelAlt)
	input.PlaceholderStyle = lipgloss.NewStyle().Foreground(p.muted).Background(p.panelAlt)
	input.Cursor.Style = lipgloss.NewStyle().Foreground(p.accent).Background(p.panelAlt)
	input.Cursor.TextStyle = input.TextStyle
	input.CompletionStyle = input.PlaceholderStyle
}

func newAuthState(p palette) authState {
	a := authState{remember: true}
	a.inputs[fieldUsername] = newInput("@username", 33, false, p)
	a.inputs[fieldPassword] = newInput("Password", 128, true, p)
	a.inputs[fieldConfirm] = newInput("Repeat the password", 128, true, p)
	a.inputs[fieldOstrichID] = newInput("XXXX-XXXX-XXXX-XXXX-XXXX", 40, true, p)
	a.inputs[fieldUsername].Focus()

	return a
}

func (a *authState) restyle(p palette) {
	for i := range a.inputs {
		styleInput(&a.inputs[i], p)
	}

	if a.recover != nil {
		for i := range a.recover.inputs {
			styleInput(&a.recover.inputs[i], p)
		}
	}
}

func (a *authState) resize(screenWidth int) {
	w := authCardWidth(screenWidth) - 8

	for i := range a.inputs {
		a.inputs[i].Width = w
	}
}

// reset empties the secrets and goes back to the first field.
func (a *authState) reset() {
	a.inputs[fieldPassword].SetValue("")
	a.inputs[fieldConfirm].SetValue("")
	a.inputs[fieldOstrichID].SetValue("")
	a.loading = false
	a.err = ""
	a.notice = ""
	a.focusField(0)
}

// fields are the inputs of the current form, in order.
func (a authState) fields() []int {
	if a.register {
		return []int{fieldUsername, fieldPassword, fieldConfirm}
	}

	return []int{fieldUsername, fieldPassword, fieldOstrichID}
}

func (a *authState) focusField(i int) {
	fields := a.fields()
	a.focus = (i%len(fields) + len(fields)) % len(fields)

	for j := range a.inputs {
		a.inputs[j].Blur()
	}

	a.inputs[fields[a.focus]].Focus()
}

func (a *authState) setMode(register bool) {
	a.register = register
	a.err = ""
	a.focusField(0)
}

func (m *model) updateAuthKey(msg tea.KeyMsg) tea.Cmd {
	a := &m.auth

	if a.loading {
		return nil
	}

	if a.qr != nil {
		return m.updateQRLoginKey(msg)
	}

	if a.recover != nil {
		return m.updateRecoverLoginKey(msg)
	}

	switch msg.String() {
	case "ctrl+f":
		if !a.register {
			return m.startRecoverLogin()
		}

		return nil
	case "ctrl+l":
		if !a.register {
			return m.startQRLogin()
		}

		return nil
	case "tab":
		a.setMode(!a.register)
		return nil
	case "ctrl+r":
		a.remember = !a.remember
		return nil
	case "esc":
		if a.register {
			a.setMode(false)
			return nil
		}

		return tea.Quit
	case "up", "shift+tab":
		a.focusField(a.focus - 1)
		return nil
	case "down":
		a.focusField(a.focus + 1)
		return nil
	case "enter":
		// Enter in a field moves on; in the last one it submits.
		if a.focus < len(a.fields())-1 {
			a.focusField(a.focus + 1)
			return nil
		}

		return m.submitAuth()
	}

	var cmd tea.Cmd
	field := a.fields()[a.focus]
	a.inputs[field], cmd = a.inputs[field].Update(msg)
	a.err = ""

	return cmd
}

func (m *model) updateAuthMouse(msg tea.MouseMsg) tea.Cmd {
	a := &m.auth

	if a.loading {
		return nil
	}

	if a.qr != nil {
		return m.updateQRLoginMouse(msg)
	}

	if a.recover != nil {
		return m.updateRecoverLoginMouse(msg)
	}

	switch {
	case clicked(msg, "auth:qr"):
		return m.startQRLogin()
	case clicked(msg, "auth:recover"):
		return m.startRecoverLogin()
	case clicked(msg, "auth:login"):
		a.setMode(false)
	case clicked(msg, "auth:register"):
		a.setMode(true)
	case clicked(msg, "auth:submit"):
		return m.submitAuth()
	case clicked(msg, "auth:remember"):
		a.remember = !a.remember
	default:
		for i := range a.fields() {
			if clicked(msg, fmt.Sprintf("auth:field:%d", i)) {
				a.focusField(i)
			}
		}
	}

	return nil
}

func (m *model) submitAuth() tea.Cmd {
	a := &m.auth
	username := cleanUsername(a.inputs[fieldUsername].Value())
	password := a.inputs[fieldPassword].Value()
	ostrichID := strings.TrimSpace(a.inputs[fieldOstrichID].Value())

	switch {
	case username == "" || password == "":
		a.err = "Username and password are required"
		return nil
	case !a.register && ostrichID == "":
		a.err = "Enter your OstrichID"
		return nil
	}

	if a.register {
		switch {
		case !validUsername(username):
			a.err = errInvalidUsername.Error()
			return nil
		case len([]rune(password)) < minPasswordLength:
			a.err = fmt.Sprintf("The password needs at least %d characters", minPasswordLength)
			return nil
		case password != a.inputs[fieldConfirm].Value():
			a.err = "The passwords do not match"
			return nil
		}
	}

	a.loading = true
	a.err = ""
	a.notice = ""
	register := a.register
	remember := a.remember

	return task(func() func(*model) tea.Cmd {
		var result *LoginResponse
		var err error

		if register {
			result, err = registerWithCredentials(username, password)
		} else {
			result, err = loginWithCredentials(username, password, ostrichID)
		}

		return func(m *model) tea.Cmd {
			m.auth.loading = false

			if err != nil {
				m.auth.err = err.Error()
				return nil
			}

			cmd := m.startSession(result)

			switch {
			case !remember:
			case result.OstrichID != "":
				// A new account: remembered once its OstrichID is saved.
				m.rememberLater = true
			default:
				cmd = tea.Batch(cmd, m.rememberSession())
			}

			return cmd
		}
	})
}

// --- OstrichID screen ---

// How long a copied OstrichID stays in the clipboard.
const clipboardClearDelay = time.Minute

func (m *model) updateOstrichIDKey(msg tea.KeyMsg) tea.Cmd {
	m.quitArmed = false

	switch msg.String() {
	case " ", "y", "Y":
		m.idSaved = !m.idSaved
	case "c":
		return m.copyOstrichID()
	case "enter":
		if m.idSaved {
			return m.leaveOstrichID()
		}
	}

	return nil
}

// leaveOstrichID goes on to the chats once the OstrichID is saved.
func (m *model) leaveOstrichID() tea.Cmd {
	m.user.OstrichID = ""
	m.stage = stageMain
	var cmd tea.Cmd

	if m.recovery.recovered {
		cmd = m.showToast("You have a new OstrichID, so your guardians were reset: choose them again in Settings → Recovery through friends", false)
	}

	if m.rememberLater {
		m.rememberLater = false
		return tea.Batch(cmd, m.rememberSession())
	}

	return cmd
}

func (m *model) updateOstrichIDMouse(msg tea.MouseMsg) tea.Cmd {
	switch {
	case clicked(msg, "id:saved"):
		m.idSaved = !m.idSaved
	case clicked(msg, "id:copy"):
		return m.copyOstrichID()
	case clicked(msg, "id:continue") && m.idSaved:
		return m.leaveOstrichID()
	}

	return nil
}

func (m *model) copyOstrichID() tea.Cmd {
	id := m.user.OstrichID

	if err := copyText(id); err != nil {
		return m.showToast(err.Error(), true)
	}

	// Other programs can read the clipboard: take the ID out again once it
	// has had time to be pasted, unless something else was copied since.
	return tea.Batch(
		m.showToast("Copied. It leaves the clipboard in a minute.", false),
		tea.Tick(clipboardClearDelay, func(time.Time) tea.Msg {
			clearClipboardIf(id)
			return nil
		}),
	)
}

// --- views ---

func authCardWidth(screenWidth int) int {
	return min(56, max(screenWidth-4, 30))
}

// card draws lines (each w-4 cells wide at most) on a panel with
// padding.
func (m model) card(lines []string, w int) string {
	// A frame with a line of space inside, at the top and the bottom.
	return m.box("", append(append([]string{""}, lines...), ""), w)
}

// screen centers a block on the page background, with the hints at the
// bottom.
func (m model) screen(block, hints string) string {
	p := m.pal
	lines := strings.Split(block, "\n")
	blockW := 0

	for _, line := range lines {
		blockW = max(blockW, width(line))
	}

	area := m.height - 1
	top := max((area-len(lines))/2, 0)
	out := make([]string, 0, m.height)

	for i := 0; i < top; i++ {
		out = append(out, blank(m.width, p.bg))
	}

	left := max((m.width-blockW)/2, 0)

	for _, line := range lines {
		out = append(out, fitLine(blank(left, p.bg)+fitLine(line, blockW, p.bg), m.width, p.bg))
	}

	for len(out) < area {
		out = append(out, blank(m.width, p.bg))
	}

	out = append(out[:area], m.hintLine(hints, m.width, p.bg))

	return strings.Join(out, "\n")
}

// button draws a full-width button.
// button: a centered label, the main one in the accent; no fill.
func (m model) button(label string, w int, primary, enabled bool) string {
	p := m.pal
	fg := p.text

	switch {
	case !enabled:
		fg = p.muted
	case primary:
		fg = p.accent
		label = "[ " + label + " ]"
	}

	return center(bold(label, fg, p.bg), w, p.bg)
}

// inputBox draws an input with an accent bar when focused.
// inputBox: "> " and the field, the prompt in the accent when focused.
func (m model) inputBox(view string, focused bool, w int) string {
	p := m.pal
	fg := p.muted

	if focused {
		fg = p.accent
	}

	return bold("> ", fg, p.bg) + fitLine(onBackground(view, p.bg), w-2, p.bg)
}

// link: "Ctrl+L  Log in with a QR code", clickable.
func (m model) link(id, key, label string, w int, enabled bool) string {
	p := m.pal
	fg := p.text

	if !enabled {
		fg = p.muted
	}

	return zone.Mark(id, seg(key, p.accent, p.bg)+blank(max(8-width(key), 1), p.bg)+seg(clip(label, w-8), fg, p.bg))
}

// checkbox: "[x] label".
func (m model) checkbox(id string, on bool, label string) string {
	p := m.pal
	box := "[ ]"

	if on {
		box = "[x]"
	}

	return zone.Mark(id, seg(box+" ", p.accent, p.bg)+seg(label, p.text, p.bg))
}

func (m model) authView() string {
	if m.auth.qr != nil {
		return m.qrLoginView()
	}

	if m.auth.recover != nil {
		return m.recoverLoginView()
	}

	p := m.pal
	bg := p.bg
	a := m.auth
	w := authCardWidth(m.width)
	inner := w - 4

	tab := func(label string, selected bool, id string) string {
		if selected {
			return zone.Mark(id, bold(label, p.accent, bg))
		}

		return zone.Mark(id, seg(label, p.muted, bg))
	}

	lines := []string{
		seg(clip("Private, end-to-end encrypted messages.", inner), p.muted, bg),
		"",
		tab("Log in", !a.register, "auth:login") + seg("   ·   ", p.line, bg) + tab("Create account", a.register, "auth:register"),
		"",
	}

	labels := map[int]string{
		fieldUsername:  "Username",
		fieldPassword:  "Password",
		fieldConfirm:   "Repeat the password",
		fieldOstrichID: "OstrichID",
	}

	for i, field := range a.fields() {
		labelFg := p.muted

		if a.focus == i {
			labelFg = p.text
		}

		lines = append(lines,
			seg(labels[field], labelFg, bg),
			zone.Mark(fmt.Sprintf("auth:field:%d", i), m.inputBox(a.inputs[field].View(), a.focus == i, inner)),
			"",
		)
	}

	if a.register {
		for _, line := range wrap("You get an OstrichID: the key to your account and your messages. It is shown only once.", inner) {
			lines = append(lines, seg(line, p.muted, bg))
		}

		lines = append(lines, "")
	}

	switch {
	case a.err != "":
		for _, line := range wrap(sanitize(a.err), inner) {
			lines = append(lines, seg(line, p.danger, bg))
		}

		lines = append(lines, "")
	case a.notice != "":
		lines = append(lines, seg(clip(a.notice, inner), p.muted, bg), "")
	}

	label := "Log in"

	switch {
	case a.loading && a.register:
		label = "Creating the account…"
	case a.loading:
		label = "Logging in…"
	case a.register:
		label = "Create account"
	}

	lines = append(lines,
		m.checkbox("auth:remember", a.remember, "Remember me on this computer"),
		"",
		zone.Mark("auth:submit", m.button(label, inner, true, !a.loading)),
	)

	if !a.register {
		lines = append(lines,
			"",
			m.link("auth:qr", "Ctrl+L", "Log in with a QR code", inner, !a.loading),
			m.link("auth:recover", "Ctrl+F", "Lost your OstrichID? Recover with friends", inner, !a.loading),
		)
	}

	return m.screen(m.box("Ostrich", lines, w), "Tab log in / create account   ↑↓ field   Enter next / submit   Ctrl+R remember me   Esc quit")
}

func (m model) ostrichIDView() string {
	p := m.pal
	bg := p.bg
	w := authCardWidth(m.width)
	inner := w - 4
	id := m.user.OstrichID
	text := func(s string, fg string) []string {
		var out []string

		for _, line := range wrap(s, inner) {
			if fg == "danger" {
				out = append(out, bold(line, p.danger, bg))
			} else {
				out = append(out, seg(line, p.textSoft, bg))
			}
		}

		return out
	}

	lines := []string{"", center(bold(sanitize(id), p.accent, bg), inner, bg), ""}
	lines = append(lines, text("You need it to log in, together with your username and password.", "")...)
	lines = append(lines, "")
	lines = append(lines, text("It is shown only this once. Ostrich cannot show it again: if you lose it, only friends you choose as guardians (Settings → Recovery through friends) can give it back.", "danger")...)
	lines = append(lines, "")
	lines = append(lines, text("Save it somewhere safe, such as a password manager.", "")...)
	lines = append(lines,
		"",
		m.checkbox("id:saved", m.idSaved, "I have saved my OstrichID"),
		"",
		zone.Mark("id:continue", m.button("Continue", inner, true, m.idSaved)),
		"",
		m.link("id:copy", "c", "Copy it", inner, true),
	)

	hints := "c copy   Space saved   Enter continue"

	if m.quitArmed {
		hints = "Press Ctrl+C again to quit. You will not see this OstrichID again."
	}

	view := m.screen(m.box("Your OstrichID", lines, w), hints)

	if m.quitArmed {
		lines := strings.Split(view, "\n")
		lines[len(lines)-1] = fitLine(seg(" "+hints, p.danger, bg), m.width, bg)
		view = strings.Join(lines, "\n")
	}

	return view
}
