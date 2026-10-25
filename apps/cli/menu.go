package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"

	tea "github.com/charmbracelet/bubbletea"
	zone "github.com/lrstanley/bubblezone"
)

// Action menus over the screen (a message's, a chat's) and the safety
// code.

type menuItem struct {
	icon, label string
	// The key that does it without the menu, shown on the right.
	key string
	// A heading over it, where it starts a part (the palette's).
	section string
	danger  bool
	// Destructive actions take a second Enter: the label shown after the
	// first.
	confirm string
	action  func(*model) tea.Cmd
}

// A menu over the screen: the chat's, a message's, the commands (Ctrl+P,
// palette.go). Typing filters it; ↑↓ choose, Enter does it.
type menuState struct {
	title string
	// A message's menu starts with its reactions.
	reactionsFor *Message
	items        []menuItem
	// Index into shown(); -1: the reactions row.
	cursor int
	// Position in the reactions row.
	reaction int
	// The item (index into items) asking for its second Enter.
	confirming int
	// A group's info (its chat id): redrawn when the members load.
	groupInfo string
	filter    textinput.Model
}

func (m *model) openMenu(menu *menuState) {
	menu.filter = newInput("Type to filter", 40, false, m.pal)
	menu.filter.Prompt = ""
	menu.filter.Focus()
	m.menu = menu
}

// shown: the items whose label has the filter's words, as indexes.
func (menu *menuState) shown() []int {
	words := strings.Fields(strings.ToLower(menu.filter.Value()))
	var out []int

	for i, item := range menu.items {
		label := strings.ToLower(item.label + " " + item.key)
		all := true

		for _, word := range words {
			all = all && strings.Contains(label, word)
		}

		if all {
			out = append(out, i)
		}
	}

	return out
}

// focusLabel puts the cursor on an item and asks for its confirmation.
func (menu *menuState) focusLabel(label string) {
	for pos, i := range menu.shown() {
		if menu.items[i].label == label {
			menu.cursor = pos

			if menu.items[i].confirm != "" {
				menu.confirming = i
			}
		}
	}
}

func (m *model) messageMenu(chat Chat, message Message) *menuState {
	own := message.SenderID == m.user.User.ID
	shown := m.show(chat, message.ID, message.SenderID, message.Content)
	title := oneLine(sanitize(plainText(shown.text)))
	copyItem := menuItem{icon: "⧉", label: "Copy text", key: "c", action: func(m *model) tea.Cmd { return m.copyMessage(chat, message) }}

	// Still on its way: it can only be sent again, copied or dropped.
	if state := m.outgoingState(message.ID); state != "" {
		var items []menuItem

		if state == "failed" {
			label := "Send again"

			if i := m.findOutgoing(message.ID); i >= 0 && m.outgoing[i].err != "" {
				label += " (" + m.outgoing[i].err + ")"
			}

			items = append(items, menuItem{icon: "↻", label: label, action: func(m *model) tea.Cmd {
				m.chat.resetSelection()
				return m.attemptSend(message.ID)
			}})
		}

		items = append(items, copyItem, menuItem{icon: "🗑", label: "Delete", danger: true, action: func(m *model) tea.Cmd {
			m.chat.resetSelection()
			m.dropOutgoing(message.ID)

			return m.chat.composer.Focus()
		}})

		return &menuState{title: title, items: items, confirming: -1}
	}

	items := []menuItem{
		{icon: "↪", label: "Reply", key: "r", action: func(m *model) tea.Cmd { return m.startReply(message) }},
		{icon: "☺", label: "React with another emoji…", action: func(m *model) tea.Cmd {
			return m.openPrompt("React with", "an emoji", "Type or paste one emoji.", "", 32, func(m *model, value string) tea.Cmd {
				if m.chat != nil {
					m.chat.resetSelection()
				}

				return m.react(message, value)
			})
		}},
	}

	if n := len(shown.attachments); n > 0 {
		label := "Save file to " + downloadsDir()

		if n > 1 {
			label = fmt.Sprintf("Save %d files to %s", n, downloadsDir())
		}

		items = append(items, menuItem{icon: "⇩", label: label, action: func(m *model) tea.Cmd {
			return m.saveFiles(chat, message)
		}})
	}

	items = append(items, copyItem)

	if shown.status == decryptOK && (shown.sealed == nil || shown.opened) {
		items = append(items, menuItem{icon: "↷", label: "Forward", action: func(m *model) tea.Cmd {
			m.openMenu(m.forwardMenu(chat, message))
			return nil
		}})
	}

	pinned := chat.PinnedMessage != nil && chat.PinnedMessage.ID == message.ID
	pinLabel, pinID := "Pin", message.ID

	if pinned {
		pinLabel, pinID = "Unpin", ""
	}

	// In a group, admins pin.
	if chat.Type != "group" || chat.isAdmin() {
		items = append(items, menuItem{icon: "📌", label: pinLabel, action: func(m *model) tea.Cmd { return m.pinMessage(chat, pinID) }})
	}

	if message.ReplyTo != nil {
		reply := message.ReplyTo.ID
		items = append(items, menuItem{icon: "⤴", label: "Show quoted message", action: func(m *model) tea.Cmd {
			return m.showQuoted(reply)
		}})
	}

	items = append(items, menuItem{icon: "🗄", label: "What the server sees", key: "s", action: func(m *model) tea.Cmd {
		return m.openMessageServerView(chat, message)
	}})

	if own && shown.status == decryptOK && shown.forwardedFrom == "" && shown.sealed == nil {
		items = append(items, menuItem{icon: "✎", label: "Edit", key: "e", action: func(m *model) tea.Cmd { return m.startEdit(chat, message) }})
	}

	// In a group, admins delete any message.
	if own || chat.isAdmin() {
		items = append(items, menuItem{icon: "🗑", label: "Delete", key: "d", danger: true, confirm: "Delete for everyone?", action: func(m *model) tea.Cmd {
			m.chat.resetSelection()
			return tea.Batch(m.deleteMessage(message), m.chat.composer.Focus())
		}})
	}

	return &menuState{
		title:        title,
		reactionsFor: &message,
		items:        items,
		confirming:   -1,
	}
}

