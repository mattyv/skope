#!/bin/sh
# Installs a skope standalone binary (SPEC §5.5):
#
#   curl -fsSL https://github.com/mattyv/skop/releases/latest/download/install.sh | sh
#
# POSIX sh, checked with shellcheck. Supported platforms: linux x64/arm64,
# darwin arm64 (SPEC §5.5) — anything else exits non-zero, naming itself.
#
# Env vars:
#   SKOPE_VERSION       Version to install, e.g. 1.2.3 (without the "v").
#                       Defaults to the latest GitHub release.
#   SKOPE_DOWNLOAD_URL  Base URL to download the binary and SHA256SUMS from,
#                      for mirrors and tests. Defaults to the matching
#                      GitHub release's download URL.
#   SKOPE_INSTALL_DIR   Where to install. Defaults to ~/.local/bin. Never
#                      uses sudo.
set -eu

repo="mattyv/skop"
install_dir="${SKOPE_INSTALL_DIR:-"$HOME/.local/bin"}"

say() { printf '%s\n' "$*" >&2; }
die() {
  say "install.sh: $*"
  exit 1
}

# --- detect OS and CPU (SPEC §5.5: exit non-zero naming the platform if
# there's no binary for it) ---------------------------------------------
uname_s=$(uname -s)
uname_m=$(uname -m)

case "$uname_s" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "no skope binary for platform $uname_s/$uname_m" ;;
esac

case "$uname_m" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) die "no skope binary for platform $uname_s/$uname_m" ;;
esac

# Only linux/x64, linux/arm64 and darwin/arm64 ship a binary (SPEC §5.5).
if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
  die "no skope binary for platform $uname_s/$uname_m"
fi

# --- pick a downloader ----------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q "$1" -O "$2"; }
else
  die "need curl or wget to download skope"
fi

# --- resolve the download URL ------------------------------------------
# SKOPE_DOWNLOAD_URL substitutes for "https://github.com/$repo/releases" (for
# mirrors and tests); SKOPE_VERSION then picks a release under it the same
# way whether it's the default GitHub host or a mirror.
releases_base="${SKOPE_DOWNLOAD_URL:-"https://github.com/$repo/releases"}"
if [ -n "${SKOPE_VERSION:-}" ]; then
  base_url="$releases_base/download/v$SKOPE_VERSION"
else
  base_url="$releases_base/latest/download"
fi

tmp_dir=$(mktemp -d) || die "couldn't create a temp directory"
trap 'rm -rf "$tmp_dir"' EXIT

fetch "$base_url/SHA256SUMS" "$tmp_dir/SHA256SUMS" || die "couldn't download SHA256SUMS from $base_url (installing nothing)"

# The binary's exact name embeds the release version (skope-<version>-<os>-
# <arch>), which this script may not know in advance (the default and
# SKOPE_DOWNLOAD_URL cases resolve "latest" server-side). Read it out of
# SHA256SUMS instead of guessing it, by matching the one entry for this
# platform. sha256sum writes "<hash>  <name>" or "<hash> *<name>" in binary
# mode; strip a leading "*" either way.
binary_name=$(awk -v suffix="-${os}-${arch}" '{ name = $2; sub(/^\*/, "", name); if (name ~ (suffix "$")) print name }' "$tmp_dir/SHA256SUMS")
case "$(printf '%s\n' "$binary_name" | grep -c .)" in
  0) die "SHA256SUMS has no entry for $os/$arch; installing nothing" ;;
  1) ;;
  *) die "SHA256SUMS has more than one entry for $os/$arch; installing nothing" ;;
esac

say "Downloading $binary_name..."
fetch "$base_url/$binary_name" "$tmp_dir/$binary_name" || die "couldn't download $binary_name from $base_url"

# --- verify the checksum (SPEC §5.5: install nothing on a mismatch or a
# missing SHA256SUMS; this catches a corrupt or truncated download, not a
# compromised release) -------------------------------------------------
if command -v sha256sum >/dev/null 2>&1; then
  checksum() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  checksum() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "need sha256sum or shasum to verify the download"
fi

want=$(awk -v name="$binary_name" '{ n = $2; sub(/^\*/, "", n); if (n == name) print $1 }' "$tmp_dir/SHA256SUMS")
got=$(checksum "$tmp_dir/$binary_name")
[ "$got" = "$want" ] || die "checksum mismatch for $binary_name (want $want, got $got); installing nothing"

# --- install ----------------------------------------------------------------
mkdir -p "$install_dir"
chmod +x "$tmp_dir/$binary_name"
mv "$tmp_dir/$binary_name" "$install_dir/skope"

case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    say "Note: $install_dir isn't on your PATH. Add this to your shell profile:"
    say "  export PATH=\"$install_dir:\$PATH\""
    ;;
esac

"$install_dir/skope" --version
