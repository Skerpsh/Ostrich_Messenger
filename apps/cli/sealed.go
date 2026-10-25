package main

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"filippo.io/age/armor"
	"github.com/drand/drand/v2/crypto"
	"github.com/drand/kyber"
	"github.com/drand/tlock"
)

// Sealed letters, like the app's (apps/mobile-web/src/features/chat/sealed.ts):
// a message's real payload time-locked to a round of drand's quicknet
// (https://drand.love) with tlock, inside the usual end-to-end encryption.
// Nobody can open it before the round: the round's signature, published
// by drand then, is its key. Signatures come through the server
// (/api/drand), which cannot make one up: tlock checks it against
// quicknet's public key below.

const (
	quicknetHash      = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
	quicknetPublicKey = "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a"
	quicknetScheme    = "bls-unchained-g1-rfc9380"
	quicknetGenesis   = 1692803367
	quicknetPeriod    = 3

	// The longest a letter can be sealed for.
	maxSealYears = 10
	// The text older clients show instead.
	sealedFallback = "A sealed letter"
)

type sealedLetter struct {
	Round uint64
	// tlock's armored age file of the encoded payload.
	Box string
	// Sent as a surprise: the server kept it from the others until then.
	Surprise bool
}

type wireSealed struct {
	R uint64 `json:"r"`
	B string `json:"b"`
	S bool   `json:"s,omitempty"`
}

func readSealed(z wireSealed) *sealedLetter {
	if z.R < 1 || len(z.B) > 40000 || !strings.HasPrefix(z.B, armor.Header) {
		return nil
	}

	return &sealedLetter{Round: z.R, Box: z.B, Surprise: z.S}
}

// roundAt: the first round published at or after t.
func roundAt(t time.Time) uint64 {
	seconds := float64(t.UnixMilli())/1000 - quicknetGenesis

	return uint64(math.Max(math.Ceil(seconds/quicknetPeriod), 0)) + 1
}

// openingTime: when the round is published.
func openingTime(round uint64) time.Time {
	return time.Unix(quicknetGenesis+int64(round-1)*quicknetPeriod, 0)
}

// quicknet is tlock's view of the network: its key built in, signatures
// fetched with the user's token.
type quicknet struct {
	token     string
	scheme    *crypto.Scheme
	publicKey kyber.Point
}

func newQuicknet(token string) (*quicknet, error) {
	scheme, err := crypto.SchemeFromName(quicknetScheme)
	if err != nil {
		return nil, err
	}

	raw, err := hex.DecodeString(quicknetPublicKey)
	if err != nil {
		return nil, err
	}

	publicKey := scheme.KeyGroup.Point()

	if err := publicKey.UnmarshalBinary(raw); err != nil {
		return nil, err
	}

	return &quicknet{token: token, scheme: scheme, publicKey: publicKey}, nil
}

func (q *quicknet) ChainHash() string { return quicknetHash }

// Current: the server's clock says whether a round has come (it refuses
// the ones that have not), not this computer's.
func (q *quicknet) Current(time.Time) uint64 { return math.MaxUint64 }

func (q *quicknet) PublicKey() kyber.Point { return q.publicKey }

func (q *quicknet) Scheme() crypto.Scheme { return *q.scheme }

func (q *quicknet) Signature(round uint64) ([]byte, error) {
	var beacon struct {
		Round     uint64 `json:"round"`
		Signature string `json:"signature"`
	}

	if err := authorizedGet(q.token, "/api/drand/rounds/"+url.PathEscape(strconv.FormatUint(round, 10)), &beacon); err != nil {
		return nil, err
	}

	if beacon.Round != round {
		return nil, errors.New("the server sent another round")
	}

	return hex.DecodeString(beacon.Signature)
}

func (q *quicknet) SwitchChainHash(string) error {
	return errors.New("sealed letters use drand's quicknet only")
}

// sealLetter time-locks an encoded payload until opensAt (needs no
// network: only quicknet's key).
func sealLetter(inner string, opensAt time.Time, surprise bool) (sealedLetter, error) {
	network, err := newQuicknet("")
	if err != nil {
		return sealedLetter{}, err
	}

	round := roundAt(opensAt)
	var out bytes.Buffer
	w := armor.NewWriter(&out)

	if err := tlock.New(network).Strict().Encrypt(w, strings.NewReader(inner), round); err != nil {
		return sealedLetter{}, err
	}

	if err := w.Close(); err != nil {
		return sealedLetter{}, err
	}

	return sealedLetter{Round: round, Box: out.String(), Surprise: surprise}, nil
}

