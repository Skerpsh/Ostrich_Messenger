package main

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	zone "github.com/lrstanley/bubblezone"
)

// Drawing the open chat: its header, the messages one after another (who
// and when on a line, then what they wrote), what is going on (a reply, a
// warning), the line to write in. No bubbles and no fills: the left bar
// marks the chosen message.

// Messages of one sender closer than this go under one name.
const groupGap = 5 * time.Minute

// lineMeta tells what a line of the messages area shows: a message
// (index; -1 for separators) and whether it is the quote of a reply.
type lineMeta struct {
	message int
	quote   bool
}

type chatLinesResult struct {
	text []string
	meta []lineMeta
}

// chatLines draws all loaded messages for a chat of width w.
func (m model) chatLines(w int) chatLinesResult {
	c := m.chat
	p := m.pal
	bg := p.bg
	chat, _ := m.chatByID(c.id)
	var out chatLinesResult

	add := func(line string, meta lineMeta) {
		out.text = append(out.text, line)
		out.meta = append(out.meta, meta)
	}

	separator := lineMeta{message: -1}
	label := func(text string, fg lipgloss.Color) string {
		text = " " + text + " "
		side := max((w-2-width(text))/2, 1)
		return blank(1, bg) + seg(strings.Repeat("─", side), p.line, bg) + seg(text, fg, bg) +
			seg(strings.Repeat("─", max(w-2-side-width(text), 1)), p.line, bg) + blank(1, bg)
	}

	unread := m.unreadLine()
	shown := m.shown()

	for i, message := range shown {
		var prev *Message

		if i > 0 {
			prev = &shown[i-1]
		}

		at := parseTime(&message.CreatedAt)
		newDay := prev == nil || at == nil || dayOf(parseTime(&prev.CreatedAt)) != dayOf(at)

		if newDay {
			if i > 0 {
				add(blank(w, bg), separator)
			}

			add(label(formatDayLabel(message.CreatedAt), p.muted), separator)
		}

		if i == unread {
			add(label("New messages", p.accent), separator)
		}

		if message.Kind == "system" {
			add(blank(w, bg), separator)
			text := clip(sanitize(systemText(message.SenderID, message.SenderUsername, message.Content, m.user.User.ID)), w-4)
			add(center(italic(text, p.muted, bg), w, bg), lineMeta{message: i})

			continue
		}

		grouped := !newDay && i != unread && prev != nil && prev.SenderID == message.SenderID &&
			prev.Kind != "system" && at != nil && at.Sub(*parseTime(&prev.CreatedAt)) < groupGap

		if !grouped {
			add(blank(w, bg), separator)
		}

		// Under one name, the time shows again only when it is another.
		quiet := grouped && formatTime(prev.CreatedAt) == formatTime(message.CreatedAt)

		for _, line := range m.bubble(chat, message, grouped, quiet, w) {
			add(line.text, lineMeta{message: i, quote: line.quote})
		}
	}

	return out
}

func dayOf(t *time.Time) string {
	if t == nil {
		return ""
	}

	return t.Local().Format("2006-01-02")
}

type bubbleLine struct {
	text  string
	quote bool
}

// bubble draws one message in w cells: the bar (chosen or found), a
// space, the lines.
func (m model) bubble(chat Chat, message Message, grouped, quiet bool, w int) []bubbleLine {
	c := m.chat
	p := m.pal
	own := message.SenderID == m.user.User.ID
	sending := m.outgoingState(message.ID)
	read := own && chat.PeerLastReadAt != nil && !later(&message.CreatedAt, chat.PeerLastReadAt)

	var reactions []string

	for _, r := range message.Reactions {
		reactions = append(reactions, r.Emoji+r.UserID)
	}

	edited := ""

	if message.EditedAt != nil {
		edited = *message.EditedAt
	}

	key := strings.Join([]string{
		message.ID, message.Content, edited, strings.Join(reactions, ","),
		fmt.Sprint(read, w, grouped, quiet, p.mode, p.terminal, p.accent, chat.PublicKey, sending), m.letterKey(message.ID),
	}, "|")

	body, ok := c.cache[key]

	if !ok {
		body = m.drawMessage(chat, message, own, read, grouped, quiet, sending, w-3)
		c.cache[key] = body
	}

	bar := blank(1, p.bg)

	switch {
	case c.selecting && c.selectedID == message.ID:
		bar = seg("▌", p.accent, p.bg)
	case c.highlight == message.ID:
		bar = seg("▌", p.muted, p.bg)
	}

	lines := make([]bubbleLine, len(body))
	quoteLine := -1

	if message.ReplyTo != nil {
		// The quote: under the name, unless grouped.
		quoteLine = 1

		if grouped {
			quoteLine = 0
		}
	}

	for i, line := range body {
		lines[i] = bubbleLine{text: bar + blank(1, p.bg) + fitLine(line, w-3, p.bg) + blank(1, p.bg), quote: i == quoteLine}
	}

	return lines
}

