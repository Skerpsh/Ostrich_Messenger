package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The same vectors are checked by apps/mobile-web/src/features/chat/sealed.test.ts,
// so the app and the CLI open each other's sealed letters.
func TestSealedLetters(t *testing.T) {
	v, _, _ := loadVectors(t)
	s := v.SealedLetter
	signature := s.Signature

	// The server's /api/drand, passing on the round's signature.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != fmt.Sprintf("/api/drand/rounds/%d", s.Round) || r.Header.Get("Authorization") != "Bearer t" {
			http.Error(w, `{"error":"not this round"}`, http.StatusTooEarly)
			return
		}

		fmt.Fprintf(w, `{"round":%d,"signature":%q}`, s.Round, signature)
	}))
	defer server.Close()

	previous := serverURL
	serverURL = server.URL
	defer func() { serverURL = previous }()

	if roundAt(openingTime(s.Round)) != s.Round || roundAt(openingTime(s.Round).Add(time.Millisecond)) != s.Round+1 {
		t.Error("rounds and their times differ")
	}

	for name, box := range map[string]string{"CLI": s.BoxGo, "app": s.BoxJS} {
		inner, err := openLetter("t", sealedLetter{Round: s.Round, Box: box})

		if err != nil || inner != s.Inner {
			t.Errorf("sealed by the %s: %q, %v", name, inner, err)
		}

		if p := decodePayload(inner); p.text != "Hello from 2023 🦤" || p.forwardedFrom != "ann" {
			t.Errorf("sealed by the %s: payload %+v", name, p)
		}
	}

	sealed, err := sealLetter("A letter to the future", openingTime(s.Round), true)
	if err != nil || sealed.Round != s.Round || !sealed.Surprise {
		t.Fatalf("%+v, %v", sealed, err)
	}

	if inner, err := openLetter("t", sealed); err != nil || inner != "A letter to the future" {
		t.Errorf("%q, %v", inner, err)
	}

	// Its payload carries it, with the text for older clients.
	wire := encodePayload(payload{text: sealedText(openingTime(s.Round)), sealed: &sealed})
	if p := decodePayload(wire); p.sealed == nil || *p.sealed != sealed || !strings.HasPrefix(p.text, sealedFallback) {
		t.Errorf("payload %+v", p)
	}

	// A made-up signature, or a round not come yet, opens nothing.
	signature = strings.Repeat("a", 96)

	if _, err := openLetter("t", sealedLetter{Round: s.Round, Box: s.BoxGo}); err == nil {
		t.Error("opened with a made-up signature")
	}

	later, _ := sealLetter("Not yet", openingTime(s.Round+1), false)

	if _, err := openLetter("t", later); err == nil {
		t.Error("opened before its round")
	}
}
