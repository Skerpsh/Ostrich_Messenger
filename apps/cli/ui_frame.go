package main

import (
	"strings"

	"github.com/charmbracelet/x/ansi"
	zone "github.com/lrstanley/bubblezone"
)

// The main screen's frame: a box around everything with "Ostrich" and the
// user in its top line, the chats list and the open chat (or Settings)
// side by side split by a line (one at a time in a narrow terminal), and
// under the box one line of key hints (or a message). A pane's full-width
// rule ("────") meets the frame with ├ ┤ ┼.

// The frame's lines (top and bottom) and the hint line.
const frameChrome = 3

// innerHeight is the height of the panes inside the frame.
func (m model) innerHeight() int {
	return max(m.height-frameChrome, 1)
}

func (m model) mainView() string {
	p := m.pal
	w, h := m.width, m.height
	inner := m.innerHeight()

	if w < 20 || h < 6 {
		return fitBlock(seg("The terminal is too small", p.muted, p.bg), w, h, p.bg)
	}

	var left, right []string
	leftW, rightW := 0, w-2

	pane := func(pw int) string {
		switch {
		case m.settings != nil && (m.wide() || m.focus == paneSettings):
			return m.settingsView(pw, inner)
		case m.chat != nil && (m.wide() || m.focus == paneChat):
			return m.chatView(pw, inner)
		case m.wide():
			return m.emptyPaneView(pw, inner)
		}

		return m.listView(pw, inner)
	}

	if m.wide() {
		leftW, rightW = m.sidebarWidth(), m.paneWidth()
		left = strings.Split(m.listView(leftW, inner), "\n")
	}

	right = strings.Split(pane(rightW), "\n")

	border := func(s string) string { return seg(s, p.line, p.bg) }
	rule := func(line string, n int) bool {
		plain := ansi.Strip(line)
		return n > 0 && plain == strings.Repeat("─", n)
	}

	out := make([]string, 0, h)
	out = append(out, m.frameTop(leftW, rightW))

	for i := 0; i < inner; i++ {
		var l, r string

		if i < len(right) {
			r = right[i]
		}

		rightRule := rule(r, rightW)

		if !m.wide() {
			edgeL, edgeR := "│", "│"

			if rightRule {
				edgeL, edgeR = "├", "┤"
			}

			out = append(out, border(edgeL)+fitLine(r, rightW, p.bg)+border(edgeR))

			continue
		}

		if i < len(left) {
			l = left[i]
		}

		leftRule := rule(l, leftW)
		edgeL, mid, edgeR := "│", "│", "│"

		switch {
		case leftRule && rightRule:
			edgeL, mid, edgeR = "├", "┼", "┤"
		case leftRule:
			edgeL, mid = "├", "┤"
		case rightRule:
			mid, edgeR = "├", "┤"
		}

		out = append(out, border(edgeL)+fitLine(l, leftW, p.bg)+border(mid)+fitLine(r, rightW, p.bg)+border(edgeR))
	}

	bottom := "└" + strings.Repeat("─", w-2) + "┘"

	if m.wide() {
		bottom = "└" + strings.Repeat("─", leftW) + "┴" + strings.Repeat("─", rightW) + "┘"
	}

	out = append(out, border(bottom), m.hintLine(m.hints(), w, p.bg))
	view := strings.Join(out, "\n")

	switch {
	case m.helpOpen:
		view = overlay(view, m.helpView(), w, h)
	case m.settings != nil && m.settings.form != "" && (m.wide() || m.focus == paneSettings):
		view = overlay(view, m.settingsFormView(), w, h)
	case m.prompt != nil:
		view = overlay(view, m.promptView(), w, h)
	case m.qr != nil:
		view = overlay(view, m.qrView(), w, h)
	case m.menu != nil:
		view = overlay(view, m.menuView(), w, h)
	case m.safetyOpen && (m.chat != nil || m.safetyPeer != nil):
		view = overlay(view, m.safetyView(), w, h)
	case m.serverView != nil:
		view = overlay(view, m.serverViewView(), w, h)
	}

	return view
}

