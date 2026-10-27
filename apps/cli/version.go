package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// The version of this build: set by the release workflow
// (-ldflags "-X main.version=v1.2.0"); "dev" for local builds.
var version = "dev"

const (
	repository  = "Skerpsh/Ostrich_Messenger"
	releasesURL = "https://github.com/" + repository + "/releases/latest"
)

// newerRelease returns the latest release's version if it is newer than
// this build; "" otherwise, also for local builds or without network.
// OSTRICH_NO_UPDATE_CHECK=1 turns the check off.
func newerRelease() string {
	if version == "dev" || os.Getenv("OSTRICH_NO_UPDATE_CHECK") != "" {
		return ""
	}

	client := http.Client{Timeout: 10 * time.Second}

	resp, err := client.Get("https://api.github.com/repos/" + repository + "/releases/latest")
	if err != nil {
		return ""
	}

	defer resp.Body.Close()

	var release struct {
		TagName string `json:"tag_name"`
	}

	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&release) != nil {
		return ""
	}

	if newerVersion(release.TagName, version) {
		return release.TagName
	}

	return ""
}

// newerVersion tells whether version a ("v1.2.3") is newer than b.
func newerVersion(a, b string) bool {
	pa, pb := versionParts(a), versionParts(b)

	if pa == nil || pb == nil {
		return false
	}

	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}

	return false
}

func versionParts(v string) []int {
	fields := strings.Split(strings.TrimPrefix(v, "v"), ".")

	if len(fields) != 3 {
		return nil
	}

	parts := make([]int, 3)

	for i, field := range fields {
		// "1.2.3-beta" counts as 1.2.3.
		field, _, _ = strings.Cut(field, "-")
		n, err := strconv.Atoi(field)

		if err != nil {
			return nil
		}

		parts[i] = n
	}

	return parts
}

// checkForUpdate looks for a newer release at start and puts it in place
// of this program (selfUpdate), or tells about it where it cannot.
// OSTRICH_NO_SELF_UPDATE=1: only tells.
func checkForUpdate() tea.Cmd {
	return task(func() func(*model) tea.Cmd {
		cleanOldBinary()
		latest := newerRelease()

		if latest == "" {
			return nil
		}

		err := errors.New("self-update is off")

		if os.Getenv("OSTRICH_NO_SELF_UPDATE") == "" {
			err = selfUpdate(latest)
		}

		return func(m *model) tea.Cmd {
			switch {
			case errors.Is(err, errNotWritable):
				return m.showToast("Ostrich "+latest+" is out: update it with your package manager", false)
			case err != nil:
				return m.showToast("Ostrich "+latest+" is out: "+releasesURL, false)
			}

			return m.showToast("Updated to Ostrich "+latest+": it runs from the next start", false)
		}
	})
}

// releaseBinary is this system's file in the release of tag (v1.5.0 →
// ostrich-linux-amd64-1.5.0).
func releaseBinary(tag string) string {
	name := "ostrich-" + runtime.GOOS + "-" + runtime.GOARCH + "-" + strings.TrimPrefix(tag, "v")

	if runtime.GOOS == "windows" {
		name += ".exe"
	}

	return name
}

// selfUpdate downloads the release's program for this system, checks it
// against the release's SHA256SUMS and puts it in place of this one (next
// to it first, then renamed, so it is never half written). An error where
// the program's folder is not the user's to write (installed by root).
func selfUpdate(tag string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}

	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return err
	}

	return replaceBinary(exe, tag)
}

// errNotWritable: the program is in a folder the user cannot write
// (installed by a package manager, or by root), which updates it instead.
var errNotWritable = errors.New("the program's folder is not writable")

// replaceBinary puts the release's program for this system at exe.
func replaceBinary(exe, tag string) error {
	probe, err := os.CreateTemp(filepath.Dir(exe), ".ostrich-update-*")
	if err != nil {
		return errNotWritable
	}

	probe.Close()
	os.Remove(probe.Name())

	base := "https://github.com/" + repository + "/releases/download/" + url.PathEscape(tag) + "/"
	name := releaseBinary(tag)

	sums, err := download(base+"SHA256SUMS", 1<<20)
	if err != nil {
		return err
	}

	signature, err := download(base+"SHA256SUMS.sig", 1<<10)
	if err != nil {
		return err
	}

	if !verifyRelease(sums, signature) {
		return errors.New("SHA256SUMS is not signed by Ostrich's release key")
	}

	want := ""

	for _, line := range strings.Split(string(sums), "\n") {
		if fields := strings.Fields(line); len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name {
			want = fields[0]
		}
	}

	if want == "" {
		return errors.New("the release has no " + name)
	}

	data, err := download(base+name, 200<<20)
	if err != nil {
		return err
	}

	if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != want {
		return errors.New("the download does not match SHA256SUMS")
	}

	next := exe + ".new"

	if err := os.WriteFile(next, data, 0o755); err != nil {
		return err
	}

	// Windows cannot write over a running program, but can rename it.
	if runtime.GOOS == "windows" {
		_ = os.Remove(exe + ".old")

		if err := os.Rename(exe, exe+".old"); err != nil {
			os.Remove(next)
			return err
		}
	}

	if err := os.Rename(next, exe); err != nil {
		os.Remove(next)
		return err
	}

	return nil
}

// The public half of the key release.yml signs SHA256SUMS with (Ed25519,
// the RELEASE_SIGNING_KEY secret), so a release changed by anyone else is
// not installed.
const releasePublicKey = "Zn7AoRPQh0TtFNiJOCnLELZeCeqp74kjK7pdEST9+Wk="

func verifyRelease(sums, signature []byte) bool {
	key, err := base64.StdEncoding.DecodeString(releasePublicKey)

	return err == nil && len(key) == ed25519.PublicKeySize && ed25519.Verify(key, sums, signature)
}

// cleanOldBinary removes what a self-update left on Windows.
func cleanOldBinary() {
	if exe, err := os.Executable(); err == nil && runtime.GOOS == "windows" {
		_ = os.Remove(exe + ".old")
	}
}

func download(address string, limit int64) ([]byte, error) {
	client := http.Client{Timeout: 3 * time.Minute}

	resp, err := client.Get(address)
	if err != nil {
		return nil, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: HTTP %d", address, resp.StatusCode)
	}

	return io.ReadAll(io.LimitReader(resp.Body, limit))
}