// openLetter: the encoded payload, once its round has come.
func openLetter(token string, s sealedLetter) (string, error) {
	network, err := newQuicknet(token)
	if err != nil {
		return "", err
	}

	var out bytes.Buffer

	if err := tlock.New(network).Strict().Decrypt(&out, strings.NewReader(s.Box)); err != nil {
		return "", fmt.Errorf("the letter could not be opened: %w", err)
	}

	return out.String(), nil
}

// sealedText: the fallback text, with when it opens.
func sealedText(opensAt time.Time) string {
	return sealedFallback + ": it opens on " + opensAt.UTC().Format("2 January 2006 at 15:04 UTC")
}

// --- in the chat ---

// letterState: a letter's opening on this computer, for the session.
type letterState struct {
	opening bool
	opened  bool
	inner   payload
	err     string
	// A failed opening is tried again from then.
	retryAt time.Time
}

// sealing: the next message is sent as a sealed letter.
type sealing struct {
	opensAt  time.Time
	surprise bool
}

// letterRetry: how long after a failed opening it is tried again.
const letterRetry = 15 * time.Second

// openDueLetters opens the letters seen in chats whose round has come
// (every second, from the clock).
func (m *model) openDueLetters() tea.Cmd {
	if m.user == nil {
		return nil
	}

	var cmds []tea.Cmd
	now := time.Now()
	token := m.user.Token

	for id, letter := range m.sealedSeen {
		state := m.letters[id]

		if state != nil && (state.opening || state.opened || now.Before(state.retryAt)) {
			continue
		}

		// A little after the round, for the server to have its signature;
		// the server's clock decides (it refuses rounds not come yet).
		if now.Before(openingTime(letter.Round).Add(1500 * time.Millisecond)) {
			continue
		}

		m.letters[id] = &letterState{opening: true}

		cmds = append(cmds, task(func() func(*model) tea.Cmd {
			inner, err := openLetter(token, letter)

			return func(m *model) tea.Cmd {
				if m.user == nil || m.user.Token != token {
					return nil
				}

				if err != nil {
					m.letters[id] = &letterState{err: err.Error(), retryAt: time.Now().Add(letterRetry)}
					return nil
				}

				p := decodePayload(inner)
				// A letter inside a letter is not opened again.
				p.sealed = nil
				m.letters[id] = &letterState{opened: true, inner: p}

				return nil
			}
		}))
	}

	return tea.Batch(cmds...)
}

// letterKey: what changes a letter's bubble (its state, the countdown).
func (m model) letterKey(id string) string {
	letter, ok := m.sealedSeen[id]

	if !ok {
		return ""
	}

	state := m.letters[id]

	switch {
	case state != nil && state.opened:
		return "opened"
	case state != nil && state.err != "":
		return "failed"
	}

	return countdown(time.Until(openingTime(letter.Round)))
}

// envelopeLines: a letter not opened yet.
func (m model) envelopeLines(id string, letter sealedLetter, surprise bool) []string {
	title := "Sealed letter"

	if letter.Surprise {
		title = "Surprise letter"
	}

	at := openingTime(letter.Round)
	detail := "Opens " + countdown(time.Until(at))

	if state := m.letters[id]; state != nil && state.err != "" {
		detail = "Not opened yet: " + state.err + ". Trying again…"
	} else if !time.Now().Before(at) {
		detail = "Opening…"
	}

	lines := []string{title, at.Local().Format("02.01.2006 at 15:04"), detail}

	if surprise {
		lines = append(lines, "Only you see it until then: it arrives as a surprise.")
	}

	return lines
}

// openedNote: over an opened letter's contents.
func openedNote(letter sealedLetter) string {
	kind := "Sealed letter"

	if letter.Surprise {
		kind = "Surprise letter"
	}

	return "🔓 " + kind + ", opened " + openingTime(letter.Round).Local().Format("02.01.2006 at 15:04")
}

