package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	zone "github.com/lrstanley/bubblezone"
)

// Settings: its parts on the left (Profile, Appearance, Account...), the
// chosen part's rows on the right (in a narrow pane, the parts and then
// the part). Forms open in a window over it.

type settingsState struct {
	// The selected row (index into settingsRows) and the first line shown.
	cursor, scroll int
	// The chosen part (index into settingsParts) and whether the keys move
	// in it (else in the list of parts).
	part      int
	inContent bool

	// The open form ("username", "password", "delete", recovery's) and its
	// inputs.
	form      string
	inputs    []textinput.Model
	formFocus int
	formErr   string
	formOK    string
	busy      bool
	// Deleting the account takes a second Enter.
	confirmDelete bool

	sessions       []Session
	sessionsLoaded bool
	sessionsErr    string

	// A row waiting for its second Enter (log out a device / everywhere).
	confirming string
}

func (s *settingsState) restyle(p palette) {
	for i := range s.inputs {
		styleInput(&s.inputs[i], p)
	}
}

// The forms' inputs fit their window (settingsFormView).
func (s *settingsState) resize(w int) {
	for i := range s.inputs {
		s.inputs[i].Width = max(min(60, w)-8, 10)
	}
}

func (m *model) openSettings() tea.Cmd {
	m.settings = &settingsState{}
	m.menu = nil
	m.safetyOpen = false
	m.focus = paneSettings

	if m.chat != nil {
		m.chat.composer.Blur()
	}

	if m.list.searching {
		m.stopSearch()
	}

	m.selectFirstSettingsRow()

	return tea.Batch(m.loadSessions(), m.loadRecovery())
}

func (m *model) closeSettings() tea.Cmd {
	m.settings = nil

	if m.chat != nil {
		m.focus = paneChat
		return m.chat.composer.Focus()
	}

	m.focus = paneList

	return nil
}

func (m *model) loadSessions() tea.Cmd {
	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		sessions, err := getSessions(token)

		return func(m *model) tea.Cmd {
			if m.settings == nil {
				return nil
			}

			if err != nil {
				m.settings.sessionsErr = err.Error()
				return m.failSilently(err)
			}

			m.settings.sessions = sessions
			m.settings.sessionsLoaded = true
			m.settings.sessionsErr = ""

			return nil
		}
	})
}

// failSilently logs out on an expired session; other errors are shown
// where they happened.
func (m *model) failSilently(err error) tea.Cmd {
	if err == errSessionExpired {
		return m.signOut(err.Error())
	}

	return nil
}

// --- rows ---

const (
	rowSection = iota
	rowProfile
	rowAction
	rowToggle
	rowThemes
	rowAccents
)

type settingsRow struct {
	kind   int
	id     string
	icon   string
	label  string
	value  string
	hint   string
	danger bool
	on     bool
	// The form shown under the row while open.
	form   string
	action func(*model) tea.Cmd
}

func (r settingsRow) selectable() bool {
	return r.kind != rowSection && r.kind != rowProfile
}

var clientNames = map[string]string{
	"web":     "Web browser",
	"ios":     "iPhone / iPad",
	"android": "Android",
	"macos":   "Mac",
	"windows": "Windows",
	"cli":     "Terminal (CLI)",
}