// forwardMenu: the chats a message can be forwarded to.
func (m *model) forwardMenu(from Chat, message Message) *menuState {
	var items []menuItem

	for _, target := range m.chats {
		writable := target.PublicKey != ""

		if target.Type == "group" {
			writable = m.groupKeyOf(target.ID, target.KeyEpoch) != nil
		}

		if target.Blocked || !writable {
			continue
		}

		target := target
		items = append(items, menuItem{icon: "→", label: m.chatTitle(target), action: func(m *model) tea.Cmd {
			return m.forward(from, message, target)
		}})
	}

	if len(items) == 0 {
		items = append(items, menuItem{icon: " ", label: "No chats to forward to", action: func(*model) tea.Cmd { return nil }})
	}

	return &menuState{title: "Forward to…", items: items, confirming: -1}
}

// forward sends a message's text to another chat, encrypted for it, with
// whom it comes from; then opens that chat.
func (m *model) forward(from Chat, message Message, target Chat) tea.Cmd {
	shown := m.show(from, message.ID, message.SenderID, message.Content)
	origin := shown.forwardedFrom

	if origin == "" {
		origin = from.Username

		if from.Type == "group" {
			origin = message.SenderUsername
		}

		if message.SenderID == m.user.User.ID {
			origin = m.user.User.Username
		}
	}

	if m.chat != nil {
		m.chat.resetSelection()
	}

	// Files are copied on the server first (same keys, new ids).
	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		attachments, err := copyAttachments(token, shown.attachments)
		link := shown.link

		// The link preview's picture is copied too; without it if that
		// fails (it may be gone from the server).
		if err == nil && link != nil && link.Image != nil {
			copied := *link
			copied.Image = nil

			if images, imageErr := copyAttachments(token, []attachment{*link.Image}); imageErr == nil {
				copied.Image = &images[0]
			}

			link = &copied
		}

		return func(m *model) tea.Cmd {
			if err != nil {
				return m.fail(err)
			}

			if m.user == nil || m.user.Token != token {
				return nil
			}

			id := newMessageID()
			content, err := m.encryptFor(target, encodePayload(payload{text: shown.text, forwardedFrom: origin, attachments: attachments, link: link}), id)
			if err != nil {
				return m.showToast(err.Error(), true)
			}

			var ids []string

			for _, a := range attachments {
				ids = append(ids, a.ID)
			}

			if link != nil && link.Image != nil {
				ids = append(ids, link.Image.ID)
			}

			return tea.Batch(m.queueMessage(target.ID, id, content, nil, ids), m.openChat(target))
		}
	})
}

