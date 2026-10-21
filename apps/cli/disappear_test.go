package main

import (
	"strings"
	"testing"
)

func TestDisappearMessages(t *testing.T) {
	id := "K7QM3XRA9TPWH2DCM8VN"
	wire := encodePayload(payload{text: "Goodbye", heir: id})

	if p := decodePayload(wire); p.heir != id || p.text != "Goodbye" {
		t.Fatalf("%+v", p)
	}

	// Not an OstrichID: left out.
	if p := decodePayload(strings.Replace(wire, id, "not-an-id", 1)); p.heir != "" {
		t.Errorf("kept %q", p.heir)
	}

	days := 30
	message := Message{SenderUsername: "ann", SentAfterDays: &days}

	if got := sentAutomatically(message); got != "⌛ Sent automatically: @ann had not opened Ostrich for 30 days" {
		t.Error(got)
	}

	if lines := heirLines(id, false, "ann"); lines[1] != "K7QM-3XRA-9TPW-H2DC-M8VN" {
		t.Error(lines)
	}
}