func (m model) settingsRows() []settingsRow {
	s := m.settings
	u := m.user.User
	section := func(title string) settingsRow { return settingsRow{kind: rowSection, label: title} }

	rows := []settingsRow{
		{kind: rowProfile},
		{kind: rowAction, id: "copy", icon: "⧉", label: "Copy username", action: func(m *model) tea.Cmd {
			if err := copyText("@" + m.user.User.Username); err != nil {
				return m.showToast(err.Error(), true)
			}

			return m.showToast("Copied @"+m.user.User.Username, false)
		}},
		{kind: rowAction, id: "link", icon: "⧉", label: "Copy profile link", hint: "Opened, it starts a chat with you", action: func(m *model) tea.Cmd {
			link := profileLink(m.user.User.Username)

			if err := copyText(link); err != nil {
				return m.showToast(err.Error(), true)
			}

			return m.showToast("Copied "+link, false)
		}},
	}

	rows = append(rows,
		section("Appearance"),
		settingsRow{kind: rowToggle, id: "colors", icon: "◐", label: "Use the terminal's colors", on: m.cfg.Colors != "ostrich",
			hint: "Its background and palette, so Ostrich fits its theme. Off: Ostrich's own light or dark theme.",
			action: func(m *model) tea.Cmd {
				m.cfg.Colors = map[bool]string{true: "ostrich", false: "terminal"}[m.cfg.Colors != "ostrich"]
				m.cfg.save()
				m.applyTheme()
				return nil
			}},
	)

	if m.cfg.Colors == "ostrich" {
		rows = append(rows, settingsRow{kind: rowThemes, id: "theme", icon: "◐", label: "Theme"})
	}

	rows = append(rows,
		settingsRow{kind: rowAccents, id: "accent", icon: "●", label: "Accent color", value: accentName(m.cfg.Accent)},
		settingsRow{kind: rowToggle, id: "synclook", icon: "↻", label: "Sync the theme with my devices", on: m.cfg.SyncLook,
			hint: "The light or dark theme and the accent, the same as the apps' with Sync on (encrypted with your account's key).",
			action: func(m *model) tea.Cmd {
				m.cfg.SyncLook = !m.cfg.SyncLook
				m.cfg.save()

				if m.cfg.SyncLook {
					return m.loadSyncedLook()
				}

				return nil
			}},

		section("Account"),
		settingsRow{kind: rowAction, id: "username", icon: "@", label: "Username", value: "@" + sanitize(u.Username), form: "username"},
		settingsRow{kind: rowAction, id: "password", icon: "⚿", label: "Password", form: "password"},

		section("Privacy"),
		settingsRow{kind: rowToggle, id: "presence", icon: "◉", label: "Show when I'm online", on: u.ShowPresence,
			hint: "Off: nobody sees your online status or when you were last seen.",
			action: func(m *model) tea.Cmd {
				value := !m.user.User.ShowPresence
				return m.setPrivacy(&value, nil)
			}},
		settingsRow{kind: rowToggle, id: "receipts", icon: "✓", label: "Read receipts", on: u.ReadReceipts,
			hint: "Off: others don't see when you've read their messages, and you don't see theirs.",
			action: func(m *model) tea.Cmd {
				value := !m.user.User.ReadReceipts
				return m.setPrivacy(nil, &value)
			}},

		section("Notifications"),
		settingsRow{kind: rowToggle, id: "bell", icon: "♪", label: "Bell for new messages", on: m.cfg.Bell,
			hint: "The terminal bell rings for messages in other chats. Muted chats stay quiet.",
			action: func(m *model) tea.Cmd {
				m.cfg.Bell = !m.cfg.Bell
				m.cfg.save()
				return nil
			}},

		section("Devices"),
	)

	switch {
	case s.sessionsErr != "":
		rows = append(rows, settingsRow{kind: rowAction, id: "sessions-retry", icon: "↻", label: "Couldn't load the devices: retry", danger: true,
			action: (*model).loadSessions})
	case !s.sessionsLoaded:
		rows = append(rows, settingsRow{kind: rowAction, id: "sessions-loading", icon: "…", label: "Loading devices…"})
	}

	for _, session := range s.sessions {
		session := session
		name := "Unknown app"

		if session.Client != nil {
			if known, ok := clientNames[*session.Client]; ok {
				name = known
			}
		}

		value := "Active " + formatChatDate(session.LastUsedAt) + " · since " + formatDate(session.CreatedAt)
		row := settingsRow{kind: rowAction, id: "session:" + session.ID, icon: "▭", label: name, value: value}

		if session.Current {
			row.value = "This device"
		} else {
			row.action = func(m *model) tea.Cmd { return m.endSession(session) }
			row.hint = "Enter logs this device out"
		}

		rows = append(rows, row)
	}

	rows = append(rows, m.recoveryRows()...)

	rows = append(rows,
		section("Security"),
		settingsRow{kind: rowAction, id: "logoutall", icon: "⏻", label: "Log out of all devices", danger: true,
			hint:   "If you think someone else has access to your account. You will need your username, password and OstrichID to log in again.",
			action: (*model).logoutEverywhere},
		settingsRow{kind: rowAction, id: "logout", icon: "⇥", label: "Log out", action: func(m *model) tea.Cmd {
			token := m.user.Token

			return tea.Batch(m.signOut(""), func() tea.Msg {
				_ = logout(token)
				return nil
			})
		}},

		section("Danger zone"),
		settingsRow{kind: rowAction, id: "delete", icon: "🗑", label: "Delete account", danger: true, form: "delete"},
	)

	return rows
}