func (m *model) pinMessage(chat Chat, messageID string) tea.Cmd {
	if m.chat != nil {
		m.chat.resetSelection()
	}

	return m.chatAction(func(token string) error {
		return setPinnedMessage(token, chat.ID, messageID)
	}, "")
}

// chatMenu: the chat's actions; from the chat screen with search, safety
// code and blocking.
func (m *model) chatMenu(chat Chat, inChat bool) *menuState {
	if chat.Type == "group" {
		return m.groupMenu(chat, inChat)
	}

	if chat.Type == "saved" {
		return m.savedMenu(chat, inChat)
	}

	var items []menuItem

	if inChat {
		items = append(items, menuItem{icon: "🔍", label: "Search in chat", key: "Ctrl+F", action: func(m *model) tea.Cmd {
			return m.openChatSearch()
		}})
		items = append(items, menuItem{icon: "🗄", label: "What the server sees", action: func(m *model) tea.Cmd {
			return m.openChatServerView(chat)
		}})
		items = append(items, menuItem{icon: "✉", label: "Seal the next message until…", action: func(m *model) tea.Cmd {
			return m.askSealing()
		}})

		if chat.PinnedMessage != nil {
			items = append(items, menuItem{icon: "📌", label: "Unpin message", action: func(m *model) tea.Cmd {
				return m.pinMessage(chat, "")
			}})
		}

		if chat.PublicKey != "" {
			items = append(items, menuItem{icon: "🛡", label: "Safety code", key: "Ctrl+K", action: func(m *model) tea.Cmd {
				m.openSafety(chat)
				return nil
			}})
		}
	}

	pinLabel, muteLabel := "Pin to top", "Mute"

	if chat.Pinned {
		pinLabel = "Unpin"
	}

	if chat.Muted {
		muteLabel = "Unmute"
	}

	items = append(items,
		menuItem{icon: "📌", label: pinLabel, action: func(m *model) tea.Cmd { return m.setPinned(chat, !chat.Pinned) }},
		menuItem{icon: "🔕", label: muteLabel, action: func(m *model) tea.Cmd { return m.setMuted(chat, !chat.Muted) }},
	)

	if inChat {
		block := menuItem{icon: "⊘", label: "Block @" + chat.Username, danger: true,
			confirm: "Block? They won't be able to message you",
			action:  func(m *model) tea.Cmd { return m.setBlocked(chat, true) }}

		if chat.BlockedByMe {
			block = menuItem{icon: "⊘", label: "Unblock @" + chat.Username,
				action: func(m *model) tea.Cmd { return m.setBlocked(chat, false) }}
		}

		items = append(items, block)
	}

	items = append(items,
		menuItem{icon: "◌", label: "Clear history for me", danger: true,
			confirm: "Clear? @" + chat.Username + " keeps the messages",
			action:  func(m *model) tea.Cmd { return m.removeChat(chat, "me") }},
		menuItem{icon: "🗑", label: "Delete for both", danger: true,
			confirm: "Delete the chat for both of you?",
			action:  func(m *model) tea.Cmd { return m.removeChat(chat, "everyone") }},
	)

	return &menuState{title: "@" + chat.Username, items: items, confirming: -1}
}

// chooseItem runs the item shown at pos (or asks for confirmation first).
func (m *model) chooseItem(pos int) tea.Cmd {
	menu := m.menu
	shown := menu.shown()

	if pos < 0 || pos >= len(shown) {
		return nil
	}

	i := shown[pos]
	item := menu.items[i]

	if item.confirm != "" && menu.confirming != i {
		menu.confirming = i
		menu.cursor = pos

		return nil
	}

	m.menu = nil

	return item.action(m)
}

func (m *model) chooseReaction(i int) tea.Cmd {
	message := *m.menu.reactionsFor
	m.menu = nil

	if m.outgoingState(message.ID) != "" {
		return nil
	}

	if m.chat != nil {
		m.chat.resetSelection()
		cmd := m.chat.composer.Focus()

		return tea.Batch(cmd, m.react(message, reactionEmoji[i]))
	}

	return nil
}

func (m *model) closeMenu() tea.Cmd {
	m.menu = nil

	return nil
}

