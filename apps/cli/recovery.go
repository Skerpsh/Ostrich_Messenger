package main

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

// Recovery through friends, like the app's (apps/server/src/recovery.ts):
// the user's OstrichID split here among friends ("guardians"), any
// threshold of whom can give it back to a new device that knows the
// password, a day after it asks (the user's devices can cancel it
// meanwhile). In Settings: the guardians, a request going (cancel it if it
// is not the user) and the friends the user guards (approve their request
// with the code they read). Logging in with it: recoverlogin.go.

const (
	minGuardians = 2
	maxGuardians = 10
)

type recoveryPerson struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	IsDeveloper bool   `json:"is_developer"`
}

type recoveryRequest struct {
	ID        string `json:"id"`
	PublicKey string `json:"public_key"`
	Client    string `json:"client"`
	CreatedAt string `json:"created_at"`
	ReadyAt   string `json:"ready_at"`
	Approvals int    `json:"approvals"`
}

type recoveryStatus struct {
	Setup *struct {
		ID        string           `json:"id"`
		Threshold int              `json:"threshold"`
		Guardians []recoveryPerson `json:"guardians"`
	} `json:"setup"`
	Requests []recoveryRequest `json:"requests"`
}

// A friend whose share the user keeps.
type guarding struct {
	SetupID      string         `json:"setup_id"`
	Threshold    int            `json:"threshold"`
	Total        int            `json:"total"`
	Sealed       string         `json:"sealed"`
	SealerPublic string         `json:"sealer_public"`
	Owner        recoveryPerson `json:"owner"`
	Request      *struct {
		ID        string `json:"id"`
		PublicKey string `json:"public_key"`
		CreatedAt string `json:"created_at"`
		ReadyAt   string `json:"ready_at"`
		Approved  bool   `json:"approved"`
	} `json:"request"`
}

type recoveryState struct {
	owner    *recoveryStatus
	guarding []guarding
	// Requests already told about (a toast once each).
	seen map[string]bool
	// The account was just recovered here: the guardians are to be chosen
	// again (told after the new OstrichID).
	recovered bool
}

// shareSeal is a share sealed for someone, as the server keeps it.
type shareSeal struct {
	GuardianID   string `json:"guardian_id"`
	Sealed       string `json:"sealed"`
	SealerPublic string `json:"sealer_public"`
}

// loadRecovery fetches the user's guardians and requests and the friends
// they guard; new requests are told in a toast.
func (m *model) loadRecovery() tea.Cmd {
	if m.user == nil {
		return nil
	}

	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		var status recoveryStatus
		var guarded struct {
			Guarding []guarding `json:"guarding"`
		}

		err := authorizedGet(token, "/api/recovery", &status)

		if err == nil {
			err = authorizedGet(token, "/api/recovery/guarding", &guarded)
		}

		return func(m *model) tea.Cmd {
			if m.user == nil || m.user.Token != token {
				return nil
			}

			if err != nil {
				return m.failSilently(err)
			}

			return m.setRecovery(&status, guarded.Guarding)
		}
	})
}

func (m *model) setRecovery(status *recoveryStatus, guarded []guarding) tea.Cmd {
	r := &m.recovery
	r.owner = status
	r.guarding = guarded

	if r.seen == nil {
		r.seen = map[string]bool{}
	}

	if status.Setup != nil {
		r.recovered = false
	}

	for _, request := range status.Requests {
		if !r.seen[request.ID] {
			r.seen[request.ID] = true
			return m.showToast("⚠ Someone is recovering your account with your friends. Not you? Cancel it in Settings → Recovery through friends", true)
		}
	}

	for _, friend := range guarded {
		if friend.Request != nil && !friend.Request.Approved && !r.seen[friend.Request.ID] {
			r.seen[friend.Request.ID] = true
			return m.showToast("@"+sanitize(friend.Owner.Username)+" asks you to help recover their account: Settings → Recovery through friends", false)
		}
	}

	return nil
}

