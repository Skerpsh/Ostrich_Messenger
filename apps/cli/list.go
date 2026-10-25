package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	zone "github.com/lrstanley/bubblezone"
)

// The chats list: search, starting chats by @username, unread counts,
// "typing…", the chat menu (pin, mute, clear, delete).

const (
	// Lines of a chat in the list: name, preview, space.
	listRowHeight = 3
	// Header: the title (or the search) and the rule.
	listHeaderHeight = 2
)

type listState struct {
	// The highlighted row and the first row shown.
	cursor, top int

	searching bool
	search    textinput.Model

	// Starting a chat with the searched @username.
	starting bool

	// Messages matching the search (search.go).
	matches []messageMatch
}

func newListState(p palette) listState {
	// Long enough for a pasted link.
	return listState{search: newInput("Search, @username or a link", 200, false, p)}
}

func (l *listState) restyle(p palette) {
	styleInput(&l.search, p)
}

func (l *listState) resize(w int) {
	l.search.Width = max(w-8, 4)
}

// listRow is a chat, the offer to start one with the searched name, a
// pasted link to open, or a message found by the search.
type listRow struct {
	chat     *Chat
	username string

	linkKind, linkValue string
	match               *messageMatch
}

// query is the search text, without "@", in lower case.
func (l listState) query() string {
	return strings.ToLower(cleanUsername(l.search.Value()))
}

func (m model) listRows() []listRow {
	query := m.list.query()
	var rows []listRow

	if kind, value := parseLink(m.list.search.Value()); kind != "" {
		return []listRow{{linkKind: kind, linkValue: value}}
	}

	if m.canStartChat(query) {
		rows = append(rows, listRow{username: query})
	}

	for i := range m.chats {
		if query == "" || strings.Contains(strings.ToLower(m.chatName(m.chats[i])), query) {
			rows = append(rows, listRow{chat: &m.chats[i]})
		}
	}

	for i := range m.list.matches {
		rows = append(rows, listRow{match: &m.list.matches[i]})
	}

	return rows
}

// canStartChat: the search is a username that is not in the list.
func (m model) canStartChat(query string) bool {
	if !validUsername(query) || m.user == nil || strings.EqualFold(query, m.user.User.Username) {
		return false
	}

	for _, chat := range m.chats {
		if chat.Type != "group" && strings.EqualFold(chat.Username, query) {
			return false
		}
	}

	return true
}

func (l listState) selectedChatID(m model) string {
	rows := m.listRows()

	if l.cursor < len(rows) && rows[l.cursor].chat != nil {
		return rows[l.cursor].chat.ID
	}

	return ""
}

// selectChat puts the cursor on the chat (if it is listed).
func (l *listState) selectChat(m model, chatID string) {
	rows := m.listRows()

	for i, row := range rows {
		if row.chat != nil && row.chat.ID == chatID {
			l.cursor = i
			return
		}
	}

	l.cursor = min(l.cursor, max(len(rows)-1, 0))
}

func (m *model) moveListCursor(delta int) {
	rows := m.listRows()

	if len(rows) == 0 {
		return
	}

	m.list.cursor = min(max(m.list.cursor+delta, 0), len(rows)-1)
}

// visibleRows is how many chats fit in the list.
func (m model) visibleRows() int {
	return max((m.innerHeight()-listHeaderHeight)/listRowHeight, 1)
}

// scrollList keeps the cursor on screen.
func (m *model) scrollList() {
	n := m.visibleRows()

	if m.list.cursor < m.list.top {
		m.list.top = m.list.cursor
	}

	if m.list.cursor >= m.list.top+n {
		m.list.top = m.list.cursor - n + 1
	}

	m.list.top = max(min(m.list.top, len(m.listRows())-n), 0)
}

func (m *model) startSearch(prefix string) tea.Cmd {
	m.focus = paneList
	m.list.searching = true
	m.list.search.SetValue(prefix)
	m.list.search.CursorEnd()
	m.list.cursor = 0

	return m.list.search.Focus()
}

func (m *model) stopSearch() {
	m.list.matches = nil
	m.list.searching = false
	m.list.search.SetValue("")
	m.list.search.Blur()
	m.list.cursor = 0

	if m.chat != nil {
		m.list.selectChat(*m, m.chat.id)
	}
}