func (m *model) updateMenuKey(msg tea.KeyMsg) tea.Cmd {
	menu := m.menu
	shown := menu.shown()
	first := 0

	if menu.reactionsFor != nil && menu.filter.Value() == "" {
		first = -1
	}

	switch key := msg.String(); key {
	case "esc":
		// The filter first, then the menu.
		if menu.filter.Value() != "" {
			menu.filter.SetValue("")
			menu.cursor, menu.confirming = 0, -1

			return nil
		}

		return m.closeMenu()
	case "up", "shift+tab", "ctrl+p":
		menu.cursor = max(menu.cursor-1, first)
		menu.confirming = -1

		return nil
	case "down", "tab", "ctrl+n":
		menu.cursor = min(menu.cursor+1, len(shown)-1)
		menu.confirming = -1

		return nil
	case "left", "right":
		if menu.cursor == -1 {
			step := map[string]int{"left": -1, "right": 1}[key]
			menu.reaction = min(max(menu.reaction+step, 0), len(reactionEmoji)-1)

			return nil
		}
	case "enter":
		if menu.cursor == -1 {
			return m.chooseReaction(menu.reaction)
		}

		return m.chooseItem(menu.cursor)
	default:
		// 1–8 react while nothing is typed.
		if menu.reactionsFor != nil && menu.filter.Value() == "" && len(key) == 1 && key[0] >= '1' && key[0] < '1'+byte(len(reactionEmoji)) {
			return m.chooseReaction(int(key[0] - '1'))
		}
	}

	var cmd tea.Cmd
	menu.filter, cmd = menu.filter.Update(msg)
	menu.confirming = -1

	if len(menu.shown()) > 0 {
		menu.cursor = 0
	}

	return cmd
}

func (m *model) updateMenuMouse(msg tea.MouseMsg) tea.Cmd {
	if msg.Action != tea.MouseActionPress || msg.Button != tea.MouseButtonLeft {
		return nil
	}

	for i := range reactionEmoji {
		if clicked(msg, fmt.Sprintf("menu:reaction:%d", i)) {
			return m.chooseReaction(i)
		}
	}

	for pos := range m.menu.shown() {
		if clicked(msg, fmt.Sprintf("menu:item:%d", pos)) {
			return m.chooseItem(pos)
		}
	}

	// A click outside the menu closes it.
	if !zone.Get("menu").InBounds(msg) {
		return m.closeMenu()
	}

	return nil
}

func (m model) menuView() string {
	menu := m.menu
	p := m.pal
	bg := p.bg
	w := min(56, m.width-4)
	inner := w - 4
	var lines []string

	lines = append(lines, bold("> ", p.accent, bg)+fitLine(onBackground(menu.filter.View(), bg), inner-2, bg), "")

	if message := menu.reactionsFor; message != nil && menu.filter.Value() == "" {
		var chips []string

		for i, emoji := range reactionEmoji {
			label := " " + emoji + " "

			for _, r := range message.Reactions {
				if r.UserID == m.user.User.ID && r.Emoji == emoji {
					label = "(" + emoji + ")"
				}
			}

			chip := seg(label, p.text, bg)

			if menu.cursor == -1 && menu.reaction == i {
				chip = bold("["+emoji+"]", p.accent, bg)
			}

			chips = append(chips, zone.Mark(fmt.Sprintf("menu:reaction:%d", i), chip))
		}

		lines = append(lines, strings.Join(chips, blank(1, bg)), "")
	}

	shown := menu.shown()

	// Long lists scroll around the cursor; headings take lines too.
	headings := map[string]bool{}

	for _, i := range shown {
		if s := menu.items[i].section; s != "" && menu.filter.Value() == "" {
			headings[s] = true
		}
	}

	room := max(m.height-12-len(lines)-2*len(headings), 3)
	top := 0

	if menu.cursor >= room {
		top = menu.cursor - room + 1
	}

	if len(shown) == 0 {
		lines = append(lines, seg("Nothing matches", p.muted, bg))
	}

	section := ""

	for pos := top; pos < len(shown) && pos < top+room; pos++ {
		item := menu.items[shown[pos]]

		// Headings while nothing is typed.
		if item.section != "" && item.section != section && menu.filter.Value() == "" {
			if section != "" {
				lines = append(lines, "")
			}

			lines = append(lines, seg(clip(item.section, inner), p.muted, bg))
			section = item.section
		}
		fg := p.text

		if item.danger {
			fg = p.danger
		}

		label := item.label

		if menu.confirming == shown[pos] {
			label = item.confirm + " (Enter)"
		}

		// Filtered, the headings are not there: the part is on the right.
		right := item.key

		if menu.filter.Value() != "" && item.section != "" {
			right = strings.ToLower(item.section)

			if item.key != "" {
				right += " · " + item.key
			}
		}

		bar := blank(1, bg)
		text := seg(clip(sanitize(label), inner-2-width(right)-2), fg, bg)

		if menu.cursor == pos {
			bar = seg("▌", p.accent, bg)
			text = bold(clip(sanitize(label), inner-2-width(right)-2), fg, bg)
		}

		line := row(bar+blank(1, bg)+text, seg(right, p.muted, bg), inner, bg)
		lines = append(lines, zone.Mark(fmt.Sprintf("menu:item:%d", pos), line))
	}

	if more := len(shown) - top - room; more > 0 {
		lines = append(lines, seg(fmt.Sprintf("  %d more…", more), p.muted, bg))
	}

	return zone.Mark("menu", m.box(clip(sanitize(menu.title), w-6), lines, w))
}

