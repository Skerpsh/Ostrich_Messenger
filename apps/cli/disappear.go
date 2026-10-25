package main

import (
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// "If I disappear" (set up in the app, Settings → If I disappear):
// messages sent for the user when they have not opened Ostrich for the
// days they chose. Using the CLI tells the server the user is here, like
// opening the app; the CLI also shows the messages it sent.

// At most this often, while keys are pressed or the mouse is used.
const aliveEvery = 10 * time.Minute

var disappearWarned = [...]string{"", "a week", "a day", "an hour"}

type disappearAliveResult struct {
	Switch *struct {
		TriggeredAt *string `json:"triggered_at"`
	} `json:"switch"`
	WasWarned int `json:"was_warned"`
}

// stillHere tells the server the user is here (see aliveEvery).
func (m *model) stillHere() tea.Cmd {
	if m.user == nil || m.stage != stageMain || time.Since(m.aliveAt) < aliveEvery {
		return nil
	}

	m.aliveAt = time.Now()
	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		var result disappearAliveResult
		err := authorizedPost(token, "/api/disappear/alive", map[string]any{}, &result)

		return func(m *model) tea.Cmd {
			switch {
			case err != nil:
				// Tried again with the next key.
				m.aliveAt = time.Time{}
			case result.Switch != nil && result.Switch.TriggeredAt != nil && !m.disappearShown:
				m.disappearShown = true
				return m.showToast(`"If I disappear" went off on `+formatDate(*result.Switch.TriggeredAt)+": your messages were sent", false)
			case result.WasWarned > 0 && result.WasWarned < len(disappearWarned):
				return m.showToast(fmt.Sprintf(`Welcome back: your "If I disappear" messages were less than %s from being sent; the days start again`, disappearWarned[result.WasWarned]), false)
			}

			return nil
		}
	})
}

// sentAutomatically: over a message "If I disappear" sent.
func sentAutomatically(message Message) string {
	return fmt.Sprintf("Sent automatically: @%s had not opened Ostrich for %d days", sanitize(message.SenderUsername), *message.SentAfterDays)
}

// heirLines: an OstrichID left in a message.
func heirLines(id string, own bool, sender string) []string {
	title := "@" + sender + " left you their OstrichID"

	if own {
		title = "Your OstrichID"
	}

	return []string{title, formatOstrichID(id), "With their username and password it opens their account and all their messages. Keep it somewhere safe."}
}