// settingsPart: a part of Settings, the rows from start to end (an
// index range of settingsRows).
type settingsPart struct {
	title      string
	start, end int
}

// settingsParts: the rows before the first heading are the profile.
func (m model) settingsParts() []settingsPart {
	rows := m.settingsRows()
	parts := []settingsPart{{title: "Profile"}}

	for i, r := range rows {
		if r.kind == rowSection {
			parts[len(parts)-1].end = i
			parts = append(parts, settingsPart{title: r.label, start: i + 1})
		}
	}

	parts[len(parts)-1].end = len(rows)

	return parts
}

// currentPart is the part with the cursor's row in it (rows come and go,
// e.g. the devices as they load).
func (m model) currentPart() settingsPart {
	parts := m.settingsParts()

	return parts[min(max(m.settings.part, 0), len(parts)-1)]
}

func (m *model) selectFirstSettingsRow() {
	part := m.currentPart()
	rows := m.settingsRows()

	for i := part.start; i < part.end; i++ {
		if rows[i].selectable() {
			m.settings.cursor = i
			return
		}
	}

	m.settings.cursor = part.start
}

// moveSettingsCursor moves within the part.
func (m *model) moveSettingsCursor(delta int) {
	rows := m.settingsRows()
	part := m.currentPart()
	s := m.settings

	for i := s.cursor + delta; i >= part.start && i < part.end; i += delta {
		if rows[i].selectable() {
			s.cursor = i
			s.confirming = ""
			return
		}
	}
}

// choosePart moves to another part (in the list of parts).
func (m *model) choosePart(part int) {
	s := m.settings
	s.part = min(max(part, 0), len(m.settingsParts())-1)
	s.scroll = 0
	s.confirming = ""
	m.selectFirstSettingsRow()
}

// --- forms ---

func (m *model) openForm(form string) tea.Cmd {
	s := m.settings
	p := m.pal

	if s.form == form {
		s.form = ""
		return nil
	}

	s.form = form
	s.formErr = ""
	s.formOK = ""
	s.formFocus = 0
	s.confirmDelete = false

	switch form {
	case "username":
		s.inputs = []textinput.Model{
			newInput("@new_username", 33, false, p),
			newInput("Password", 128, true, p),
		}
	case "password":
		s.inputs = []textinput.Model{
			newInput("Current password", 128, true, p),
			newInput("New password", 128, true, p),
			newInput("Repeat the new password", 128, true, p),
		}
	case "delete":
		s.inputs = []textinput.Model{
			newInput("Password", 128, true, p),
			newInput("OstrichID", 40, true, p),
		}
	default:
		s.inputs = m.openRecoveryForm(form)
	}

	s.resize(m.paneWidth())

	return s.inputs[0].Focus()
}

func (m *model) focusFormField(i int) tea.Cmd {
	s := m.settings
	s.formFocus = (i%len(s.inputs) + len(s.inputs)) % len(s.inputs)

	for j := range s.inputs {
		s.inputs[j].Blur()
	}

	return s.inputs[s.formFocus].Focus()
}

