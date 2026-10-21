package main

import (
	"fmt"
	"net/url"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	zone "github.com/lrstanley/bubblezone"
)

// "What the server sees" of a message or a chat: the rows the server keeps,
// fetched when opened, next to what stays inside the encryption (like the
// app's features/chat/server-view.tsx).

type messageServerView struct {
	Message struct {
		ID             string  `json:"id"`
		SenderUsername string  `json:"sender_username"`
		Kind           string  `json:"kind"`
		Content        string  `json:"content"`
		ContentLength  int     `json:"content_length"`
		ReplyToID      *string `json:"reply_to_id"`
		CreatedAt      string  `json:"created_at"`
		EditedAt       *string `json:"edited_at"`
	} `json:"message"`
	Attachments []struct {
		Size int64 `json:"size"`
	} `json:"attachments"`
	Reactions []struct {
		Emoji  string `json:"emoji"`
		UserID string `json:"user_id"`
	} `json:"reactions"`
	Mentions []string `json:"mentions"`
}

type chatServerView struct {
	Chat struct {
		ID              string  `json:"id"`
		Type            string  `json:"type"`
		CreatedAt       string  `json:"created_at"`
		UpdatedAt       string  `json:"updated_at"`
		EncryptedInfo   *string `json:"encrypted_info"`
		KeyEpoch        int     `json:"key_epoch"`
		PinnedMessageID *string `json:"pinned_message_id"`
	} `json:"chat"`
	Members []struct {
		Username string `json:"username"`
		Role     string `json:"role"`
		JoinedAt string `json:"joined_at"`
	} `json:"members"`
	Me struct {
		LastReadAt string  `json:"last_read_at"`
		PinnedAt   *string `json:"pinned_at"`
		Muted      bool    `json:"muted"`
		ClearedAt  *string `json:"cleared_at"`
	} `json:"me"`
	Stats struct {
		Messages     int   `json:"messages"`
		Files        int   `json:"files"`
		FileBytes    int64 `json:"file_bytes"`
		GroupKeys    int   `json:"group_keys"`
		InviteLink   bool  `json:"invite_link"`
		JoinRequests int   `json:"join_requests"`
	} `json:"stats"`
}

func getMessageServerView(token, chatID, messageID string) (messageServerView, error) {
	var view messageServerView
	err := authorizedGet(token, "/api/chats/"+url.PathEscape(chatID)+"/messages/"+url.PathEscape(messageID)+"/server-view", &view)

	return view, err
}

func getChatServerView(token, chatID string) (chatServerView, error) {
	var view chatServerView
	err := authorizedGet(token, "/api/chats/"+url.PathEscape(chatID)+"/server-view", &view)

	return view, err
}

type serverViewRow struct {
	label, value string
	// Not encrypted: the server can read it.
	readable bool
}

type serverViewState struct {
	isChat  bool
	loading bool
	err     string
	rows    []serverViewRow
	hidden  []string
	// Reactions are stored as they are.
	readable bool
	// Lines scrolled past, when the card is taller than the terminal.
	scroll int
}

// The start of a long ciphertext.
const serverViewCiphertext = 96

func serverViewTime(iso string) string {
	if t, ok := localTime(iso); ok {
		return t.Format("02.01.2006 15:04:05")
	}

	return "—"
}

func shortCiphertext(text string) string {
	if len(text) <= serverViewCiphertext {
		return text
	}

	return text[:serverViewCiphertext] + "…"
}

func (m *model) openMessageServerView(chat Chat, message Message) tea.Cmd {
	m.menu = nil
	m.serverView = &serverViewState{loading: true}
	shown := m.show(chat, message.ID, message.SenderID, message.Content)
	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		view, err := getMessageServerView(token, chat.ID, message.ID)

		return func(m *model) tea.Cmd {
			if m.serverView == nil {
				return nil
			}

			if err != nil {
				m.serverView = &serverViewState{err: err.Error()}
				return m.fail(err)
			}

			m.serverView = messageServerViewState(view, shown)

			return nil
		}
	})
}

