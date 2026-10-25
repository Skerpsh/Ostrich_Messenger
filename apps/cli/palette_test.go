package main

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestPalette(t *testing.T) {
	m := testModel(t, 120, 34, "dark")
	m.focus = paneChat

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlP})
	m = next.(model)

	if m.menu == nil || m.menu.title != "Commands" {
		t.Fatal("palette not open")
	}

	all := len(m.menu.shown())

	// Typing filters; the chat's and Ostrich's commands are there.
	m = press(m, "s", "a", "f", "e", "t", "y")

	if got := m.menu.shown(); len(got) != 1 || m.menu.items[got[0]].label != "Safety code" || len(got) >= all {
		t.Fatalf("filtered to %d of %d", len(got), all)
	}

	// Esc empties the filter first, then closes.
	m = press(m, "esc")

	if m.menu == nil || m.menu.filter.Value() != "" || len(m.menu.shown()) != all {
		t.Fatal("filter not emptied")
	}

	m = press(m, "esc")

	if m.menu != nil {
		t.Fatal("palette not closed")
	}

	// Enter does the command.
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyCtrlP})
	m = next.(model)
	m = press(m, "s", "a", "f", "e", "t", "y", "enter")

	if m.menu != nil || !m.safetyOpen {
		t.Fatal("safety code not shown")
	}
}
