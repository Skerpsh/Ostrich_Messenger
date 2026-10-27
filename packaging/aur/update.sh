#!/usr/bin/env bash
# Sets the AUR packages here to a release: pkgver, the checksums (from the
# release's SHA256SUMS) and .SRCINFO. Run by .github/workflows/release.yml,
# which then pushes them to the AUR; by hand:
#
#   packaging/aur/update.sh v1.5.4
#
# Needs makepkg (Arch) for .SRCINFO.
set -euo pipefail

tag="${1:?usage: update.sh vX.Y.Z}"
version="${tag#v}"
repo="Skerpsh/Ostrich_Messenger"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/SHA256SUMS" "https://github.com/$repo/releases/download/$tag/SHA256SUMS"
curl -fsSL -o "$tmp/LICENSE" "https://raw.githubusercontent.com/$repo/$tag/LICENSE"

sum() { awk -v f="$1" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS"; }
license=$(sha256sum "$tmp/LICENSE" | cut -d' ' -f1)

set_package() {
  local dir="$here/$1"
  shift
  sed -i "s/^pkgver=.*/pkgver=$version/; s/^pkgrel=.*/pkgrel=1/" "$dir/PKGBUILD"

  # name=sum pairs: sha256sums, sha256sums_x86_64...
  for pair in "$@"; do
    local name="${pair%%=*}" values="${pair#*=}"

    if [[ "$values" == *"''"* || -z "${values//[ \']/}" ]]; then
      echo "update.sh: no checksum for $name in $tag" >&2
      exit 1
    fi

    # The array may span lines: replaced as a whole.
    perl -0pi -e "s/^$name=\\([^)]*\\)/$name=($values)/m" "$dir/PKGBUILD"
  done

  (cd "$dir" && makepkg --printsrcinfo > .SRCINFO)
}

set_package ostrich-desktop-bin \
  "sha256sums='$(sum "Ostrich-Linux-$version.pacman")' '$license'"

set_package ostrich-cli-bin \
  "sha256sums='$license'" \
  "sha256sums_x86_64='$(sum "ostrich-linux-amd64-$version")'" \
  "sha256sums_aarch64='$(sum "ostrich-linux-arm64-$version")'"

echo "AUR packages set to $version"