func (m *model) updateListKey(msg tea.KeyMsg) tea.Cmd {
	l := &m.list
	defer m.scrollList()

	if l.searching {
		switch msg.String() {
		case "esc":
			m.stopSearch()
		case "up":
			m.moveListCursor(-1)
		case "down":
			m.moveListCursor(1)
		case "enter":
			return m.activateRow()
		default:
			var cmd tea.Cmd
			l.search, cmd = l.search.Update(msg)
			l.cursor = 0
			l.matches = m.searchMessages(l.search.Value())

			return cmd
		}

		return nil
	}

	switch msg.String() {
	case "up", "k":
		m.moveListCursor(-1)
	case "down", "j":
		m.moveListCursor(1)
	case "home", "g":
		l.cursor = 0
	case "end", "G":
		m.moveListCursor(len(m.chats))
	case "enter", "right", "l":
		return m.activateRow()
	case "/":
		return m.startSearch("")
	case "n":
		return m.startSearch("@")
	case "N":
		return m.newGroup()
	case "v":
		return m.openSaved()
	case "m", ".":
		rows := m.listRows()

		if l.cursor < len(rows) && rows[l.cursor].chat != nil {
			m.openMenu(m.chatMenu(*rows[l.cursor].chat, false))
		}
	case "s":
		return m.openSettings()
	case "t":
		return m.toggleTheme()
	case "tab":
		if m.chat != nil {
			m.focus = paneChat
			return m.chat.composer.Focus()
		}
	case "q":
		return m.quit()
	}

	return nil
}

// activateRow opens the highlighted chat, or starts the chat offered.
func (m *model) activateRow() tea.Cmd {
	rows := m.listRows()

	if m.list.cursor >= len(rows) {
		return nil
	}

	row := rows[m.list.cursor]

	if row.linkKind != "" {
		m.stopSearch()
		return m.openLink(row.linkKind, row.linkValue)
	}

	if row.match != nil {
		match := *row.match
		m.stopSearch()

		return tea.Sequence(m.openChat(match.chat), func() tea.Msg {
			return resultMsg{apply: func(m *model) tea.Cmd { return m.showQuoted(match.message.ID) }}
		})
	}

	if row.chat == nil {
		return m.startChat(row.username)
	}

	chat := *row.chat

	if m.list.searching {
		m.stopSearch()
	}

	return m.openChat(chat)
}

func (m *model) startChat(username string) tea.Cmd {
	if m.list.starting {
		return nil
	}

	m.list.starting = true
	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		chat, err := createChat(token, username)

		return func(m *model) tea.Cmd {
			m.list.starting = false

			if m.user == nil || m.user.Token != token {
				return nil
			}

			if err != nil {
				return m.fail(err)
			}

			m.setPresence(chat.UserID, chat.Online, chat.LastSeenAt)

			if m.findChat(chat.ID) < 0 {
				m.moveToTop(chat)
			}

			m.stopSearch()

			return tea.Batch(m.openChat(chat), m.loadChats())
		}
	})
}

func (m *model) updateListMouse(msg tea.MouseMsg) (tea.Cmd, bool) {
	if !m.showingList() {
		return nil, false
	}

	if d := wheel(msg, "list:rows"); d != 0 {
		m.moveListCursor(d)
		m.scrollList()

		return nil, true
	}

	switch {
	case clicked(msg, "list:search"):
		if !m.list.searching {
			return m.startSearch(""), true
		}

		m.focus = paneList

		return nil, true
	case clicked(msg, "list:new"):
		return m.startSearch("@"), true
	case clicked(msg, "list:settings"):
		return m.openSettings(), true
	case clicked(msg, "list:theme"):
		return m.toggleTheme(), true
	}

	for i, row := range m.listRows() {
		id := fmt.Sprintf("list:row:%d", i)

		switch {
		case clicked(msg, id):
			m.list.cursor = i

			return m.activateRow(), true
		case rightClicked(msg, id) && row.chat != nil:
			m.list.cursor = i
			m.openMenu(m.chatMenu(*row.chat, false))

			return nil, true
		}
	}

	return nil, false
}