func messageServerViewState(view messageServerView, shown shownMessage) *serverViewState {
	msg := view.Message
	s := &serverViewState{}
	s.rows = append(s.rows,
		serverViewRow{label: "Sender", value: "@" + msg.SenderUsername},
		serverViewRow{label: "Sent", value: serverViewTime(msg.CreatedAt)},
	)

	if msg.EditedAt != nil {
		s.rows = append(s.rows, serverViewRow{label: "Edited", value: serverViewTime(*msg.EditedAt)})
	}

	if msg.Kind == "system" {
		s.rows = append(s.rows, serverViewRow{label: "Content (written by the server)", value: msg.Content, readable: true})
	} else {
		s.rows = append(s.rows, serverViewRow{label: fmt.Sprintf("Content, encrypted (%d characters)", msg.ContentLength), value: shortCiphertext(msg.Content)})
	}

	if msg.ReplyToID != nil {
		s.rows = append(s.rows, serverViewRow{label: "Replies to the message", value: *msg.ReplyToID})
	}

	if n := len(view.Attachments); n > 0 {
		sizes := make([]string, n)

		for i, file := range view.Attachments {
			sizes[i] = formatSize(file.Size)
		}

		label := "An encrypted file"

		if n > 1 {
			label = fmt.Sprintf("%d encrypted files", n)
		}

		s.rows = append(s.rows, serverViewRow{label: label, value: strings.Join(sizes, ", ")})
	}

	for _, reaction := range view.Reactions {
		s.rows = append(s.rows, serverViewRow{label: "Reaction", value: reaction.Emoji + "  " + reaction.UserID, readable: true})
		s.readable = true
	}

	if len(view.Mentions) > 0 {
		s.rows = append(s.rows, serverViewRow{label: "Mentions", value: strings.Join(view.Mentions, "\n")})
	}

	s.rows = append(s.rows, serverViewRow{label: "Message id", value: msg.ID})

	if msg.Kind == "system" {
		return s
	}

	if shown.status != decryptOK {
		s.hidden = []string{"Everything inside: not even this computer can decrypt it"}
		return s
	}

	voice := 0

	for _, a := range shown.attachments {
		if isVoice(a) {
			voice++
		}
	}

	if shown.text != "" {
		s.hidden = append(s.hidden, "The text")
	}

	if len(shown.attachments) > voice {
		s.hidden = append(s.hidden, "The files' names, types, contents and pictures' sizes")
	}

	if voice > 0 {
		s.hidden = append(s.hidden, "The voice recording and its waveform")
	}

	if shown.link != nil {
		s.hidden = append(s.hidden, "The link and its preview")
	}

	if shown.forwardedFrom != "" {
		s.hidden = append(s.hidden, "Who it was forwarded from")
	}

	if msg.ReplyToID != nil {
		s.hidden = append(s.hidden, "The text it quotes")
	}

	if shown.call != nil {
		s.hidden = append(s.hidden, "How the call went and how long it lasted")
	}

	return s
}

func (m *model) openChatServerView(chat Chat) tea.Cmd {
	m.menu = nil
	m.serverView = &serverViewState{isChat: true, loading: true}
	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		view, err := getChatServerView(token, chat.ID)

		return func(m *model) tea.Cmd {
			if m.serverView == nil {
				return nil
			}

			if err != nil {
				m.serverView = &serverViewState{isChat: true, err: err.Error()}
				return m.fail(err)
			}

			m.serverView = chatServerViewState(view)

			return nil
		}
	})
}

func chatServerViewState(view chatServerView) *serverViewState {
	c := view.Chat
	group := c.Type == "group"
	kind := "Direct chat"

	switch c.Type {
	case "group":
		kind = "Group"
	case "saved":
		kind = "Saved messages"
	}

	members := make([]string, len(view.Members))

	for i, member := range view.Members {
		members[i] = "@" + member.Username

		if group {
			members[i] += " · " + member.Role + " · since " + serverViewTime(member.JoinedAt)
		}
	}

	membersLabel := "Members"

	if group {
		membersLabel = fmt.Sprintf("%d members", len(view.Members))
	}

	s := &serverViewState{isChat: true}
	s.rows = []serverViewRow{
		{label: "Kind", value: kind},
		{label: "Created", value: serverViewTime(c.CreatedAt)},
		{label: "Last activity", value: serverViewTime(c.UpdatedAt)},
		{label: membersLabel, value: strings.Join(members, "\n")},
		{label: "Stored", value: fmt.Sprintf("%d messages · %d files (%s)", view.Stats.Messages, view.Stats.Files, formatSize(view.Stats.FileBytes))},
	}

	if group && c.EncryptedInfo != nil {
		s.rows = append(s.rows, serverViewRow{label: "Name and photo, encrypted", value: shortCiphertext(*c.EncryptedInfo)})
	}

	if group {
		invite := "off"

		if view.Stats.InviteLink {
			invite = fmt.Sprintf("on · %d join requests", view.Stats.JoinRequests)
		}

		s.rows = append(s.rows,
			serverViewRow{label: "Group key", value: fmt.Sprintf("version %d · %d encrypted copies, one per member and version", c.KeyEpoch, view.Stats.GroupKeys)},
			serverViewRow{label: "Invite link", value: invite},
		)
	}

	if c.PinnedMessageID != nil {
		s.rows = append(s.rows, serverViewRow{label: "Pinned message", value: *c.PinnedMessageID})
	}

	settings := []string{"read up to " + serverViewTime(view.Me.LastReadAt)}

	if view.Me.PinnedAt != nil {
		settings = append(settings, "pinned to top")
	}

	if view.Me.Muted {
		settings = append(settings, "muted")
	}

	if view.Me.ClearedAt != nil {
		settings = append(settings, "history cleared "+serverViewTime(*view.Me.ClearedAt))
	}

	s.rows = append(s.rows,
		serverViewRow{label: "Your settings here", value: strings.Join(settings, " · ")},
		serverViewRow{label: "Chat id", value: c.ID},
	)

	s.hidden = []string{"Every message's text, files, voice messages and link previews"}

	if group {
		s.hidden = append(s.hidden, "The group's name and photo")
	}

	s.hidden = append(s.hidden,
		"The chat's wallpaper and color",
		"Call audio and video",
		"The keys: they are made and kept on your devices",
	)

	return s
}