// countdown: "in 2 years 3 months", "in 5 days 4 h", "in 3 h 12 min", "in 45 s".
func countdown(d time.Duration) string {
	s := max(int64(math.Ceil(d.Seconds())), 0)
	days := s / 86400
	plural := func(n int64, one, many string) string {
		if n == 1 {
			return fmt.Sprintf("%d %s", n, one)
		}

		return fmt.Sprintf("%d %s", n, many)
	}

	switch {
	case days >= 365:
		out := "in " + plural(days/365, "year", "years")

		if months := days % 365 / 30; months > 0 {
			out += " " + plural(months, "month", "months")
		}

		return out
	case days >= 30:
		out := "in " + plural(days/30, "month", "months")

		if days%30 > 0 {
			out += fmt.Sprintf(" %d d", days%30)
		}

		return out
	case days > 0:
		out := "in " + plural(days, "day", "days")

		if h := s % 86400 / 3600; h > 0 {
			out += fmt.Sprintf(" %d h", h)
		}

		return out
	case s >= 3600:
		return fmt.Sprintf("in %d h %d min", s/3600, s%3600/60)
	case s >= 60:
		return fmt.Sprintf("in %d min %d s", s/60, s%60)
	}

	return fmt.Sprintf("in %d s", s)
}

var relativeSeal = regexp.MustCompile(`^(\d+)\s*(m|min|h|d|w|y)$`)

// parseOpening: "31.12.2030 18:00", "31.12.2030" (at 9:00), or from now:
// "30m", "2h", "3d", "2w", "1y".
func parseOpening(text string, now time.Time) (time.Time, error) {
	text = strings.ToLower(strings.TrimSpace(text))

	if match := relativeSeal.FindStringSubmatch(text); match != nil {
		n, _ := strconv.Atoi(match[1])

		switch match[2] {
		case "m", "min":
			return now.Add(time.Duration(n) * time.Minute), nil
		case "h":
			return now.Add(time.Duration(n) * time.Hour), nil
		case "d":
			return now.AddDate(0, 0, n), nil
		case "w":
			return now.AddDate(0, 0, 7*n), nil
		default:
			return now.AddDate(n, 0, 0), nil
		}
	}

	for _, layout := range []string{"02.01.2006 15:04", "2.1.2006 15:04", "02.01.2006", "2.1.2006"} {
		if t, err := time.ParseInLocation(layout, text, time.Local); err == nil {
			if !strings.Contains(layout, ":") {
				t = t.Add(9 * time.Hour)
			}

			return t, nil
		}
	}

	return time.Time{}, errors.New("write it as 31.12.2030 18:00, or as 30m, 2h, 3d, 2w, 1y from now")
}

// checkOpening: a minute to ten years from now.
func checkOpening(t, now time.Time) error {
	switch {
	case t.Before(now.Add(time.Minute)):
		return errors.New("choose a time at least a minute from now")
	case t.After(now.AddDate(maxSealYears, 0, 0)):
		return fmt.Errorf("a letter can be sealed for up to %d years", maxSealYears)
	}

	return nil
}

// askSealing: when the next message opens, then how it is sent.
func (m *model) askSealing() tea.Cmd {
	m.menu = nil

	return m.openPrompt("Seal the next message until", "31.12.2030 18:00", "A date and time, or 30m, 2h, 3d, 2w, 1y from now. Nobody can open it before then: not the chat, not you, not the server.", "", 20, func(m *model, value string) tea.Cmd {
		now := time.Now()
		at, err := parseOpening(value, now)

		if err == nil {
			err = checkOpening(at, now)
		}

		if err != nil {
			return m.showToast("Not sealed: "+err.Error(), true)
		}

		choose := func(surprise bool) func(*model) tea.Cmd {
			return func(m *model) tea.Cmd {
				if m.chat != nil {
					m.chat.sealing = &sealing{opensAt: at, surprise: surprise}
				}

				return nil
			}
		}

		m.openMenu(&menuState{
			title: "Opens " + at.Format("02.01.2006 at 15:04"),
			items: []menuItem{
				{icon: "✉", label: "Envelope: it arrives now and shows when it opens", action: choose(false)},
				{icon: "🎁", label: "Surprise: it arrives then (the server knows when)", action: choose(true)},
			},
			confirming: -1,
		})

		return nil
	})
}