// drawMessage: "name ... 14:05 ✓✓", then the message, in w cells. A
// message under the previous one's name has its time on its first line,
// where it fits.
func (m model) drawMessage(chat Chat, message Message, own, read, grouped, quiet bool, sending string, w int) []string {
	p := m.pal
	bg := p.bg
	shown := m.show(chat, message.ID, message.SenderID, message.Content)
	text, status := sanitize(shown.text), shown.status

	// edited · 14:05 ✓✓
	var info []string

	if status == decryptPlain {
		info = append(info, "not encrypted")
	}

	if status == decryptOK && isLegacyMessage(message.Content) {
		info = append(info, "old format, sender not verified")
	}

	if message.EditedAt != nil {
		info = append(info, "edited")
	}

	info = append(info, formatTime(message.CreatedAt))
	meta := seg(strings.Join(info, " · "), p.muted, bg)

	switch {
	case sending == "failed":
		meta += blank(1, bg) + bold("! not sent", p.danger, bg)
	case sending != "":
		meta += seg(" sending…", p.muted, bg)
	case own && chat.Type != "saved" && read:
		meta += seg(" ✓✓", p.accent, bg)
	case own && chat.Type != "saved":
		meta += seg(" ✓", p.muted, bg)
	}

	var lines []string

	if !grouped {
		name := bold("you", p.accent, bg)

		if !own {
			sender := sanitize(m.memberName(message.SenderID, message.SenderUsername))

			if chat.Type != "group" {
				sender = sanitize(m.chatName(chat))
			}

			name = bold(clip(sender, w-width(meta)-2), avatarColor(sender), bg)
		}

		lines = append(lines, row(name, meta, w, bg))
	}

	dim := func(s string) string { return seg(clip(s, w), p.muted, bg) }

	if reply := message.ReplyTo; reply != nil {
		quote := oneLine(sanitize(plainText(m.textOf(chat, reply.ID, reply.SenderID, reply.Content))))
		lines = append(lines, dim("↳ "+m.quoteSender(reply)+": "+quote))
	}

	if shown.forwardedFrom != "" {
		lines = append(lines, italic(clip("forwarded from @"+sanitize(shown.forwardedFrom), w), p.muted, bg))
	}

	for _, a := range shown.attachments {
		if isVoice(a) {
			label := "voice message · " + formatDuration(a.Duration)
			lines = append(lines, seg("▪ ", p.accent, bg)+seg(clip(label, w-2), p.text, bg)+blank(1, bg)+
				seg(waveform(a.Waveform, min(w-3-width(label), 24)), p.muted, bg))
			continue
		}

		lines = append(lines, seg("▪ ", p.accent, bg)+seg(clip(sanitize(a.Name), w-14), p.text, bg)+seg(" · "+formatSize(a.Size), p.muted, bg))
	}

	if l := shown.link; l != nil {
		// The address's own host, not only the name the sender's app put in.
		site := l.URL

		if u, err := url.Parse(l.URL); err == nil && u.Hostname() != "" {
			site = strings.TrimPrefix(u.Hostname(), "www.")
		}

		line := seg("▪ ", p.accent, bg) + seg(clip(sanitize(site), w-2), p.text, bg)

		if title := sanitize(l.Title); title != "" {
			line += seg(clip(" — "+title, max(w-2-width(site), 0)), p.muted, bg)
		}

		lines = append(lines, line)
	}

	if message.SentAfterDays != nil {
		for _, part := range wrap(sentAutomatically(message), w) {
			lines = append(lines, seg(part, p.accent, bg))
		}
	}

	if shown.sealed != nil && shown.opened {
		lines = append(lines, seg(clip(openedNote(*shown.sealed), w), p.accent, bg))
	}

	switch {
	case status == decryptOK && shown.sealed != nil && !shown.opened:
		for i, line := range m.envelopeLines(message.ID, *shown.sealed, message.DeliverAt != nil) {
			for _, part := range wrap(line, w) {
				if i == 0 {
					lines = append(lines, bold(part, p.accent, bg))
				} else {
					lines = append(lines, seg(part, p.muted, bg))
				}
			}
		}
	case status == decryptOK && shown.call != nil:
		lines = append(lines, italic(clip(callText(*shown.call, own), w), p.muted, bg))
	case status == decryptOK && strings.TrimSpace(text) == "" && len(shown.attachments) > 0:
		// Only files.
	case status == decryptOK:
		lines = append(lines, markupLines(text, w, p.text, bg, bg, p.accent)...)
	case status == decryptFailed:
		for _, part := range wrap(text, w) {
			lines = append(lines, italic(part, p.muted, bg))
		}
	default:
		for _, part := range wrap(text, w) {
			lines = append(lines, seg(part, p.text, bg))
		}
	}

	if status == decryptOK && shown.heir != "" {
		for i, line := range heirLines(shown.heir, own, sanitize(message.SenderUsername)) {
			for _, part := range wrap(line, w) {
				if i == 2 {
					lines = append(lines, seg(part, p.muted, bg))
				} else {
					lines = append(lines, bold(part, p.accent, bg))
				}
			}
		}
	}

	if len(message.Reactions) > 0 {
		lines = append(lines, m.reactionChips(message.Reactions, p.text, bg))
	}

	// Under the previous one's name: the time where it fits on the first
	// line, else on a line of its own; not at all when it is the same and
	// there is nothing else to say.
	if grouped && quiet && sending == "" && len(info) == 1 {
		return lines
	}

	if grouped {
		switch {
		case len(lines) == 0:
			lines = append(lines, alignRight(meta, w, bg))
		case width(lines[0])+width(meta)+2 <= w:
			lines[0] = row(lines[0], meta, w, bg)
		default:
			lines = append(lines, alignRight(meta, w, bg))
		}
	}

	return lines
}