// --- safety code ---

func (m *model) openSafety(chat Chat) {
	if chat.PublicKey == "" {
		return
	}

	m.safetyOpen = true
}

// safetyWith: whose safety code is shown (id, username, public key).
func (m model) safetyWith() foundUser {
	if m.safetyPeer != nil {
		return *m.safetyPeer
	}

	chat, _ := m.chatByID(m.chat.id)

	return foundUser{ID: chat.UserID, Username: chat.Username, PublicKey: chat.PublicKey}
}

// safetyChanged: the user's key differs from the one this computer knows.
func (m model) safetyChanged(peer foundUser) bool {
	known, ok := m.knownKeys[peer.ID]

	return ok && known != peer.PublicKey
}

func (m *model) closeSafety() {
	m.safetyOpen = false
	m.safetyPeer = nil
}

func (m *model) confirmSafety() {
	if peer := m.safetyWith(); m.safetyChanged(peer) {
		m.knownKeys[peer.ID] = peer.PublicKey
		delete(m.keyChanged, peer.ID)
		saveKnownKeys(m.user.User.ID, m.knownKeys)
	}

	m.closeSafety()
}

func (m *model) updateSafetyKey(msg tea.KeyMsg) tea.Cmd {
	switch msg.String() {
	case "y", "Y":
		m.confirmSafety()
	case "esc", "enter", "q", "ctrl+k":
		m.closeSafety()
	}

	return nil
}

func (m *model) updateSafetyMouse(msg tea.MouseMsg) tea.Cmd {
	switch {
	case clicked(msg, "safety:confirm"):
		m.confirmSafety()
	case clicked(msg, "safety:close"):
		m.closeSafety()
	case msg.Action == tea.MouseActionPress && !zone.Get("safety").InBounds(msg):
		m.closeSafety()
	}

	return nil
}

func (m model) safetyView() string {
	p := m.pal
	bg := p.bg
	peer := m.safetyWith()
	name := sanitize(peer.Username)
	w := min(60, m.width-4)
	inner := w - 4
	changed := m.safetyChanged(peer)

	own, err := publicKeyOf(m.user.PrivateKey)
	var code []string

	if err == nil {
		code, err = safetyCode(own, peer.PublicKey)
	}

	var lines []string

	if err != nil {
		lines = append(lines, seg(clip(err.Error(), inner), p.danger, bg))
	} else {
		lines = append(lines,
			"",
			center(bold(strings.Join(code[:4], "  "), p.accent, bg), inner, bg),
			center(bold(strings.Join(code[4:], "  "), p.accent, bg), inner, bg),
			"",
		)
	}

	lines = append(lines, "")

	for _, line := range wrap("Compare it with the code @"+name+" sees for this chat, in person or over another app. If both are the same, your messages are readable only by the two of you.", inner) {
		lines = append(lines, seg(line, p.textSoft, bg))
	}

	if changed {
		lines = append(lines, "")

		for _, line := range wrap("The security key of @"+name+" has changed. That happens when they set up encryption again, but it can also mean someone is trying to read the chat. Write only after you have compared the codes.", inner) {
			lines = append(lines, seg(line, p.danger, bg))
		}

		lines = append(lines, "", zone.Mark("safety:confirm", m.button("The codes are the same (y)", inner, true, true)))
	}

	lines = append(lines, "", zone.Mark("safety:close", m.button("Close (Esc)", inner, false, true)))

	title := "Safety code with @" + name

	if changed {
		title = "! " + title
	}

	return zone.Mark("safety", m.box(clip(title, w-6), lines, w))
}