func defaultThreshold(total int) int {
	return max(minGuardians, total/2+1)
}

// recoveryRows: the settings' section.
func (m model) recoveryRows() []settingsRow {
	r := m.recovery
	rows := []settingsRow{{kind: rowSection, label: "Recovery through friends"}}

	if r.owner == nil {
		return append(rows, settingsRow{kind: rowAction, id: "recovery-loading", icon: "…", label: "Loading…", action: (*model).loadRecovery})
	}

	for _, request := range r.owner.Requests {
		request := request
		threshold := "?"

		if r.owner.Setup != nil {
			threshold = strconv.Itoa(r.owner.Setup.Threshold)
		}

		rows = append(rows, settingsRow{kind: rowAction, id: "recovery-cancel:" + request.ID, icon: "⚠", danger: true,
			label: "Someone is recovering your account: Enter cancels it",
			hint: fmt.Sprintf("Asked on %s from %s, with your password. %d of %s guardians have approved; they can get in after %s. If it is not you, cancel it and change your password.",
				formatDateTime(request.CreatedAt), clientLabel(request.Client), request.Approvals, threshold, formatDateTime(request.ReadyAt)),
			action: func(m *model) tea.Cmd { return m.cancelRecoveryRequest(request.ID) }})
	}

	guardians := settingsRow{kind: rowAction, id: "guardians", icon: "⛨", label: "Guardians", value: "Off", form: "guardians",
		hint: "Friends who can give your OstrichID back if you lose it."}

	if setup := r.owner.Setup; setup != nil {
		names := make([]string, len(setup.Guardians))

		for i, guardian := range setup.Guardians {
			names[i] = "@" + sanitize(guardian.Username)
		}

		guardians.value = fmt.Sprintf("%d of %d: %s", setup.Threshold, len(names), strings.Join(names, " "))
	}

	rows = append(rows, guardians)

	if r.owner.Setup != nil {
		rows = append(rows, settingsRow{kind: rowAction, id: "recovery-remove", icon: "✕", label: "Remove guardians", danger: true,
			action: func(m *model) tea.Cmd {
				if m.settings.confirming != "recovery-remove" {
					m.settings.confirming = "recovery-remove"
					return nil
				}

				m.settings.confirming = ""

				return m.changeRecovery("DELETE", "/api/recovery", "Guardians removed")
			}})
	}

	for _, friend := range r.guarding {
		row := settingsRow{kind: rowAction, id: "guard:" + friend.SetupID, icon: "♡", label: "Guardian for @" + sanitize(friend.Owner.Username),
			value: fmt.Sprintf("%d of %d needed", friend.Threshold, friend.Total)}

		switch {
		case friend.Request == nil:
		case friend.Request.Approved:
			row.value = "you approved"
			row.hint = "They can get in after " + formatDateTime(friend.Request.ReadyAt) + ", once enough guardians have approved."
		default:
			row.value = "asks for help"
			row.danger = true
			row.form = "approve:" + friend.SetupID
		}

		rows = append(rows, row)
	}

	return rows
}

func clientLabel(client string) string {
	if name, ok := clientNames[client]; ok {
		return name
	}

	return sanitize(client)
}

// formatDateTime: "25.10.2026 13:02".
func formatDateTime(iso string) string {
	return formatDate(iso) + " " + formatTime(iso)
}

func (m *model) cancelRecoveryRequest(id string) tea.Cmd {
	return m.changeRecovery("DELETE", "/api/recovery/requests/"+url.PathEscape(id), "Cancelled. Change your password if someone else knows it.")
}

// changeRecovery sends a change of the user's setup and shows the result.
func (m *model) changeRecovery(method, path, done string) tea.Cmd {
	token := m.user.Token

	return task(func() func(*model) tea.Cmd {
		var status recoveryStatus
		err := authorizedJSON(token, method, path, nil, &status)

		return func(m *model) tea.Cmd {
			if err != nil {
				return tea.Batch(m.showToast(err.Error(), true), m.failSilently(err))
			}

			m.recovery.owner = &status

			return m.showToast(done, false)
		}
	})
}