// reactionChips: "👍 2  🔥", the user's own in the accent.
func (m model) reactionChips(reactions []Reaction, fg, bg lipgloss.Color) string {
	counts := map[string]int{}
	mine := map[string]bool{}
	var order []string

	for _, r := range reactions {
		if counts[r.Emoji] == 0 {
			order = append(order, r.Emoji)
		}

		counts[r.Emoji]++

		if r.UserID == m.user.User.ID {
			mine[r.Emoji] = true
		}
	}

	var chips []string

	for _, emoji := range order {
		label := emoji

		if counts[emoji] > 1 {
			label += fmt.Sprintf(" %d", counts[emoji])
		}

		if mine[emoji] {
			chips = append(chips, bold(label, m.pal.accent, bg))
		} else {
			chips = append(chips, seg(label, fg, bg))
		}
	}

	return strings.Join(chips, blank(2, bg))
}

// --- around the messages ---

// chatBanners are the lines between the messages and the input: warnings,
// what is being done (a reply, an edit, files).
func (m model) chatBanners(chat Chat, w int) []string {
	c := m.chat
	p := m.pal
	bg := p.bg
	var lines []string

	note := func(prefix string, prefixFg lipgloss.Color, text string, textFg lipgloss.Color) string {
		return fitLine(blank(1, bg)+bold(prefix, prefixFg, bg)+seg(clip(text, w-2-width(prefix)), textFg, bg), w, bg)
	}

	cancel := zone.Mark("chat:cancel", seg("Esc cancel ", p.muted, bg))

	switch {
	case chat.Type == "group" && m.groupDistrusted[chat.ID] && m.groupKeyOf(chat.ID, chat.KeyEpoch) == nil:
		lines = append(lines, note("! ", p.danger, "The group's key came from someone whose security key has changed: compare safety codes (Ctrl+G)", p.danger))
	case chat.Type == "group" && m.groupKeyOf(chat.ID, chat.KeyEpoch) == nil:
		lines = append(lines, note("", p.muted, "Loading the group's key…", p.muted))
	case chat.Type != "group" && chat.PublicKey == "" && !chat.Blocked:
		lines = append(lines, note("", p.muted, "@"+sanitize(chat.Username)+" has not set up end-to-end encryption yet", p.muted))
	}

	if chat.Type != "group" && m.keyChanged[chat.UserID] {
		lines = append(lines, zone.Mark("chat:keywarning", note("! ", p.danger,
			"The security key of @"+sanitize(chat.Username)+" has changed. Compare the safety code: Ctrl+K", p.text)))
	}

	if names := m.mentionSuggestions(chat); len(names) > 0 {
		hint := blank(1, bg) + seg("Tab ", p.accent, bg)

		for _, name := range names {
			hint += seg("@"+sanitize(name), p.text, bg) + blank(2, bg)
		}

		lines = append(lines, fitLine(hint, w, bg))
	}

	if c.err != "" {
		lines = append(lines, zone.Mark("chat:error", note("! ", p.danger, sanitize(c.err), p.danger)))
	}

	if c.attaching {
		lines = append(lines, fitLine(blank(1, bg)+bold("File: ", p.accent, bg)+fitLine(onBackground(c.attach.View(), bg), w-8, bg), w, bg))
	}

	for i, file := range c.picked {
		status := formatSize(file.size)

		if c.uploading {
			status = "uploading…"
		}

		left := blank(1, bg) + seg("▪ ", p.accent, bg) + seg(clip(sanitize(file.name), w/2), p.text, bg) + seg("  "+status, p.muted, bg)
		lines = append(lines, row(left, zone.Mark(fmt.Sprintf("chat:unpick:%d", i), seg("remove ", p.muted, bg)), w, bg))
	}

	if c.editing != nil {
		text := oneLine(sanitize(m.textOf(chat, c.editing.ID, c.editing.SenderID, c.editing.Content)))
		lines = append(lines, row(blank(1, bg)+bold("Editing  ", p.accent, bg)+seg(clip(text, w-24), p.muted, bg), cancel, w, bg))
	}

	if s := c.sealing; s != nil {
		kind := "Sealed letter"

		if s.surprise {
			kind = "Surprise letter"
		}

		lines = append(lines, row(blank(1, bg)+bold(kind+"  ", p.accent, bg)+seg("opens "+s.opensAt.Format("02.01.2006 15:04"), p.muted, bg),
			zone.Mark("chat:unseal", seg("Esc cancel ", p.muted, bg)), w, bg))
	}

	if c.replyTo != nil {
		name := "yourself"

		if c.replyTo.SenderID != m.user.User.ID {
			name = sanitize(c.replyTo.SenderUsername)
		}

		text := oneLine(sanitize(m.textOf(chat, c.replyTo.ID, c.replyTo.SenderID, c.replyTo.Content)))
		lines = append(lines, row(blank(1, bg)+bold("Replying to "+name+"  ", p.accent, bg)+seg(clip(text, w-30), p.muted, bg), cancel, w, bg))
	}

	return lines
}