// toggleTheme switches between light and dark (leaving "system").
// With the terminal's colors it has nothing to switch: it says where.
func (m *model) toggleTheme() tea.Cmd {
	if m.cfg.Colors != "ostrich" {
		return m.showToast("Ostrich uses the terminal's colors: switch it in Settings → Appearance", false)
	}

	if m.pal.mode == themeDark {
		m.cfg.Theme = "light"
	} else {
		m.cfg.Theme = "dark"
	}

	return m.lookChanged()
}

// --- view ---

// iconButton is a clickable label.
func iconButton(id, icon string, fg, bg lipgloss.Color) string {
	return zone.Mark(id, seg(" "+icon+" ", fg, bg))
}

func (m model) listView(w, h int) string {
	p := m.pal
	bg := p.bg
	var lines []string

	// Title, or the search while searching; then the rule.
	if m.list.searching {
		lines = append(lines, zone.Mark("list:search", seg(" / ", p.accent, bg)+fitLine(onBackground(m.list.search.View(), bg), w-3, bg)))
	} else {
		title := bold(" Chats", p.text, bg)

		if unread := m.totalUnread(); unread > 0 {
			title += seg(fmt.Sprintf("  %d unread", unread), p.muted, bg)
		}

		lines = append(lines, zone.Mark("list:search", row(title, iconButton("list:new", "+", p.accent, bg), w, bg)))
	}

	lines = append(lines, seg(strings.Repeat("─", w), p.line, bg))

	rows := m.listRows()
	area := h - listHeaderHeight
	var rowLines []string

	switch {
	case !m.chatsLoaded:
		rowLines = append(rowLines, "", seg(" Loading chats…", p.muted, bg))
	case len(rows) == 0 && m.list.query() != "":
		rowLines = append(rowLines, "", seg(clip(" Nothing matches “"+sanitize(m.list.search.Value())+"”", w), p.muted, bg))
	case len(rows) == 0:
		rowLines = append(rowLines,
			"",
			bold(" No chats yet", p.text, bg),
			"",
			seg(clip(" Press n and type a @username,", w), p.muted, bg),
			seg(clip(" or share yours: @"+sanitize(m.user.User.Username), w), p.muted, bg),
		)
	default:
		end := min(m.list.top+m.visibleRows(), len(rows))

		for i := m.list.top; i < end; i++ {
			block := m.listRowView(rows[i], i == m.list.cursor, w)
			rowLines = append(rowLines, zone.Mark(fmt.Sprintf("list:row:%d", i), block))
		}
	}

	lines = append(lines, zone.Mark("list:rows", fitBlock(strings.Join(rowLines, "\n"), w, area, bg)))

	return fitBlock(strings.Join(lines, "\n"), w, h, bg)
}