// --- forms ---

func (m *model) openRecoveryForm(form string) []textinput.Model {
	p := m.pal

	switch {
	case form == "guardians":
		names := ""

		if setup := m.recovery.owner.Setup; setup != nil {
			for _, guardian := range setup.Guardians {
				names += "@" + guardian.Username + " "
			}
		}

		inputs := []textinput.Model{
			newInput("@friend @friend @friend", 400, false, p),
			newInput("How many are needed (e.g. 3 of 5: 3)", 2, false, p),
			newInput("Your OstrichID", 40, true, p),
		}
		inputs[0].SetValue(strings.TrimSpace(names))

		return inputs
	case strings.HasPrefix(form, "approve:"):
		return []textinput.Model{newInput("The 6-digit code they read you", 7, false, p)}
	}

	return nil
}

func (m model) guardedFriend(setupID string) *guarding {
	for i := range m.recovery.guarding {
		if m.recovery.guarding[i].SetupID == setupID {
			return &m.recovery.guarding[i]
		}
	}

	return nil
}

// recoveryFormText: the open form's intro and button, if it is one of
// these.
func (m model) recoveryFormText(form string) (intro, label string, ok bool) {
	switch {
	case form == "guardians":
		return fmt.Sprintf("Choose %d to %d people you have a chat with, who know your voice and will not all lose their phones at once; they are told they were chosen. Your OstrichID is split here into shares, each encrypted for one of them: the server and any one friend learn nothing. More needed are safer against friends who team up, fewer still work if some cannot be reached.", minGuardians, maxGuardians),
			"Save the guardians", true
	case strings.HasPrefix(form, "approve:"):
		name := "your friend"

		if friend := m.guardedFriend(strings.TrimPrefix(form, "approve:")); friend != nil {
			name = "@" + sanitize(friend.Owner.Username)
		}

		return "Call or meet " + name + " and ask them to read you the 6-digit code on their new device. Approve only if you heard it from them, by voice or face to face: someone with their password could be pretending.",
			"Approve", true
	}

	return "", "", false
}

type submitRun func(work func() error, done func(m *model) tea.Cmd) tea.Cmd

// submitRecoveryForm sends the open form, if it is one of these.
func (m *model) submitRecoveryForm(run submitRun) (tea.Cmd, bool) {
	s := m.settings
	token := m.user.Token

	switch {
	case s.form == "guardians":
		guardians, threshold, ostrichID, err := m.guardiansFromForm()

		if err != nil {
			s.formErr = err.Error()
			return nil, true
		}

		var status recoveryStatus

		return run(func() error {
			return chooseGuardians(token, ostrichID, guardians, threshold, &status)
		}, func(m *model) tea.Cmd {
			m.recovery.owner = &status
			m.recovery.recovered = false
			m.settings.form = ""

			return m.showToast(fmt.Sprintf("On: any %d of your %d guardians can help you back in", threshold, len(guardians)), false)
		}), true

	case strings.HasPrefix(s.form, "approve:"):
		friend := m.guardedFriend(strings.TrimPrefix(s.form, "approve:"))
		code := s.inputs[0].Value()
		privateKey, userID := m.user.PrivateKey, m.user.User.ID

		if friend == nil || friend.Request == nil {
			s.formErr = "There is no request to approve"
			return nil, true
		}

		copied := *friend

		return run(func() error {
			return approveRecovery(token, privateKey, userID, copied, code)
		}, func(m *model) tea.Cmd {
			m.settings.form = ""

			return tea.Batch(m.showToast("Approved", false), m.loadRecovery())
		}), true
	}

	return nil, false
}

type guardianKey struct{ id, publicKey string }