// chatChromeHeight is everything of the chat except the messages area.
func (m model) chatChromeHeight() int {
	c := m.chat
	chat, _ := m.chatByID(c.id)
	h := 2 // the header and its rule

	if chat.PinnedMessage != nil {
		h++
	}

	if c.searching {
		h += 2
	}

	h += len(m.chatBanners(chat, m.paneWidth()))

	// The rule, then the input (or what replaces it).
	if chat.Blocked {
		return h + 2
	}

	return h + 1 + c.composer.Height()
}

func (m model) chatView(w, h int) string {
	c := m.chat
	p := m.pal
	bg := p.bg
	chat, _ := m.chatByID(c.id)
	var lines []string

	lines = append(lines, m.chatHeader(chat, w)...)

	if pinned := chat.PinnedMessage; pinned != nil {
		text := oneLine(sanitize(plainText(m.textOf(chat, pinned.ID, pinned.SenderID, pinned.Content))))
		lines = append(lines, zone.Mark("chat:pinned", fitLine(blank(1, bg)+bold("Pinned  ", p.accent, bg)+seg(clip(text, w-10), p.textSoft, bg), w, bg)))
	}

	if c.searching {
		lines = append(lines, m.chatSearchBar(w), seg(strings.Repeat("─", w), p.line, bg))
	}

	area := m.chatAreaHeight()
	var messages string

	switch {
	case !c.loaded:
		messages = strings.Repeat("\n", area/2) + center(seg("Loading…", p.muted, bg), w, bg)
	case len(m.shown()) == 0:
		messages = strings.Repeat("\n", max(area/2-1, 0)) +
			center(bold("No messages yet", p.text, bg), w, bg) + "\n" + center(seg(m.sayHi(chat), p.muted, bg), w, bg)
	default:
		all := m.chatLines(w)
		start, end := m.chatWindow(len(all.text))
		visible := all.text[start:end]

		// Few messages: they sit at the bottom.
		for len(visible) < area {
			visible = append([]string{blank(w, bg)}, visible...)
		}

		messages = strings.Join(visible, "\n")
	}

	lines = append(lines, zone.Mark("chat:messages", fitBlock(messages, w, area, bg)))
	lines = append(lines, m.chatBanners(chat, w)...)
	lines = append(lines, m.composerView(chat, w)...)

	return fitBlock(strings.Join(lines, "\n"), w, h, bg)
}