// frameTop: "┌ Ostrich ────┬──── @bob · online ┐".
func (m model) frameTop(leftW, rightW int) string {
	p := m.pal
	w := m.width
	title := bold("Ostrich", p.accent, p.bg)

	status := seg("online", p.online, p.bg)

	switch m.connStatus {
	case connConnecting:
		status = seg("connecting…", p.muted, p.bg)
	case connOffline:
		status = seg("offline, waiting for the network", p.danger, p.bg)
	}

	// Clicked: Settings.
	me := zone.Mark("list:settings", seg("@"+sanitize(m.user.User.Username), p.text, p.bg)) + seg(" · ", p.muted, p.bg) + status
	line := func(s string) string { return seg(s, p.line, p.bg) }

	used := 2 + 1 + width(title) + 1 + 1 + width(me) + 1
	fill := w - used

	if fill < 2 {
		me = ""
		fill = w - (2 + 1 + width(title) + 1)
	}

	rest := strings.Repeat("─", max(fill, 0))

	// The divider meets the top line.
	if m.wide() {
		at := leftW - (1 + width(title) + 1)

		if at >= 0 && at < len([]rune(rest)) {
			runes := []rune(rest)
			runes[at] = '┬'
			rest = string(runes)
		}
	}

	_ = rightW
	top := line("┌ ") + title + line(" "+rest)

	if me != "" {
		top += blank(1, p.bg) + me + blank(1, p.bg)
	}

	return fitLine(top+line("┐"), w, p.bg)
}

// emptyPaneView is the right side with no chat open.
func (m model) emptyPaneView(w, h int) string {
	p := m.pal
	lines := []string{
		center(bold("No chat open", p.text, p.bg), w, p.bg),
		"",
		center(seg("Choose one on the left, or press n to start one", p.muted, p.bg), w, p.bg),
	}

	return fitBlock(strings.Repeat("\n", max((h-len(lines))/2, 0))+strings.Join(lines, "\n"), w, h, p.bg)
}

// hints: the keys that matter where the focus is.
func (m model) hints() string {
	c := m.chat

	switch {
	case m.helpOpen && len(m.helpLines()) > m.helpRoom():
		return "↑↓ scroll  Esc close"
	case m.helpOpen:
		return "Esc close"
	case m.menu != nil:
		return "Type to filter  ↑↓ choose  Enter do it  Esc close"
	case m.settings != nil && m.settings.form != "" && (m.wide() || m.focus == paneSettings):
		return "↑↓ Tab field  Enter next / save  Esc cancel"
	case m.settings != nil && m.settings.inContent && (m.wide() || m.focus == paneSettings):
		return "↑↓ move  Enter choose  ←→ change  Esc the parts"
	case m.settings != nil && (m.wide() || m.focus == paneSettings):
		return "↑↓ part  Enter open it  Esc close  Ctrl+P commands"
	case m.focus == paneChat && c != nil:
		switch {
		case c.attaching:
			return "Type a file's path  Enter add  Esc cancel"
		case len(c.picked) > 0:
			return "Enter send with the files  Ctrl+A another  Ctrl+X remove the last  Esc back"
		case c.selecting:
			return "↑↓ choose  r reply  e edit  d delete  c copy  1–8 react  Enter more  Ctrl+P commands  Esc back"
		case c.searching:
			return "Enter older match  ↓ newer  Esc close"
		case c.editing != nil:
			return "Enter save  Esc cancel"
		case c.replyTo != nil:
			return "Enter send the reply  Esc cancel"
		}

		back := "Tab chats"

		if !m.wide() {
			back = "Esc chats"
		}

		return "Enter send  Alt+Enter new line  ↑ choose a message  Ctrl+P commands  " + back + "  F1 help"
	case m.list.searching:
		return "Type a name, @username or a link  Enter open  Esc cancel"
	}

	return "↑↓ move  Enter open  / search  n new chat  Ctrl+P commands  ? help  q quit"
}

