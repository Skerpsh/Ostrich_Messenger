# Ostrich in the AUR

- [`ostrich-desktop-bin`](https://aur.archlinux.org/packages/ostrich-desktop-bin): the desktop
  app, the release's `Ostrich-Linux-<version>.pacman` as it is
- [`ostrich-cli-bin`](https://aur.archlinux.org/packages/ostrich-cli-bin): the terminal client

```bash
yay -S ostrich-desktop-bin ostrich-cli-bin
```

Installed from here they do not update themselves: pacman (`yay -Syu`) does.

Each release sets them to its version (`update.sh`: pkgver, the checksums from the release's
`SHA256SUMS`, `.SRCINFO`) and pushes them to the AUR (the `aur` job of
[`release.yml`](../../.github/workflows/release.yml)), with the `AUR_SSH_KEY` secret: the private
half of an SSH key whose public half is in the AUR account (My Account → SSH Public Key).

Checking a package by hand, on Arch:

```bash
packaging/aur/update.sh v1.5.4
cd packaging/aur/ostrich-desktop-bin && makepkg -si
git checkout -- ..   # update.sh changed the files
```
