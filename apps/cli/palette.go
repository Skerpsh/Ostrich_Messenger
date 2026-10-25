package main

import (
	tea "github.com/charmbracelet/bubbletea"
)

// The command palette (Ctrl+P): everything that can be done here, in one
// list filtered by typing. The chosen message's actions first, then the
// open chat's, then the rest; each with the key that does it directly.

func (m *model) openPalette() tea.Cmd {
	var items []menuItem

	// Each part under its heading.
	add := func(section string, more ...menuItem) {
		for _, item := range more {
			item.section = section
			items = append(items, item)
		}
	}

	if c := m.chat; c != nil && m.focus == paneChat {
		chat, _ := m.chatByID(c.id)

		if c.selecting {
			if i := c.indexOf(c.selectedID); i >= 0 {
				add("This message", m.messageMenu(chat, c.messages[i]).items...)
			}
		}

		add("This chat", m.chatMenu(chat, true).items...)

		if !chat.Blocked {
			add("This chat",
				menuItem{label: "Attach a file", key: "Ctrl+A", action: func(m *model) tea.Cmd {
					return m.updateChatKey(tea.KeyMsg{Type: tea.KeyCtrlA})
				}},
				menuItem{label: "Choose a message", key: "↑", action: func(m *model) tea.Cmd {
					return m.updateChatKey(tea.KeyMsg{Type: tea.KeyUp})
				}},
			)
		}
	}

	if m.focus == paneList && m.settings == nil {
		rows := m.listRows()

		if l := m.list; l.cursor < len(rows) && rows[l.cursor].chat != nil {
			add("This chat", m.chatMenu(*rows[l.cursor].chat, false).items...)
		}
	}

	colors := "Use the terminal's colors"

	if m.cfg.Colors != "ostrich" {
		colors = "Use Ostrich's colors"
	}

	add("Ostrich",
		menuItem{label: "New chat", key: "n", action: func(m *model) tea.Cmd { return m.toList(m.startSearch("@")) }},
		menuItem{label: "New group", key: "N", action: (*model).newGroup},
		menuItem{label: "Saved messages", key: "v", action: (*model).openSaved},
		menuItem{label: "Search chats and messages", key: "/", action: func(m *model) tea.Cmd { return m.toList(m.startSearch("")) }},
		menuItem{label: "Settings", key: "s", action: (*model).openSettings},
		menuItem{label: "Change username", action: func(m *model) tea.Cmd { return m.openSettingsForm("username") }},
		menuItem{label: "Change password", action: func(m *model) tea.Cmd { return m.openSettingsForm("password") }},
		menuItem{label: "Devices", action: func(m *model) tea.Cmd { return m.openSettingsAt("Devices") }},
		menuItem{label: "Recovery through friends", action: func(m *model) tea.Cmd { return m.openSettingsAt("Recovery through friends") }},
		menuItem{label: colors, action: func(m *model) tea.Cmd {
			m.cfg.Colors = map[bool]string{true: "ostrich", false: "terminal"}[m.cfg.Colors != "ostrich"]
			m.cfg.save()
			m.applyTheme()

			return nil
		}},
		menuItem{label: "Light or dark theme", key: "t", action: func(m *model) tea.Cmd { return m.toggleTheme() }},
		menuItem{label: "Keys", key: "F1", action: func(m *model) tea.Cmd {
			m.helpOpen = true
			return nil
		}},
		menuItem{label: "Log out", danger: true, confirm: "Log out of this computer?", action: func(m *model) tea.Cmd {
			token := m.user.Token

			return tea.Batch(m.signOut(""), func() tea.Msg {
				_ = logout(token)
				return nil
			})
		}},
		menuItem{label: "Quit", key: "Ctrl+C", action: (*model).quit},
	)

	m.openMenu(&menuState{title: "Commands", items: items, confirming: -1})

	return nil
}

// toList puts the focus on the chats list (for its search).
func (m *model) toList(cmd tea.Cmd) tea.Cmd {
	m.settings = nil
	m.focus = paneList

	if m.chat != nil {
		m.chat.composer.Blur()
	}

	return cmd
}

// openSettingsForm opens Settings with a form open.
func (m *model) openSettingsForm(form string) tea.Cmd {
	cmd := m.openSettings()
	rows := m.settingsRows()

	for i, part := range m.settingsParts() {
		for j := part.start; j < part.end; j++ {
			if rows[j].form == form {
				m.settings.part, m.settings.cursor, m.settings.inContent = i, j, true
			}
		}
	}

	return tea.Batch(cmd, m.openForm(form))
}

// openSettingsAt opens Settings on a section's first row.
func (m *model) openSettingsAt(section string) tea.Cmd {
	cmd := m.openSettings()

	for i, part := range m.settingsParts() {
		if part.title == section {
			m.choosePart(i)
			m.settings.inContent = true
		}
	}

	m.scrollSettings()

	return cmd
}