func (m *model) updateFormKey(msg tea.KeyMsg) tea.Cmd {
	s := m.settings

	switch msg.String() {
	case "esc":
		s.form = ""
		return nil
	case "tab", "down":
		return m.focusFormField(s.formFocus + 1)
	case "shift+tab", "up":
		return m.focusFormField(s.formFocus - 1)
	case "enter":
		if s.formFocus < len(s.inputs)-1 {
			return m.focusFormField(s.formFocus + 1)
		}

		return m.submitForm()
	}

	var cmd tea.Cmd
	s.inputs[s.formFocus], cmd = s.inputs[s.formFocus].Update(msg)
	s.formErr = ""

	return cmd
}

func (m *model) submitForm() tea.Cmd {
	s := m.settings

	if s.busy {
		return nil
	}

	value := func(i int) string { return s.inputs[i].Value() }
	token := m.user.Token
	s.formErr = ""
	s.formOK = ""

	// run does the request; done applies its result.
	run := func(work func() error, done func(m *model) tea.Cmd) tea.Cmd {
		s.busy = true

		return task(func() func(*model) tea.Cmd {
			err := work()

			return func(m *model) tea.Cmd {
				if m.settings == nil {
					return nil
				}

				m.settings.busy = false

				if err != nil {
					m.settings.formErr = err.Error()
					m.settings.confirmDelete = false

					return m.failSilently(err)
				}

				return done(m)
			}
		})
	}

	if cmd, ok := m.submitRecoveryForm(run); ok {
		return cmd
	}

	switch s.form {
	case "username":
		name := cleanUsername(value(0))
		password := value(1)

		switch {
		case !validUsername(name):
			s.formErr = errInvalidUsername.Error()
			return nil
		case password == "":
			s.formErr = "Password is required"
			return nil
		}

		var account *Account

		return run(func() (err error) {
			account, err = changeUsername(token, name, password)
			return err
		}, func(m *model) tea.Cmd {
			m.user.User = *account
			m.settings.form = ""

			return tea.Batch(m.showToast("Username changed. Use the new one to log in.", false), func() tea.Msg {
				updateSavedUser(*account)
				return nil
			})
		})

	case "password":
		current, next, repeat := value(0), value(1), value(2)

		switch {
		case current == "":
			s.formErr = "Current password is required"
			return nil
		case len([]rune(next)) < minPasswordLength:
			s.formErr = fmt.Sprintf("The new password needs at least %d characters", minPasswordLength)
			return nil
		case next != repeat:
			s.formErr = "The new passwords do not match"
			return nil
		}

		return run(func() error {
			return changePassword(token, current, next)
		}, func(m *model) tea.Cmd {
			m.settings.form = ""

			return m.showToast("Password changed. Other devices have been logged out.", false)
		})

	case "delete":
		password, id := value(0), value(1)

		switch {
		case password == "" || normalizeOstrichID(id) == "":
			s.formErr = "Enter your password and OstrichID"
			return nil
		case !s.confirmDelete:
			s.confirmDelete = true
			return nil
		}

		return run(func() error {
			return deleteAccount(token, password, id)
		}, func(m *model) tea.Cmd {
			return m.signOut("Your account has been deleted")
		})
	}

	return nil
}

// --- actions ---

func (m *model) setPrivacy(showPresence, readReceipts *bool) tea.Cmd {
	token := m.user.Token
	previous := m.user.User

	// Shown right away; undone if it fails.
	if showPresence != nil {
		m.user.User.ShowPresence = *showPresence
	}

	if readReceipts != nil {
		m.user.User.ReadReceipts = *readReceipts
	}

	return task(func() func(*model) tea.Cmd {
		account, err := setPrivacy(token, showPresence, readReceipts)

		return func(m *model) tea.Cmd {
			if m.user == nil || m.user.Token != token {
				return nil
			}

			if err != nil {
				m.user.User = previous
				return m.fail(err)
			}

			m.user.User = *account

			return nil
		}
	})
}