// guardiansFromForm: the people typed, as friends with a direct chat.
func (m model) guardiansFromForm() ([]guardianKey, int, string, error) {
	s := m.settings
	var guardians []guardianKey
	seen := map[string]bool{}

	for _, name := range strings.FieldsFunc(s.inputs[0].Value(), func(r rune) bool { return r == ' ' || r == ',' }) {
		name = strings.ToLower(cleanUsername(name))

		if name == "" || seen[name] {
			continue
		}

		seen[name] = true
		found := false

		for _, chat := range m.chats {
			if chat.Type == "direct" && strings.EqualFold(chat.Username, name) && chat.UserID != m.user.User.ID {
				if chat.PublicKey == "" || chat.Blocked {
					return nil, 0, "", fmt.Errorf("@%s cannot be a guardian (blocked, or without encryption yet)", sanitize(name))
				}

				guardians = append(guardians, guardianKey{chat.UserID, chat.PublicKey})
				found = true

				break
			}
		}

		if !found {
			return nil, 0, "", fmt.Errorf("@%s: guardians must be people you have a chat with", sanitize(name))
		}
	}

	if len(guardians) < minGuardians || len(guardians) > maxGuardians {
		return nil, 0, "", fmt.Errorf("choose %d to %d guardians", minGuardians, maxGuardians)
	}

	threshold := defaultThreshold(len(guardians))

	if typed := strings.TrimSpace(s.inputs[1].Value()); typed != "" {
		n, err := strconv.Atoi(typed)

		if err != nil || n < minGuardians || n > len(guardians) {
			return nil, 0, "", fmt.Errorf("the number needed: from %d to %d", minGuardians, len(guardians))
		}

		threshold = n
	}

	id := normalizeOstrichID(s.inputs[2].Value())

	if id == "" {
		return nil, 0, "", errInvalidOstrichID
	}

	return guardians, threshold, id, nil
}

// chooseGuardians splits the OstrichID among the guardians, each share
// sealed for their public key.
func chooseGuardians(token, ostrichID string, guardians []guardianKey, threshold int, status *recoveryStatus) error {
	setupID := newMessageID()
	shares, err := splitSecret([]byte(ostrichID), len(guardians), threshold, randomBytes(len(ostrichID)*(threshold-1)))
	if err != nil {
		return err
	}

	sealed := make([]shareSeal, len(guardians))

	for i, guardian := range guardians {
		box, sealer, err := sealForRecovery(guardian.publicKey, shares[i], shareContext(setupID, guardian.id))
		if err != nil {
			return err
		}

		sealed[i] = shareSeal{GuardianID: guardian.id, Sealed: box, SealerPublic: sealer}
	}

	return authorizedJSON(token, "PUT", "/api/recovery", map[string]any{
		"id":        setupID,
		"threshold": threshold,
		"auth_key":  deriveFromOstrichID(ostrichID).authKey,
		"shares":    sealed,
	}, status)
}

var errCodeMismatch = errors.New("the code does not match. Do not approve: whoever asks may not be your friend, or the request was tampered with")

// approveRecovery: the guardian's share, sealed again for the request's
// key, once the code the one asking read is the request's.
func approveRecovery(token string, privateKey []byte, userID string, friend guarding, typedCode string) error {
	want, err := recoveryCode(friend.Request.PublicKey)
	if err != nil {
		return err
	}

	digits := func(s string) string {
		return strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}

			return -1
		}, s)
	}

	if digits(typedCode) != digits(want) {
		return errCodeMismatch
	}

	share, err := openForRecovery(privateKey, friend.SealerPublic, friend.Sealed, shareContext(friend.SetupID, userID))
	if err != nil {
		return errors.New("your share could not be opened")
	}

	sealed, sealer, err := sealForRecovery(friend.Request.PublicKey, share, requestContext(friend.Request.ID))
	if err != nil {
		return err
	}

	return authorizedPost(token, "/api/recovery/requests/"+url.PathEscape(friend.Request.ID)+"/approve",
		map[string]string{"sealed": sealed, "sealer_public": sealer}, nil)
}