// --- help ---

var helpSections = []struct {
	title string
	keys  [][2]string
}{
	{"Anywhere", [][2]string{
		{"Ctrl+P", "everything that can be done here"},
		{"F1, ?", "this help"},
		{"Tab", "between the chats and the open chat"},
		{"Esc", "back, close, cancel"},
		{"Ctrl+C", "quit"},
	}},
	{"Chats", [][2]string{
		{"↑ ↓  Enter", "choose, open"},
		{"/", "search chats and messages, or paste a link"},
		{"n  N", "new chat by @username, new group"},
		{"v", "Saved messages"},
		{"m", "the chosen chat's menu"},
		{"s  t", "settings, theme"},
	}},
	{"Writing", [][2]string{
		{"Enter", "send"},
		{"Alt+Enter", "new line"},
		{"Ctrl+A", "attach a file"},
		{"Ctrl+F", "search in the chat"},
		{"Ctrl+K", "safety code"},
		{"Ctrl+O", "the chat's menu"},
		{"↑", "in an empty field: choose a message"},
	}},
	{"A chosen message", [][2]string{
		{"r  e  d", "reply, edit, delete"},
		{"c", "copy"},
		{"1 – 8", "react"},
		{"s", "what the server sees"},
		{"Enter", "everything else"},
	}},
}

// box draws lines in a frame titled title, w cells wide.
func (m model) box(title string, lines []string, w int) string {
	p := m.pal
	line := func(s string) string { return seg(s, p.line, p.bg) }
	inner := w - 4

	top := line("┌ ") + bold(title, p.text, p.bg) + line(" "+strings.Repeat("─", max(w-4-width(title), 0))+"┐")

	if title == "" {
		top = line("┌" + strings.Repeat("─", w-2) + "┐")
	}
	out := []string{fitLine(top, w, p.bg)}

	for _, l := range lines {
		out = append(out, line("│")+blank(1, p.bg)+fitLine(l, inner, p.bg)+blank(1, p.bg)+line("│"))
	}

	return strings.Join(append(out, line("└"+strings.Repeat("─", w-2)+"┘")), "\n")
}

func (m model) helpWidth() int {
	return min(m.width-4, 64)
}

// helpRoom: how many of the help's lines fit on the screen.
func (m model) helpRoom() int {
	return max(m.height-6, 3)
}

// helpLines: the keys under their headings, a long one's words wrapped
// under it.
func (m model) helpLines() []string {
	p := m.pal
	keyW := 13
	textW := m.helpWidth() - 4 - keyW
	var lines []string

	for i, section := range helpSections {
		if i > 0 {
			lines = append(lines, "")
		}

		lines = append(lines, bold(section.title, p.accent, p.bg))

		for _, k := range section.keys {
			for j, text := range wrap(k[1], textW) {
				key := ""

				if j == 0 {
					key = k[0]
				}

				lines = append(lines, seg(key, p.text, p.bg)+blank(keyW-width(key), p.bg)+seg(text, p.muted, p.bg))
			}
		}
	}

	return lines
}

// helpMaxScroll: the first line shown when scrolled to the end (the
// last line of the window says there is more).
func (m model) helpMaxScroll() int {
	if n := len(m.helpLines()); n > m.helpRoom() {
		return n - m.helpRoom() + 1
	}

	return 0
}

func (m model) helpView() string {
	p := m.pal
	lines := m.helpLines()
	room := m.helpRoom()

	// Taller than the screen: a part of it, scrolled with the arrows.
	if len(lines) > room {
		from := min(m.helpScroll, m.helpMaxScroll())
		more := "↓ more"

		if from+room-1 >= len(lines) {
			more = "↑ back up"
		}

		lines = append(append([]string{}, lines[from:from+room-1]...), seg(more, p.muted, p.bg))
	}

	return m.box("Keys", lines, m.helpWidth())
}
