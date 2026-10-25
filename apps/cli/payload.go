package main

import (
	"encoding/json"
	"regexp"
	"strings"
)

// What a message carries inside its encryption, the same as the app's
// (apps/mobile-web/src/features/chat/payload.ts): usually just its text; forwarded messages
// and messages with files carry a small JSON object after a marker, so
// the server sees none of it.

const payloadMarker = "\u001eostrich1:"

// attachment is a file of a message, encrypted with its own key and
// uploaded under its id.
type attachment struct {
	ID  string
	Key string
	// Name and MIME type as the sender gave them: shown, never used as a
	// path without cleaning (see saveAttachment).
	Name string
	Mime string
	// Bytes, before encryption.
	Size int64
	// Pictures: their size in pixels.
	Width, Height int
	// Voice messages (recorded in the app) carry their length in
	// milliseconds and the loudness along it, base64 of one byte per bar;
	// kept as they are when forwarding.
	HasDuration bool
	Duration    int64
	Waveform    string
}

type payload struct {
	text string
	// The username a forwarded message comes from.
	forwardedFrom string
	attachments   []attachment
	// A preview of the text's first link, made by the sender's phone.
	link *linkPreview
	// The chat's entry for a call, sent by the caller's app; text says the
	// same for clients that do not know it.
	call *callEntry
	// A sealed letter (sealed.go): the real payload, time-locked; text
	// says so for clients that do not know it.
	sealed *sealedLetter
	// "If I disappear": the sender's OstrichID, left to the chat.
	heir string
}

// callEntry: "answered" (with how long, in milliseconds), "missed" or
// "declined"; Video: started as a video call.
type callEntry struct {
	ID       string
	Outcome  string
	Duration int64
	Video    bool
}

type wireCall struct {
	I string `json:"i"`
	O string `json:"o"`
	D *int64 `json:"d,omitempty"`
	V bool   `json:"v,omitempty"`
}

// linkPreview: the page's title, description, site and picture (an
// attachment, not among the message's files).
type linkPreview struct {
	URL, Title, Description, Site string
	Image                         *attachment
}

type wireLink struct {
	U string          `json:"u"`
	T string          `json:"t"`
	D string          `json:"d,omitempty"`
	S string          `json:"s,omitempty"`
	I *wireAttachment `json:"i,omitempty"`
}

type wireAttachment struct {
	I string `json:"i"`
	K string `json:"k"`
	N string `json:"n"`
	M string `json:"m"`
	S int64  `json:"s"`
	W int    `json:"w,omitempty"`
	H int    `json:"h,omitempty"`
	D *int64 `json:"d,omitempty"`
	V string `json:"v,omitempty"`
}

type payloadWire struct {
	T string           `json:"t"`
	F string           `json:"f,omitempty"`
	A []wireAttachment `json:"a,omitempty"`
	L *wireLink        `json:"l,omitempty"`
	C *wireCall        `json:"c,omitempty"`
	Z *wireSealed      `json:"z,omitempty"`
	H string           `json:"h,omitempty"`
}

func toWire(a attachment) wireAttachment {
	w := wireAttachment{I: a.ID, K: a.Key, N: a.Name, M: a.Mime, S: a.Size, V: a.Waveform}

	if a.Width > 0 && a.Height > 0 {
		w.W, w.H = a.Width, a.Height
	}

	if a.HasDuration {
		d := a.Duration
		w.D = &d
	}

	return w
}

// fromWire: false if the attachment is malformed.
func fromWire(a wireAttachment) (attachment, bool) {
	if !attachmentIDRE.MatchString(a.I) || a.K == "" {
		return attachment{}, false
	}

	item := attachment{
		ID: a.I, Key: a.K, Name: a.N, Mime: a.M, Size: a.S, Width: a.W, Height: a.H, Waveform: a.V,
	}

	if a.D != nil && *a.D >= 0 {
		item.HasDuration, item.Duration = true, *a.D
	}

	return item, true
}