func (m *model) endSession(session Session) tea.Cmd {
	s := m.settings
	id := "session:" + session.ID

	if s.confirming != id {
		s.confirming = id
		return nil
	}

	s.confirming = ""
	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		err := endSession(token, session.ID)

		return func(m *model) tea.Cmd {
			if err != nil {
				return m.fail(err)
			}

			if m.settings == nil {
				return nil
			}

			return tea.Batch(m.showToast("The device has been logged out", false), m.loadSessions())
		}
	})
}

func (m *model) logoutEverywhere() tea.Cmd {
	s := m.settings

	if s.confirming != "logoutall" {
		s.confirming = "logoutall"
		return nil
	}

	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		err := logoutAll(token)

		return func(m *model) tea.Cmd {
			if err != nil {
				return m.fail(err)
			}

			return m.signOut("Logged out of all devices")
		}
	})
}

// lookChanged saves and shows a new theme or accent, and syncs it when
// that is on (synclook.go).
func (m *model) lookChanged() tea.Cmd {
	m.cfg.save()
	m.applyTheme()

	return m.saveSyncedLook()
}

func (m *model) setThemePreference(theme string) tea.Cmd {
	m.cfg.Theme = theme

	return m.lookChanged()
}

func (m *model) shiftAccent(delta int) tea.Cmd {
	i := 0

	for j, a := range accents {
		if a.id == m.cfg.Accent {
			i = j
		}
	}

	i = (i + delta + len(accents)) % len(accents)
	m.cfg.Accent = accents[i].id

	return m.lookChanged()
}

var themeOptions = []struct{ id, label string }{
	{"system", "System"},
	{"light", "Light"},
	{"dark", "Dark"},
}

func (m *model) shiftTheme(delta int) tea.Cmd {
	i := 0

	for j, option := range themeOptions {
		if option.id == m.cfg.Theme {
			i = j
		}
	}

	i = min(max(i+delta, 0), len(themeOptions)-1)

	return m.setThemePreference(themeOptions[i].id)
}

// activateSettingsRow runs the selected row.
func (m *model) activateSettingsRow() tea.Cmd {
	rows := m.settingsRows()
	s := m.settings

	if s.cursor >= len(rows) {
		return nil
	}

	r := rows[s.cursor]

	switch {
	case r.form != "":
		return m.openForm(r.form)
	case r.kind == rowThemes:
		return m.shiftTheme(1)
	case r.kind == rowAccents:
		return m.shiftAccent(1)
	case r.action != nil:
		return r.action(m)
	}

	return nil
}

func (m *model) updateSettingsKey(msg tea.KeyMsg) tea.Cmd {
	s := m.settings

	if s.form != "" && len(s.inputs) > 0 {
		return m.updateFormKey(msg)
	}

	rows := m.settingsRows()
	defer m.scrollSettings()

	value := s.inContent && s.cursor < len(rows) && (rows[s.cursor].kind == rowThemes || rows[s.cursor].kind == rowAccents)
	shift := func(delta int) tea.Cmd {
		if rows[s.cursor].kind == rowThemes {
			return m.shiftTheme(delta)
		}

		return m.shiftAccent(delta)
	}

	switch msg.String() {
	case "esc", "q":
		// Out of the part first, then out of Settings.
		if s.inContent {
			s.inContent = false
			s.confirming = ""

			return nil
		}

		return m.closeSettings()
	case "up", "k":
		if s.inContent {
			m.moveSettingsCursor(-1)
		} else {
			m.choosePart(s.part - 1)
		}
	case "down", "j":
		if s.inContent {
			m.moveSettingsCursor(1)
		} else {
			m.choosePart(s.part + 1)
		}
	case "left", "h":
		switch {
		case value:
			return shift(-1)
		case s.inContent:
			s.inContent = false
		}
	case "right", "l":
		switch {
		case value:
			return shift(1)
		case !s.inContent:
			s.inContent = true
			m.selectFirstSettingsRow()
		}
	case "enter", " ":
		if !s.inContent {
			s.inContent = true
			m.selectFirstSettingsRow()

			return nil
		}

		return m.activateSettingsRow()
	case "tab":
		if m.wide() {
			m.focus = paneList
		}
	}

	return nil
}