// listRowView draws one row: two lines and a space. The bar on the left
// marks the row the keys act on (the list has the focus) or else the open
// chat.
func (m model) listRowView(r listRow, cursor bool, w int) string {
	p := m.pal
	bg := p.bg
	open := r.chat != nil && m.chat != nil && r.chat.ID == m.chat.id
	listFocused := m.focus == paneList || !m.wide()

	// What the keys act on: the cursor while the list has the focus, else
	// the open chat.
	marked := cursor && listFocused || open && !listFocused
	bar := blank(1, bg)
	nameFg := p.text

	switch {
	case marked:
		bar = seg("▌", p.accent, bg)
		nameFg = p.accent
	case open:
		bar = seg("▏", p.muted, bg)
	}

	inner := w - 3
	two := func(left1, right1, left2, right2 string) string {
		return strings.Join([]string{
			bar + blank(1, bg) + row(left1, right1, inner, bg) + blank(1, bg),
			bar + blank(1, bg) + row(left2, right2, inner, bg) + blank(1, bg),
			blank(w, bg),
		}, "\n")
	}

	if r.linkKind != "" {
		label, sub := "Open the group invite", "Ask to join; an admin lets you in"

		if r.linkKind == "user" {
			label, sub = "Open @"+r.linkValue+"'s profile", "Start a chat with them"
		}

		return two(bold(clip(label, inner), nameFg, bg), "", seg(clip(sub, inner), p.muted, bg), "")
	}

	if match := r.match; match != nil {
		who := ""

		switch {
		case match.message.SenderID == m.user.User.ID:
			who = "you: "
		case match.chat.Type == "group":
			who = sanitize(match.message.SenderUsername) + ": "
		}

		return two(
			bold(clip(sanitize(m.listTitle(match.chat)), inner-8), nameFg, bg),
			seg(formatChatDate(match.message.CreatedAt), p.muted, bg),
			seg(clip(oneLine(sanitize(who+match.text)), inner), p.muted, bg), "",
		)
	}

	if r.chat == nil {
		sub := "Find this user by their exact username"

		if m.list.starting {
			sub = "Starting…"
		}

		return two(bold(clip("Start a chat with @"+r.username, inner), nameFg, bg), "", seg(clip(sub, inner), p.muted, bg), "")
	}

	chat := *r.chat
	group := chat.Type == "group"
	unread := chat.UnreadCount > 0

	name := sanitize(m.listTitle(chat))
	nameStyle := seg(name, nameFg, bg)

	if unread || marked {
		nameStyle = bold(name, nameFg, bg)
	}

	if !group && m.keyChanged[chat.UserID] || group && m.groupDistrusted[chat.ID] {
		nameStyle = bold("! ", p.danger, bg) + nameStyle
	}

	// Time of the last message, ticks for own ones.
	last := chat.LastMessage
	stamp := chat.Created

	if last != nil {
		stamp = last.CreatedAt
	}

	timeFg := p.muted

	if unread && !chat.Muted {
		timeFg = p.accent
	}

	right1 := seg(formatChatDate(stamp), timeFg, bg)
	own := last != nil && last.SenderID == m.user.User.ID

	if own && chat.Type != "saved" {
		right1 = m.ticks(chat, last.CreatedAt, bg) + blank(1, bg) + right1
	}

	var preview string
	draft := m.drafts[chat.ID]

	switch {
	case m.isTyping(chat.ID):
		preview = seg("typing…", p.accent, bg)
	case last != nil && last.Kind == "system":
		preview = italic(oneLine(sanitize(systemText(last.SenderID, last.SenderUsername, last.Content, m.user.User.ID))), p.muted, bg)
	case draft != "" && (m.chat == nil || m.chat.id != chat.ID):
		preview = seg("Draft: ", p.danger, bg) + seg(oneLine(sanitize(draft)), p.muted, bg)
	case last == nil:
		preview = italic("No messages yet", p.muted, bg)
	default:
		text := oneLine(sanitize(plainText(m.textOf(chat, last.ID, last.SenderID, last.Content))))
		who := ""

		switch {
		case chat.Type == "saved":
		case own:
			who = "you: "
		case group:
			who = sanitize(last.SenderUsername) + ": "
		}

		preview = seg(who+text, p.muted, bg)
	}

	// Mentions, people asking to join, unread count; muted ones dim.
	var badges []string

	if chat.UnreadMentions > 0 {
		badges = append(badges, bold("@", p.accent, bg))
	}

	if chat.JoinRequests > 0 {
		badges = append(badges, bold(fmt.Sprintf("+%d", chat.JoinRequests), p.accent, bg))
	}

	if unread {
		count := fmt.Sprint(chat.UnreadCount)

		if chat.UnreadCount > 99 {
			count = "99+"
		}

		if chat.Muted {
			badges = append(badges, seg(count, p.muted, bg))
		} else {
			badges = append(badges, bold(count, p.accent, bg))
		}
	}

	if chat.Muted {
		badges = append(badges, seg("muted", p.muted, bg))
	}

	return two(nameStyle, right1, preview, strings.Join(badges, blank(1, bg)))
}

// listTitle: the name in the list and the chat's header, "# group" for
// groups.
func (m model) listTitle(chat Chat) string {
	switch chat.Type {
	case "group":
		return "# " + m.chatName(chat)
	case "saved":
		return "Saved messages"
	}

	return m.chatName(chat)
}

// ticks: ✓ sent, ✓✓ read by the other member (if read receipts are on).
func (m model) ticks(chat Chat, createdAt string, bg lipgloss.Color) string {
	read := chat.PeerLastReadAt != nil && !later(&createdAt, chat.PeerLastReadAt)

	if read {
		return seg("✓✓", m.pal.accent, bg)
	}

	return seg("✓", m.pal.muted, bg)
}
