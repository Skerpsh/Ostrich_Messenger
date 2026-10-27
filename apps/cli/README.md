# Ostrich CLI

The terminal client: the same chats, end-to-end encryption and settings as
the apps, in one frame drawn with lines: the chats on the left and the open
chat on the right (one at a time in a narrow terminal), the keys that matter
on the line under it. Works with the keyboard and the mouse.

```
┌ Ostrich ───────────────┬───────────────────────────── @bob · online ┐
│ Chats  1 unread      + │ alice                               pinned │
├────────────────────────┼────────────────────────────────────────────┤
│▌ alice           20:11 │  alice                               20:10 │
│▌ See you then        1 │  See you at eight?                         │
│                        │                                            │
│  # Ostrich team  23.10 │  you                              ✓✓ 20:11 │
│  carol: Hello          │  See you then                              │
│                        ├────────────────────────────────────────────┤
│                        │ > Message                                  │
└────────────────────────┴────────────────────────────────────────────┘
 Enter send  Alt+Enter new line  ↑ choose a message  Ctrl+P commands
```

## Install

Linux and macOS:

```bash
curl -fsSL https://github.com/Skerpsh/Ostrich_Messenger/releases/latest/download/install.sh | sh
```

It downloads the build for your system from the latest release, checks its
SHA-256 and puts it in `~/.local/bin/ostrich`. Windows: download
`ostrich-windows-amd64-<version>.exe` from the
[latest release](https://github.com/Skerpsh/Ostrich_Messenger/releases/latest)
(SmartScreen asks once: *More info* → *Run anyway*).

`ostrich --version` shows the version. At start the CLI looks for a newer
release and puts it in place of itself (checked against the release's
`SHA256SUMS`; it runs from the next start). Where it cannot write its own file
(installed by root), it says the release is out instead;
`OSTRICH_NO_SELF_UPDATE=1` only says it, `OSTRICH_NO_UPDATE_CHECK=1` turns the
check off.

From the source: `cd apps/cli && go build -o ostrich . && ./ostrich`.

## Releasing

```bash
git tag v1.2.0 && git push origin v1.2.0
```

The *Release* workflow (`.github/workflows/release.yml`) tests and builds the
CLI for Linux, macOS and Windows (x86 and ARM) and publishes the files,
`install.sh` and `SHA256SUMS` in the release, next to the Android app, with
notes from the commits since the last tag.

`OSTRICH_SERVER=http://localhost:3000 ./ostrich` uses another backend. Invite and profile links point
to the web app: Ostrich's site for the default server, the server's own address for another
one, or `OSTRICH_WEB` when set.

Preferences (colors, theme, accent color, bell) and the contacts' keys seen
so far are kept in `~/.config/ostrich/`.

## Colors

By default the CLI uses the terminal's own colors: its background, its text
and its palette for the accent, so it fits whatever theme the terminal has.
Settings → Appearance → *Use the terminal's colors* off switches to
Ostrich's light or dark theme on one even background (`t` toggles light and
dark), with the accent of your choice.

*Sync the theme with my devices* takes the light or dark theme and the
accent from the apps' synced settings and writes them back when they are
changed here; the rest of those settings (text size, chats' looks) is left
as it is. They are encrypted with a key of the account's, like in the apps.

The profile photo and the profile's QR code are only in the apps; the CLI
copies the profile's link.

## Remember me

With "Remember me on this computer" checked on the login screen (on by
default, `Ctrl+R` toggles it), the CLI starts logged in next time, like the
web app. The session token and the account's private key go to the system
keyring (GNOME Keyring / KWallet, the macOS Keychain, the Windows Credential
Manager); without one, e.g. on a server over SSH, to
`~/.config/ostrich/session-*.json`, readable only by you.

A remembered session also keeps a local cache in
`~/.config/ostrich/cache-*.json` (readable only by you): the chats list, the
newest messages of the chats you opened (end-to-end encrypted, as the server
sends them) and messages not sent yet, so the CLI opens at once and works
offline; unsent messages go out once it is back online.

A remembered session stays when the CLI is closed. It ends, and is
forgotten here together with the cache, with Settings → Log out, Log out of
all devices, deleting the account, logging this device out from another
one, or after 30 days unused. Uncheck "Remember me" on a computer you share: then closing the CLI
logs out.

## Keys

`Ctrl+P` lists everything that can be done where you are: the chosen
message's actions, the open chat's and the rest, each with its key; type to
filter, `Enter` does it. `F1` (or `?` outside a text field) shows the keys.

| Where | Keys |
|---|---|
| Everywhere | `Ctrl+P` commands, `F1` keys, `Tab` between the chats and the chat, `Esc` back / close, `Ctrl+C` quit |
| Login | `Tab` log in / create account, `↑↓` field, `Ctrl+R` remember me, `Ctrl+L` log in with a QR code, `Ctrl+F` recover with friends, `Enter` next / submit |
| Chats list | `↑↓` move, `Enter` open, `/` search (or paste an invite or profile link), `n` new chat (type a @username), `N` new group, `v` Saved messages, `m` chat menu (pin, mute, clear, delete), `s` settings, `t` light / dark, `q` quit |
| Chat | `Enter` send, `Alt+Enter` new line, `Ctrl+A` attach a file (type or drop its path; `Ctrl+X` removes the last), `↑` (empty input) choose a message, `Ctrl+O` chat menu (also: seal the next message as a letter to the future), `Ctrl+F` search, `Ctrl+K` safety code, `PgUp/PgDn` scroll |
| Chosen message | `Enter` menu (also: forward, pin, save its files to `~/Downloads`), `r` reply, `e` edit, `d` delete, `c` copy, `s` what the server sees, `1`–`8` react |
| Menus | type to filter, `↑↓` choose, `Enter` select (destructive actions ask twice), `1`–`8` react, `Esc` clear the filter / close |
| Settings | `↑↓` the parts (Profile, Appearance, Account, Privacy, Notifications, Devices, Recovery through friends, Security, Danger zone), `Enter` open one, then `↑↓` its rows, `Enter` choose, `←→` change a value, `Esc` back to the parts / close |

Mouse: click a chat to open it, right-click it (or a message) for its menu,
scroll the wheel over the messages; the chat's name (its menu, or a group's
info), your name at the top (Settings), the parts and rows of Settings and
the menus' items are clickable too.

## Safety code

`Ctrl+K` (or *Safety code* in the chat's menu) shows 40 digits that are the
same on both sides of a chat. Compare them with your contact: if they match,
the server has not swapped your keys. When a contact's key changes, the chat
warns and holds back sending until the codes are confirmed (`y`).