// chatHeader: the name and how they are (online, typing, members), then
// the rule.
func (m model) chatHeader(chat Chat, w int) []string {
	c := m.chat
	p := m.pal
	bg := p.bg

	left := blank(1, bg)

	if !m.wide() {
		left = zone.Mark("chat:back", seg(" ‹ ", p.accent, bg))
	}

	// Clicked: the group's screen, or the chat's menu.
	name := bold(sanitize(m.listTitle(chat)), p.text, bg)

	if chat.Type == "group" {
		name = zone.Mark("chat:groupinfo", name)
	} else {
		name = zone.Mark("chat:menu", name)
	}

	var status string

	switch {
	case m.connStatus != connOnline:
		status = ""
	case m.isTyping(c.id):
		status = seg(m.typingText(chat), p.accent, bg)
	case chat.Type == "group":
		status = seg(m.membersText(chat), p.muted, bg)
	case chat.Type == "saved":
		status = seg("only you", p.muted, bg)
	case m.presence[chat.UserID].online:
		status = seg("online", p.online, bg)
	default:
		pr := m.presence[chat.UserID]
		status = seg(formatPresence(&pr, time.Now()), p.muted, bg)
	}

	var marks []string

	if chat.Pinned {
		marks = append(marks, "pinned")
	}

	if chat.Muted {
		marks = append(marks, "muted")
	}

	if chat.Type != "group" && chat.Type != "saved" && m.keyChanged[chat.UserID] {
		status += seg("  key changed", p.danger, bg)
	}

	if len(marks) > 0 {
		status += seg("  "+strings.Join(marks, " · "), p.muted, bg)
	}

	return []string{
		row(left+name, status+blank(1, bg), w, bg),
		seg(strings.Repeat("─", w), p.line, bg),
	}
}

func (m model) chatSearchBar(w int) string {
	c := m.chat
	p := m.pal
	bg := p.bg
	matches := m.matches()
	count := ""

	switch {
	case strings.TrimSpace(c.search.Value()) == "":
	case len(matches) == 0:
		count = "no matches"
	default:
		count = fmt.Sprintf("%d of %d", c.matchIndex+1, len(matches))
	}

	right := seg(count, p.muted, bg)

	if c.hasMore {
		label := "  load older (Ctrl+L)"

		if c.loadingOlder {
			label = "  loading…"
		}

		right += zone.Mark("chat:older", seg(label, p.accent, bg))
	}

	right += blank(1, bg)
	box := bold(" Search  ", p.accent, bg) + fitLine(onBackground(c.search.View(), bg), max(w-width(right)-10, 4), bg)

	return row(box, right, w, bg)
}

// composerView: the rule, then "> " and what is being written; or what
// replaces it when either has blocked the other.
func (m model) composerView(chat Chat, w int) []string {
	c := m.chat
	p := m.pal
	bg := p.bg
	rule := seg(strings.Repeat("─", w), p.line, bg)

	if chat.Blocked {
		text := "You can't message @" + sanitize(chat.Username)

		if chat.BlockedByMe {
			text = "You blocked @" + sanitize(chat.Username) + ". Unblock: Ctrl+O"
		}

		return []string{rule, zone.Mark("chat:unblock", fitLine(seg(" "+text, p.muted, bg), w, bg))}
	}

	prompt := "> "

	if c.editing != nil {
		prompt = "✎ "
	}

	var box []string

	for i, line := range strings.Split(onBackground(c.composer.View(), bg), "\n") {
		lead := blank(3, bg)

		if i == 0 {
			lead = blank(1, bg) + bold(prompt, p.accent, bg)
		}

		box = append(box, lead+fitLine(line, w-3, bg))
	}

	return []string{rule, zone.Mark("chat:composer", strings.Join(box, "\n"))}
}
