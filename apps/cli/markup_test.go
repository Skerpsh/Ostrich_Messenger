package main

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestMarkup(t *testing.T) {
	cases := []struct {
		text string
		want []span
	}{
		{"a **b** c", []span{{"a ", spanStyle{}}, {"b", spanStyle{bold: true}}, {" c", spanStyle{}}}},
		{"_it_ and *it* ~~s~~ `x * y`", []span{
			{"it", spanStyle{italic: true}}, {" and ", spanStyle{}}, {"it", spanStyle{italic: true}},
			{" ", spanStyle{}}, {"s", spanStyle{strike: true}}, {" ", spanStyle{}}, {"x * y", spanStyle{code: true}},
		}},
		{"**bold _both_**", []span{{"bold ", spanStyle{bold: true}}, {"both", spanStyle{bold: true, italic: true}}}},
		{"```\nconst a = 1;\n```", []span{{"const a = 1;", spanStyle{code: true}}}},
		{"see https://example.com/a?b=1.", []span{
			{"see ", spanStyle{}}, {"https://example.com/a?b=1", spanStyle{link: "https://example.com/a?b=1"}}, {".", spanStyle{}},
		}},
		{"(https://x.org)", []span{{"(", spanStyle{}}, {"https://x.org", spanStyle{link: "https://x.org"}}, {")", spanStyle{}}}},
	}

	for _, c := range cases {
		if got := parseMarkup(c.text); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q:\n got %+v\nwant %+v", c.text, got, c.want)
		}
	}

	// No formatting where it is not meant.
	for _, text := range []string{"snake_case_name", "2 * 3 * 4", "** not bold **", "a_b", "*", "**"} {
		if got := plainText(text); got != text {
			t.Errorf("%q became %q", text, got)
		}
	}
}

func TestPayload(t *testing.T) {
	if encodePayload(payload{text: "hi"}) != "hi" {
		t.Fatal("plain text changed")
	}

	got := decodePayload(encodePayload(payload{text: "hi", forwardedFrom: "alice"}))

	if got.text != "hi" || got.forwardedFrom != "alice" || got.attachments != nil {
		t.Fatalf("forward: %+v", got)
	}

	// The same bytes as the app's.
	if got := decodePayload("\u001eostrich1:{\"t\":\"x\",\"f\":\"bob\"}"); got.text != "x" || got.forwardedFrom != "bob" {
		t.Fatalf("app payload not read: %+v", got)
	}

	if broken := "\u001eostrich1:{oops"; decodePayload(broken).text != broken {
		t.Fatal("broken payload not shown as text")
	}

	// A voice message from the app (the same as apps/mobile-web/src/features/chat/markup.test.ts),
	// forwarded as it is.
	voice := decodePayload("\u001eostrich1:{\"t\":\"\",\"a\":[{\"i\":\"6f2b4ad0-8a3e-4c51-9d7b-1e2f3a4b5c6d\",\"k\":\"a2V5\",\"n\":\"voice.m4a\",\"m\":\"audio/mp4\",\"s\":5000,\"d\":7300,\"v\":\"AH//\"}]}")

	if len(voice.attachments) != 1 || !isVoice(voice.attachments[0]) || voice.attachments[0].Duration != 7300 {
		t.Fatalf("voice message: %+v", voice)
	}

	if again := decodePayload(encodePayload(voice)); again.attachments[0] != voice.attachments[0] {
		t.Fatalf("voice message changed: %+v", again)
	}

	if got := attachmentsLabel(voice.attachments); got != "Voice message (0:07)" {
		t.Fatalf("voice label %q", got)
	}

	if got := waveform("AH//", 3); got != "▁▄█" {
		t.Fatalf("waveform %q", got)
	}

	// Files from here are not voice messages.
	if strings.Contains(encodePayload(payload{attachments: []attachment{{ID: "x", Mime: "audio/mp4"}}}), `"d"`) {
		t.Fatal("a file got a duration")
	}

	// A link preview from the app; a bad one is left out.
	withLink := decodePayload(payloadMarker + `{"t":"see https://example.com","l":{"u":"https://example.com","t":"Example","s":"example.com",` +
		`"i":{"i":"6f2b4ad0-8a3e-4c51-9d7b-1e2f3a4b5c6d","k":"a2V5","n":"preview.jpg","m":"image/jpeg","s":10}}}`)

	if withLink.link == nil || withLink.link.Title != "Example" || withLink.link.Image == nil {
		t.Fatalf("link preview: %+v", withLink.link)
	}

	if again := decodePayload(encodePayload(withLink)); again.link == nil || *again.link.Image != *withLink.link.Image {
		t.Fatalf("link preview changed: %+v", again.link)
	}

	if bad := decodePayload(payloadMarker + `{"t":"x","l":{"u":"javascript:alert(1)","t":"x"}}`); bad.link != nil {
		t.Fatal("a bad link preview was read")
	}

	if other := decodePayload(payloadMarker + `{"t":"https://bank.example","l":{"u":"https://evil.example","t":"Bank"}}`); other.link != nil {
		t.Fatal("a preview of a link not in the text was read")
	}

	// A malformed preview loses only itself.
	if got := decodePayload(payloadMarker + `{"t":"hi","l":"oops"}`); got.text != "hi" || got.link != nil {
		t.Fatalf("malformed preview: %+v", got)
	}

	// Malformed attachments are left out.
	if got := decodePayload(payloadMarker + `{"t":"x","a":[{"i":"nope"},{"i":1}]}`); got.text != "x" || len(got.attachments) != 0 {
		t.Fatalf("malformed attachments: %+v", got)
	}
}

// The same cases as the app's (apps/mobile-web/src/features/chat/markup.test.ts).
func TestMentions(t *testing.T) {
	data, err := os.ReadFile("../../shared/test-vectors/markup-mentions.json")
	if err != nil {
		t.Fatal(err)
	}

	var cases struct {
		Mentions [][2]json.RawMessage `json:"mentions"`
	}

	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}

	for _, c := range cases.Mentions {
		var text string
		var want []string

		_ = json.Unmarshal(c[0], &text)
		_ = json.Unmarshal(c[1], &want)

		got := []string{}

		for _, s := range parseMarkup(text) {
			if s.style.mention != "" && !s.style.code {
				got = append(got, s.style.mention)
			}
		}

		if !reflect.DeepEqual(got, want) {
			t.Errorf("%q: got %v, want %v", text, got, want)
		}
	}
}