func (m *model) updateSettingsMouse(msg tea.MouseMsg) tea.Cmd {
	s := m.settings

	if s.form != "" {
		for i := range s.inputs {
			if clicked(msg, fmt.Sprintf("set:field:%d", i)) {
				m.focus = paneSettings
				return m.focusFormField(i)
			}
		}

		if clicked(msg, "set:submit") {
			return m.submitForm()
		}

		// A click outside the form closes it.
		if msg.Action == tea.MouseActionPress && !zone.Get("set:form").InBounds(msg) {
			s.form = ""
		}

		return nil
	}

	if d := wheel(msg, "set:body"); d != 0 {
		s.scroll = max(s.scroll+d*wheelLines, 0)
		return nil
	}

	if clicked(msg, "set:close") {
		return m.closeSettings()
	}

	for i := range m.settingsParts() {
		if clicked(msg, fmt.Sprintf("set:part:%d", i)) {
			m.focus = paneSettings
			m.choosePart(i)
			s.inContent = true

			return nil
		}
	}

	for _, option := range themeOptions {
		if clicked(msg, "set:theme:"+option.id) {
			m.focus = paneSettings

			return m.setThemePreference(option.id)
		}
	}

	for i, a := range accents {
		if clicked(msg, fmt.Sprintf("set:accent:%d", i)) {
			m.focus = paneSettings
			m.cfg.Accent = a.id

			return m.lookChanged()
		}
	}

	for i, r := range m.settingsRows() {
		if r.selectable() && clicked(msg, fmt.Sprintf("set:row:%d", i)) {
			m.focus = paneSettings

			if s.cursor != i {
				s.confirming = ""
			}

			s.cursor = i
			s.inContent = true

			return m.activateSettingsRow()
		}
	}

	return nil
}

// --- view ---

// settingsPartsWidth: the parts' column, none in a narrow pane (the parts,
// then the part, one at a time).
func settingsPartsWidth(w int) int {
	if w < 70 {
		return 0
	}

	return 27
}

// settingsContentWidth is the width of the part's rows.
func settingsContentWidth(paneWidth int) int {
	if parts := settingsPartsWidth(paneWidth); parts > 0 {
		return paneWidth - parts - 1
	}

	return paneWidth
}

