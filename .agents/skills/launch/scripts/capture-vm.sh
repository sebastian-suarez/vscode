#!/usr/bin/env bash
# Screenshot the vsebcode VM's desktop and copy the PNG back to the host.
#
# This captures the guest's real compositor - vibrancy, blur, shadows and all -
# which is the whole point of VM mode (D23): the picture is identical whatever
# is happening on the host desktop, and nothing steals the user's focus.
#
# Usage:
#   capture-vm.sh <host-output.png> [delaySeconds]
#
# `delaySeconds` waits before capturing, to let the workbench settle after an
# interaction. Prints the host path on stdout; logs go to stderr.
#
# Environment overrides: VSEBCODE_VM_NAME, VSEBCODE_VM_SSH_USER,
# VSEBCODE_VM_SSH_KEY.

set -euo pipefail

VM_NAME="${VSEBCODE_VM_NAME:-vsebcode-vm}"
SSH_USER="${VSEBCODE_VM_SSH_USER:-admin}"
SSH_KEY="${VSEBCODE_VM_SSH_KEY:-$HOME/.ssh/vsebcode_vm}"

OUT=""
DELAY=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--vm) VM_NAME="$2"; shift 2 ;;
		-*) echo "Unknown arg: $1" >&2; exit 2 ;;
		*)
			if [[ -z "$OUT" ]]; then OUT="$1"; else DELAY="$1"; fi
			shift ;;
	esac
done

if [[ -z "$OUT" ]]; then
	echo "Usage: capture-vm.sh <host-output.png> [delaySeconds]" >&2
	exit 2
fi
if [[ ! "$DELAY" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
	echo "delaySeconds must be a number, got: $DELAY" >&2
	exit 2
fi
if [[ ! -f "$SSH_KEY" ]]; then
	echo "SSH key not found: $SSH_KEY (set VSEBCODE_VM_SSH_KEY)." >&2
	exit 2
fi

log() { echo "[capture-vm.sh] $*" >&2; }

VM_IP="$(tart ip "$VM_NAME" 2>/dev/null || true)"
if [[ -z "$VM_IP" ]]; then
	echo "[capture-vm.sh] $VM_NAME is not running - start it with launch-vm.sh first." >&2
	exit 1
fi

SSH_OPTS=(
	-i "$SSH_KEY"
	-o StrictHostKeyChecking=no
	-o UserKnownHostsFile=/dev/null
	-o LogLevel=ERROR
	-o ConnectTimeout=10
	-o BatchMode=yes
)

# Single-quote a value for the guest shell.
shquote() {
	printf "'%s'" "${1//\'/\'\\\'\'}"
}

# Values go in the script body, not in argv; the guest login shell is zsh, so
# keep bare `~` out of anything sent over.
run_guest() {
	local prefix=""
	local kv name value
	for kv in "$@"; do
		name="${kv%%=*}"
		value="${kv#*=}"
		prefix="$prefix$name=$(shquote "$value")
"
	done
	{ printf '%s' "$prefix"; cat; } | ssh "${SSH_OPTS[@]}" "$SSH_USER@$VM_IP" /bin/bash -s
}

if [[ "$DELAY" != "0" ]]; then
	log "waiting ${DELAY}s before capturing"
	sleep "$DELAY"
fi

GUEST_PNG="/tmp/vseb-cap-$(date +%Y%m%d-%H%M%S)-$$.png"

# Shortly after boot `screencapture` fails with "could not create image from
# display" until the GUI session is up, so retry a few times.
if ! run_guest "png=$GUEST_PNG" <<'EOS' >&2
set -u
i=0
while [ "$i" -lt 10 ]; do
	i=$((i + 1))
	rm -f "$png"
	if screencapture -x "$png" >/dev/null 2>&1 && [ -s "$png" ]; then
		exit 0
	fi
	sleep 1
done
echo "[guest] screencapture failed 10 times - is the GUI session up?" >&2
exit 1
EOS
then
	echo "[capture-vm.sh] capture failed in the guest" >&2
	exit 1
fi

mkdir -p "$(dirname "$OUT")"
scp "${SSH_OPTS[@]}" -q "$SSH_USER@$VM_IP:$GUEST_PNG" "$OUT"
run_guest "png=$GUEST_PNG" <<'EOS' >/dev/null 2>&1 || true
rm -f "$png"
EOS

if command -v sips >/dev/null 2>&1; then
	log "captured $(sips -g pixelWidth -g pixelHeight "$OUT" 2>/dev/null | awk '/pixelWidth/ { w = $2 } /pixelHeight/ { h = $2 } END { print w "x" h }') px"
fi

echo "$OUT"