func (m *model) updateServerViewKey(msg tea.KeyMsg) tea.Cmd {
	page := max(m.height/2, 1)

	switch msg.String() {
	case "esc", "enter", "q", "s":
		m.serverView = nil
	case "up", "k":
		m.scrollServerView(-1)
	case "down", "j":
		m.scrollServerView(1)
	case "pgup":
		m.scrollServerView(-page)
	case "pgdown":
		m.scrollServerView(page)
	}

	return nil
}

// scrollServerView moves the card's lines by delta, within them.
func (m *model) scrollServerView(delta int) {
	_, inner := m.serverViewWidth()
	lines := len(m.serverViewLines(inner))
	m.serverView.scroll = max(min(m.serverView.scroll+delta, lines-m.serverViewRoom()), 0)
}

func (m model) serverViewWidth() (w, inner int) {
	w = min(72, m.width-4)

	return w, w - 4
}

// serverViewRoom: the lines of the card that fit above its button.
func (m model) serverViewRoom() int {
	return max(m.height-6, 3)
}

func (m *model) updateServerViewMouse(msg tea.MouseMsg) tea.Cmd {
	switch {
	case msg.Button == tea.MouseButtonWheelUp:
		m.scrollServerView(-1)
	case msg.Button == tea.MouseButtonWheelDown:
		m.scrollServerView(1)
	case clicked(msg, "serverview:close"):
		m.serverView = nil
	case msg.Action == tea.MouseActionPress && !zone.Get("serverview").InBounds(msg):
		m.serverView = nil
	}

	return nil
}

func (m model) serverViewView() string {
	p := m.pal
	bg := p.panel
	w, inner := m.serverViewWidth()
	lines := m.serverViewLines(inner)

	// Taller than the terminal: scrolled, with the button kept below.
	footer := []string{"", zone.Mark("serverview:close", m.button("Close (Esc)", inner, false, true))}

	if room := m.serverViewRoom(); len(lines) > room {
		top := max(min(m.serverView.scroll, len(lines)-room), 0)
		lines = append(lines[top:top+room-1], seg(clip("↑↓ scroll", inner), p.muted, bg))
	}

	return zone.Mark("serverview", m.card(append(lines, footer...), w))
}

func (m model) serverViewLines(inner int) []string {
	p := m.pal
	bg := p.panel
	s := m.serverView

	about := "This message exactly as the server stores it, fetched from it just now."

	if s.isChat {
		about = "This chat exactly as the server stores it, fetched from it just now."
	}

	lines := []string{seg("🗄  ", p.accent, bg) + bold("What the server sees", p.text, bg), ""}

	for _, line := range wrap(about, inner) {
		lines = append(lines, seg(line, p.textSoft, bg))
	}

	lines = append(lines, "")

	switch {
	case s.loading:
		lines = append(lines, seg("Loading…", p.muted, bg))
	case s.err != "":
		for _, line := range wrap(s.err, inner) {
			lines = append(lines, seg(line, p.danger, bg))
		}
	default:
		lines = append(lines, bold("THE SERVER KNOWS", p.muted, bg))

		for _, row := range s.rows {
			label, color := row.label, p.muted

			if row.readable {
				label, color = label+" · readable", p.danger
			}

			lines = append(lines, seg(clip(label, inner), color, bg))

			for _, line := range wrap(sanitize(row.value), inner-2) {
				lines = append(lines, seg("  "+line, p.text, bg))
			}
		}

		if len(s.hidden) > 0 {
			lines = append(lines, "", bold("ONLY THE CHAT CAN READ", p.muted, bg))

			for _, item := range s.hidden {
				for i, line := range wrap(item, inner-3) {
					prefix := "   "

					if i == 0 {
						prefix = seg("🔒 ", p.online, bg)
					}

					lines = append(lines, prefix+seg(line, p.text, bg))
				}
			}
		}

		lines = append(lines, "")

		if s.readable {
			for _, line := range wrap("Reactions are not encrypted: the server keeps the emoji and who chose it.", inner) {
				lines = append(lines, seg(line, p.textSoft, bg))
			}
		}

		for _, line := range wrap("While you are connected the server also sees your IP address, and its request logs record it. It does not see your OstrichID, your private key or anything in the encrypted parts above.", inner) {
			lines = append(lines, seg(line, p.textSoft, bg))
		}
	}

	return lines
}