func encodePayload(p payload) string {
	if p.forwardedFrom == "" && len(p.attachments) == 0 && p.link == nil && p.call == nil && p.sealed == nil && p.heir == "" {
		return p.text
	}

	wire := payloadWire{T: p.text, F: p.forwardedFrom, H: p.heir}

	for _, a := range p.attachments {
		wire.A = append(wire.A, toWire(a))
	}

	if l := p.link; l != nil {
		wire.L = &wireLink{U: l.URL, T: l.Title, D: l.Description, S: l.Site}

		if l.Image != nil {
			image := toWire(*l.Image)
			wire.L.I = &image
		}
	}

	if c := p.call; c != nil {
		wire.C = &wireCall{I: c.ID, O: c.Outcome, V: c.Video}

		if c.Outcome == "answered" {
			d := c.Duration
			wire.C.D = &d
		}
	}

	if s := p.sealed; s != nil {
		wire.Z = &wireSealed{R: s.Round, B: s.Box, S: s.Surprise}
	}

	data, _ := json.Marshal(wire)

	return payloadMarker + string(data)
}

// An OstrichID: 20 characters of its alphabet (crypto.go).
var heirRE = regexp.MustCompile(`^[2-9A-HJKMNP-Z]{20}$`)

var attachmentIDRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// decodePayload: anything that is not a well-formed payload is text;
// malformed attachments are left out.
func decodePayload(plain string) payload {
	rest, ok := strings.CutPrefix(plain, payloadMarker)
	if !ok {
		return payload{text: plain}
	}

	var wire struct {
		T *string           `json:"t"`
		F string            `json:"f"`
		A []json.RawMessage `json:"a"`
		L json.RawMessage   `json:"l"`
		C json.RawMessage   `json:"c"`
		Z json.RawMessage   `json:"z"`
		H string            `json:"h"`
	}

	if json.Unmarshal([]byte(rest), &wire) != nil || wire.T == nil {
		return payload{text: plain}
	}

	p := payload{text: *wire.T, forwardedFrom: wire.F}

	if heirRE.MatchString(wire.H) {
		p.heir = wire.H
	}

	for _, raw := range wire.A {
		var a wireAttachment

		if json.Unmarshal(raw, &a) != nil {
			continue
		}

		if item, ok := fromWire(a); ok {
			p.attachments = append(p.attachments, item)
		}
	}

	// Read on its own, so a malformed preview does not lose the message.
	if len(wire.L) > 0 {
		var l wireLink

		if json.Unmarshal(wire.L, &l) == nil {
			p.link = readLink(&l, p.text)
		}
	}

	if len(wire.C) > 0 {
		var c wireCall

		if json.Unmarshal(wire.C, &c) == nil && attachmentIDRE.MatchString(c.I) &&
			(c.O == "answered" || c.O == "missed" || c.O == "declined") {
			p.call = &callEntry{ID: c.I, Outcome: c.O, Video: c.V}

			if c.D != nil && *c.D >= 0 {
				p.call.Duration = *c.D
			}
		}
	}

	if len(wire.Z) > 0 {
		var z wireSealed

		if json.Unmarshal(wire.Z, &z) == nil {
			p.sealed = readSealed(z)
		}
	}

	return p
}

// callText: the call entry from this user's side, like the app's.
func callText(c callEntry, own bool) string {
	kind := "call"

	if c.Video {
		kind = "video call"
	}

	switch {
	case c.Outcome == "answered" && own:
		return "Outgoing " + kind + " · " + formatDuration(c.Duration)
	case c.Outcome == "answered":
		return "Incoming " + kind + " · " + formatDuration(c.Duration)
	case c.Outcome == "declined":
		return strings.ToUpper(kind[:1]) + kind[1:] + " declined"
	case own:
		return strings.ToUpper(kind[:1]) + kind[1:] + ", no answer"
	default:
		return "Missed " + kind
	}
}

var linkURLRE = regexp.MustCompile(`(?i)^https?://\S+$`)

// readLink: nil unless the preview is well-formed and of a link in the
// message's text (it must not lead elsewhere than the text shows), like
// the app's.
func readLink(l *wireLink, text string) *linkPreview {
	if l == nil || !linkURLRE.MatchString(l.U) || len(l.U) > 2048 || !strings.Contains(text, l.U) || strings.TrimSpace(l.T) == "" {
		return nil
	}

	clip := func(s string, n int) string {
		s = strings.TrimSpace(s)

		if r := []rune(s); len(r) > n {
			return string(r[:n])
		}

		return s
	}

	link := &linkPreview{URL: l.U, Title: clip(l.T, 200), Description: clip(l.D, 400), Site: clip(l.S, 80)}

	if l.I != nil {
		if image, ok := fromWire(*l.I); ok && strings.HasPrefix(image.Mime, "image/") {
			link.Image = &image
		}
	}

	return link
}