// settingsBody draws the chosen part's rows in w cells; rowAt[i] is the
// first line of row i (of settingsRows; -1 for rows of other parts).
func (m model) settingsBody(w int) (lines []string, rowAt []int) {
	s := m.settings
	p := m.pal
	bg := p.bg
	cw := min(w-4, 76)
	rows := m.settingsRows()
	part := m.currentPart()
	rowAt = make([]int, len(rows))

	for i := range rowAt {
		rowAt[i] = -1
	}

	put := func(line string) {
		lines = append(lines, blank(2, bg)+fitLine(line, cw, bg)+blank(max(w-2-cw, 0), bg))
	}

	put("")
	u := m.user.User

	for i := part.start; i < part.end; i++ {
		r := rows[i]
		rowAt[i] = len(lines)
		selected := i == s.cursor && s.inContent && m.focus == paneSettings

		switch r.kind {
		case rowSection:
			continue
		case rowProfile:
			put(bold("@"+sanitize(u.Username), p.text, bg))
			put(seg(clip("Friends start chats with you by your @username.", cw), p.muted, bg))
			put("")

			continue
		}

		fg := p.text

		if r.danger {
			fg = p.danger
		}

		bar := blank(1, bg)
		label := r.label

		if selected {
			bar = seg("▌", p.accent, bg)
		}

		if s.confirming == r.id {
			switch {
			case r.id == "logoutall":
				label = "Press Enter again to log out on all devices"
			case strings.HasPrefix(r.id, "session:"):
				label = "Press Enter again to log this device out"
			case r.id == "recovery-remove":
				label = "Press Enter again to remove all guardians"
			}
		}

		labelText := seg(label, fg, bg)

		if selected {
			labelText = bold(label, fg, bg)
		}

		var right string

		switch r.kind {
		case rowToggle:
			right = seg("off", p.muted, bg)

			if r.on {
				right = bold("on", p.accent, bg)
			}
		case rowThemes:
			var options []string

			for _, option := range themeOptions {
				text := seg(option.label, p.muted, bg)

				if m.cfg.Theme == option.id {
					text = bold(option.label, p.accent, bg)
				}

				options = append(options, zone.Mark("set:theme:"+option.id, text))
			}

			right = strings.Join(options, blank(2, bg))
		case rowAccents:
			var swatches []string

			for j, a := range accents {
				variant := a.dark

				if p.mode == themeLight {
					variant = a.light
				}

				color := lipgloss.Color(variant.accent)

				if p.terminal {
					color = lipgloss.Color(ansiAccents[a.id])
				}

				mark := " ● "

				if a.id == m.cfg.Accent {
					mark = "[●]"
				}

				swatches = append(swatches, zone.Mark(fmt.Sprintf("set:accent:%d", j), seg(mark, color, bg)))
			}

			right = strings.Join(swatches, "")
		default:
			if r.value != "" {
				right = seg(clip(r.value, cw/2), p.muted, bg)
			}

			if r.form != "" {
				right += seg(" ›", p.muted, bg)
			}
		}

		block := []string{blank(2, bg) + row(bar+blank(1, bg)+labelText, right, cw, bg) + blank(max(w-2-cw, 0), bg)}

		if r.hint != "" && selected {
			for _, hint := range wrap(r.hint, cw-4) {
				block = append(block, blank(2, bg)+fitLine(blank(2, bg)+seg(hint, p.muted, bg), cw, bg)+blank(max(w-2-cw, 0), bg))
			}
		}

		lines = append(lines, zone.Mark(fmt.Sprintf("set:row:%d", i), strings.Join(block, "\n")))
	}

	put("")

	return lines, rowAt
}

// toggleView draws a switch: "━●" on, "●━" off.
func toggleView(on bool, p palette, bg lipgloss.Color) string {
	if on {
		return seg("━━", p.accent, bg) + seg("●", p.accent, bg) + blank(1, bg)
	}

	return seg("●", p.muted, bg) + seg("━━", p.panelAlt, bg) + blank(1, bg)
}

// settingsFormView: the open form, in a window over Settings.
func (m model) settingsFormView() string {
	s := m.settings
	p := m.pal
	bg := p.bg
	w := min(60, m.width-4)
	inner := w - 4
	var lines []string

	title := "Settings"

	for _, r := range m.settingsRows() {
		if r.form == s.form {
			title = r.label
		}
	}

	intro := map[string]string{
		"username": "You log in with your username, and others find you by it. It can be changed once every 28 days.",
		"password": "Your other devices will be logged out.",
		"delete":   "Deletes your account, all your chats (for the people you talk to as well) and your messages. This cannot be undone.",
	}

	if s.form == "username" && m.user.User.NextUsernameChangeAt != nil {
		for _, line := range wrap("You can change it again on "+formatDate(*m.user.User.NextUsernameChangeAt)+".", inner) {
			lines = append(lines, seg(line, p.muted, bg))
		}

		return zone.Mark("set:form", m.box(clip(title, w-6), append(lines, "", seg("Esc close", p.muted, bg)), w))
	}

	text := intro[s.form]
	recoveryIntro, recoveryLabel, isRecovery := m.recoveryFormText(s.form)

	if isRecovery {
		text = recoveryIntro
	}

	lines = append(lines, "")

	for _, line := range wrap(text, inner) {
		lines = append(lines, seg(line, p.textSoft, bg))
	}

	lines = append(lines, "")

	for i := range s.inputs {
		lines = append(lines, zone.Mark(fmt.Sprintf("set:field:%d", i), m.inputBox(s.inputs[i].View(), s.formFocus == i, inner)))
	}

	if s.formErr != "" {
		lines = append(lines, "")

		for _, line := range wrap(sanitize(s.formErr), inner) {
			lines = append(lines, seg(line, p.danger, bg))
		}
	}

	label := map[string]string{
		"username": "Change username",
		"password": "Change password",
		"delete":   "Delete account",
	}[s.form]

	if isRecovery {
		label = recoveryLabel
	}

	if s.form == "delete" && s.confirmDelete {
		label = "Delete forever? Press Enter again"
	}

	if s.busy {
		label = "…"
	}

	button := m.button(label, inner, true, true)

	if s.form == "delete" {
		button = center(bold("[ "+label+" ]", p.danger, bg), inner, bg)
	}

	lines = append(lines, "", zone.Mark("set:submit", button))

	return zone.Mark("set:form", m.box(clip(title, w-6), lines, w))
}

// scrollSettings keeps the selected row on screen.
func (m *model) scrollSettings() {
	s := m.settings

	if s == nil {
		return
	}

	lines, rowAt := m.settingsBody(settingsContentWidth(m.paneWidth()))
	area := m.innerHeight() - 2

	if s.cursor >= len(rowAt) || rowAt[s.cursor] < 0 {
		return
	}

	top := rowAt[s.cursor]
	bottom := len(lines)

	for i := s.cursor + 1; i < len(rowAt); i++ {
		if rowAt[i] >= 0 {
			bottom = rowAt[i]
			break
		}
	}

	if bottom-s.scroll > area {
		s.scroll = bottom - area
	}

	if top < s.scroll {
		s.scroll = top
	}

	s.scroll = min(max(s.scroll, 0), max(len(lines)-area, 0))
}

func (m model) settingsView(w, h int) string {
	s := m.settings
	p := m.pal
	bg := p.bg
	parts := m.settingsParts()
	partsW := settingsPartsWidth(w)
	part := m.currentPart()

	title := bold(" Settings", p.text, bg)

	if partsW == 0 && s.inContent {
		title = zone.Mark("set:close", seg(" ‹ ", p.accent, bg)) + bold(part.title, p.text, bg)
	} else if partsW > 0 {
		title += seg("  ›  "+part.title, p.muted, bg)
	}

	header := []string{
		row(title, zone.Mark("set:close", seg("Esc close ", p.muted, bg)), w, bg),
		seg(strings.Repeat("─", w), p.line, bg),
	}

	area := h - 2

	partLines := func(pw int) []string {
		out := []string{blank(pw, bg)}

		for i, pt := range parts {
			bar := blank(1, bg)
			text := seg(clip(pt.title, pw-3), p.textSoft, bg)

			if i == s.part {
				fg := p.muted

				if !s.inContent && m.focus == paneSettings {
					fg = p.accent
				}

				bar = seg("▌", fg, bg)
				text = bold(clip(pt.title, pw-3), p.text, bg)
			}

			out = append(out, zone.Mark(fmt.Sprintf("set:part:%d", i), fitLine(bar+blank(1, bg)+text, pw, bg)))
		}

		return out
	}

	content := func(cw int) string {
		lines, _ := m.settingsBody(cw)
		scroll := min(s.scroll, max(len(lines)-area, 0))
		end := min(scroll+area, len(lines))

		return zone.Mark("set:body", fitBlock(strings.Join(lines[scroll:end], "\n"), cw, area, bg))
	}

	var body string

	switch {
	case partsW > 0:
		left := strings.Split(fitBlock(strings.Join(partLines(partsW), "\n"), partsW, area, bg), "\n")
		right := strings.Split(content(w-partsW-1), "\n")
		var out []string

		for i := 0; i < area; i++ {
			out = append(out, left[i]+seg("│", p.line, bg)+right[i])
		}

		body = strings.Join(out, "\n")
	case s.inContent:
		body = content(w)
	default:
		body = fitBlock(strings.Join(partLines(w), "\n"), w, area, bg)
	}

	return strings.Join(append(header, body), "\n")
}
