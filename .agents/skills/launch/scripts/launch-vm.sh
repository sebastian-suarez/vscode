#!/usr/bin/env bash
# Launch Code OSS (VS Code from sources) INSIDE the vsebcode Tart VM and tunnel
# its CDP port back to the host.
#
# Why: visual-validation rounds (D23) need a clean, reproducible picture of the
# workbench. The guest has its own compositor, a fixed display mode and none of
# the user's windows, so `screencapture` there is deterministic - vibrancy and
# all - and it never steals focus or covers the host desktop.
#
# Nothing builds in the guest. The umbrella repo is shared into the VM at
#   "/Volumes/My Shared Files/<share>"                      (NOTE the spaces)
# and the guest runs the host's out/, node_modules/ and .build/electron
# directly (host and guest are both arm64 macOS). The guest must NEVER write
# into the mount - the host owns watch and git.
#
# The launched profile is always VIRGIN: the guest has no authed profile, so
# none of launch.sh's authed-profile copying is done here. For authed flows and
# final checkpoints use scripts/launch.sh on the host instead.
#
# Prints a single JSON line to stdout with the instance id, ports, tunnel pid
# and guest paths. Logs go to stderr.
#
# Usage:
#   launch-vm.sh [--vm <name>] [--share-dir <host-path>] [--repo <repo-root>]
#                [-- <extra code.sh args>]
#   launch-vm.sh --kill <instance-id|all> [--stop-vm]
#   launch-vm.sh --stop-vm                      # implies --kill all
#
# Flags:
#   --kill <id|all>  Kill a launched instance: full process tree in the guest,
#                    its host->guest tunnel, and its guest user-data-dir. The
#                    VM keeps running unless --stop-vm is also passed.
#   --stop-vm        After killing, `tart stop` the VM as well.
#   --vm <name>      Tart VM name (default: vsebcode-vm).
#   --share-dir      Host path shared into the guest (default: the umbrella
#                    repo, i.e. the parent of the vscode checkout).
#   --repo <path>    vscode checkout on the host; only used to derive the
#                    guest-side repo path (default: this skill's checkout).
#
# Environment overrides: VSEBCODE_VM_NAME, VSEBCODE_VM_SSH_USER,
# VSEBCODE_VM_SSH_KEY, VSEBCODE_VM_STATE_DIR.

set -euo pipefail
umask 077

VM_NAME="${VSEBCODE_VM_NAME:-vsebcode-vm}"
SSH_USER="${VSEBCODE_VM_SSH_USER:-admin}"
SSH_KEY="${VSEBCODE_VM_SSH_KEY:-$HOME/.ssh/vsebcode_vm}"
STATE_DIR="${VSEBCODE_VM_STATE_DIR:-${TMPDIR:-/tmp}}"
STATE_DIR="${STATE_DIR%/}"
if [[ -z "${VSEBCODE_VM_STATE_DIR:-}" ]]; then
	STATE_DIR="$STATE_DIR/vsebcode-vm"
fi

SHARE_NAME="vsebcode"
GUEST_MOUNT_ROOT="/Volumes/My Shared Files"
GUEST_RES="1512x982"
GUEST_PORT_LO=9222
GUEST_PORT_HI=9271

MODE="launch"
KILL_TARGET=""
STOP_VM=0
SHARE_DIR=""
REPO=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--kill) MODE="kill"; KILL_TARGET="$2"; shift 2 ;;
		--stop-vm) STOP_VM=1; shift ;;
		--vm) VM_NAME="$2"; shift 2 ;;
		--share-dir) SHARE_DIR="$2"; shift 2 ;;
		--repo) REPO="$2"; shift 2 ;;
		--) shift; EXTRA_ARGS=("$@"); break ;;
		*) echo "Unknown arg: $1" >&2; exit 2 ;;
	esac
done

if [[ "$MODE" == "launch" && "$STOP_VM" == "1" ]]; then
	MODE="kill"
	KILL_TARGET="all"
fi

log() { echo "[launch-vm.sh] $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "$REPO" ]]; then
	REPO="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fi
if [[ ! -x "$REPO/scripts/code.sh" ]]; then
	echo "Not a vscode checkout: $REPO (no scripts/code.sh). Pass --repo <path>." >&2
	exit 2
fi
if [[ -z "$SHARE_DIR" ]]; then
	SHARE_DIR="$(cd "$REPO/.." && pwd)"
fi
GUEST_REPO="$GUEST_MOUNT_ROOT/$SHARE_NAME/$(basename "$REPO")"

if [[ ! -f "$SSH_KEY" ]]; then
	echo "SSH key not found: $SSH_KEY (set VSEBCODE_VM_SSH_KEY)." >&2
	exit 2
fi

SSH_OPTS=(
	-i "$SSH_KEY"
	-o StrictHostKeyChecking=no
	-o UserKnownHostsFile=/dev/null
	-o LogLevel=ERROR
	-o ConnectTimeout=10
	-o BatchMode=yes
)

VM_IP=""

# Quote a value so the guest shell reads it back unchanged.
#
# `%q` and not hand-rolled single quoting, because the output gets quoted a
# second time: the `-- <extra args>` string is built out of shquote calls and
# then handed to run_guest, which quotes the whole thing again for the
# `extra_args=` line it writes. Anything that does not survive that second pass
# reaches the guest as an unterminated quote and every launch carrying extra
# args dies there before it reaches `eval "set -- $extra_args"`.
shquote() {
	printf '%q' "$1"
}

# run_guest [VAR=value ...] <<'EOS' ... EOS
#
# Runs the script arriving on stdin under /bin/bash in the guest, with the
# given variables assigned at the top of it. Values are passed in the script
# body, never in the guest's argv - otherwise `pgrep -f <path>` inside the
# script would match the very shell running it (and the login zsh wrapping it),
# and the "wait until the tree is gone" loops would never finish.
#
# The guest login shell is zsh; keep bare `~` out of anything sent over, it
# triggers named-directory expansion. Use absolute paths.
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

vm_is_running() {
	tart list --format json 2>/dev/null | node -e '
		let raw = "";
		process.stdin.on("data", d => raw += d);
		process.stdin.on("end", () => {
			let list = [];
			try { list = JSON.parse(raw); } catch { process.exit(1); }
			const vm = list.find(v => v.Name === process.argv[1] && v.Source === "local");
			process.exit(vm && vm.Running ? 0 : 1);
		});
	' "$VM_NAME"
}

start_vm() {
	mkdir -p "$STATE_DIR"
	local vm_log="$STATE_DIR/vm-run.log"
	log "starting VM $VM_NAME (share $SHARE_NAME -> $SHARE_DIR); log: $vm_log"
	# `tart run` is a long-running foreground process - detach it so this
	# script (and the agent that called it) can return.
	nohup tart run "$VM_NAME" --no-graphics "--dir=$SHARE_NAME:$SHARE_DIR" \
		</dev/null >>"$vm_log" 2>&1 &
	disown $! 2>/dev/null || true
}

resolve_ip() {
	local waited="$1"
	VM_IP="$(tart ip "$VM_NAME" --wait "$waited" 2>/dev/null || true)"
	[[ -n "$VM_IP" ]]
}

wait_for_ssh() {
	local deadline=$((SECONDS + 180))
	log "waiting for ssh on $VM_IP (timeout 180s)..."
	while (( SECONDS < deadline )); do
		if ssh "${SSH_OPTS[@]}" "$SSH_USER@$VM_IP" true 2>/dev/null; then
			log "ssh ready"
			return 0
		fi
		sleep 2
	done
	echo "[launch-vm.sh] timed out waiting for ssh on $VM_IP" >&2
	return 1
}

ensure_vm() {
	if vm_is_running; then
		log "VM $VM_NAME already running"
	else
		start_vm
	fi
	if ! resolve_ip 180; then
		echo "[launch-vm.sh] could not get an IP for $VM_NAME (see $STATE_DIR/vm-run.log)" >&2
		exit 1
	fi
	log "VM ip: $VM_IP"
	wait_for_ssh
}

# The guest reverts to 1024x768@2x on every boot, ignoring the VZ display
# config. Re-applying is idempotent and instant. A failure here is not fatal:
# captures still work, just at the fallback resolution.
ensure_display() {
	log "applying guest display mode ($GUEST_RES @2x)..."
	if run_guest "res=$GUEST_RES" <<'EOS' >/dev/null 2>&1
set -eu
export PATH=/usr/local/bin:$PATH
screen_id=$(displayplacer list | awk -F': ' '/Persistent screen id/ { print $2; exit }')
[ -n "$screen_id" ] || exit 1
displayplacer "id:$screen_id res:$res hz:60 color_depth:7 scaling:on origin:(0,0) degree:0"
EOS
	then
		log "display mode applied"
	else
		echo "[launch-vm.sh] WARNING: could not apply the guest display mode - captures will be at the fallback resolution" >&2
	fi
}

# Right after boot `screencapture` fails with "could not create image from
# display" until the GUI session is up. Probe until it produces a real file.
wait_capture_ready() {
	log "waiting for the guest GUI session to be capture-ready (timeout 180s)..."
	if run_guest <<'EOS' >&2
set -eu
probe="/tmp/vseb-capture-probe-$$.png"
i=0
while [ "$i" -lt 90 ]; do
	i=$((i + 1))
	rm -f "$probe"
	if screencapture -x "$probe" >/dev/null 2>&1 && [ -s "$probe" ]; then
		rm -f "$probe"
		echo "[guest] capture-ready after ${i} attempt(s)"
		exit 0
	fi
	sleep 2
done
rm -f "$probe"
echo "[guest] screencapture never succeeded" >&2
exit 1
EOS
	then
		return 0
	fi
	echo "[launch-vm.sh] the guest GUI session never became capture-ready" >&2
	return 1
}

pick_host_port() {
	node -e '
		const net = require("net");
		const s = net.createServer();
		s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => console.log(p)); });
	'
}

# Scan a small fixed range in the guest so several instances can coexist; a
# port held by an already-running instance simply fails to bind and is skipped.
pick_guest_port() {
	run_guest "lo=$GUEST_PORT_LO" "hi=$GUEST_PORT_HI" <<'EOS'
set -eu
export PATH=/usr/local/bin:$PATH
export CDP_LO="$lo" CDP_HI="$hi"
node -e '
	const net = require("net");
	const lo = Number(process.env.CDP_LO), hi = Number(process.env.CDP_HI);
	const tryPort = p => new Promise(resolve => {
		const s = net.createServer();
		s.once("error", () => resolve(false));
		s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
	});
	(async () => {
		for (let p = lo; p <= hi; p++) {
			if (await tryPort(p)) { console.log(p); return; }
		}
		process.exit(1);
	})();
'
EOS
}

state_file_for() {
	echo "$STATE_DIR/$1.json"
}

read_state_field() {
	node -e '
		const fs = require("fs");
		let s;
		try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
		const v = s[process.argv[2]];
		console.log(v === undefined || v === null ? "" : String(v));
	' "$1" "$2"
}

kill_tunnel() {
	local pid="$1" host_port="$2" guest_port="$3"
	if [[ -n "$pid" && "$pid" != "0" ]] && kill -0 "$pid" 2>/dev/null; then
		kill "$pid" 2>/dev/null || true
	fi
	# Fall back to the forward spec, which is unique per instance, in case the
	# recorded pid was lost or the tunnel was re-established by hand.
	local stragglers
	stragglers="$(pgrep -f "L $host_port:127\.0\.0\.1:$guest_port" 2>/dev/null || true)"
	if [[ -n "$stragglers" ]]; then
		kill $stragglers 2>/dev/null || true
	fi
	local i
	for i in 1 2 3 4 5 6 7 8 9 10; do
		if [[ -z "$(pgrep -f "L $host_port:127\.0\.0\.1:$guest_port" 2>/dev/null || true)" ]]; then
			log "tunnel closed (host port $host_port)"
			return 0
		fi
		sleep 1
	done
	echo "[launch-vm.sh] WARNING: tunnel on host port $host_port did not close" >&2
	return 0
}

# A dying instance keeps writing state after its port frees, so a UDD must not
# be reused (or removed) until its whole process tree is gone.
kill_guest_instance() {
	local udd="$1" ext="$2" shared="$3" last="$4"
	run_guest "udd=$udd" "ext=$ext" "shared=$shared" "last=$last" <<'EOS' >&2
set -u
gone() { ! pgrep -f "$udd" >/dev/null 2>&1; }

pkill -f "$udd" >/dev/null 2>&1 || true
i=0
while [ "$i" -lt 30 ]; do
	i=$((i + 1))
	if gone; then break; fi
	if [ "$i" -eq 5 ]; then pkill -9 -f "$udd" >/dev/null 2>&1 || true; fi
	sleep 1
done
if ! gone; then
	echo "[guest] WARNING: processes still holding $udd:" >&2
	pgrep -lf "$udd" >&2 || true
else
	echo "[guest] instance tree gone after ${i}s"
fi

# When this was the last registered instance, nothing should be left at all.
if [ "$last" = "1" ]; then
	i=0
	while [ "$i" -lt 20 ]; do
		i=$((i + 1))
		if ! pgrep -f "Code - OSS" >/dev/null 2>&1; then break; fi
		sleep 1
	done
	if pgrep -f "Code - OSS" >/dev/null 2>&1; then
		echo "[guest] WARNING: other 'Code - OSS' processes are still running" >&2
	fi
fi

rm -rf "$udd" "$ext" "$shared"
EOS
}

do_kill() {
	local target="$1"
	if [[ ! "$target" =~ ^[A-Za-z0-9._-]+$ ]]; then
		echo "Invalid instance id: $target" >&2
		exit 2
	fi

	local files=()
	if [[ "$target" == "all" ]]; then
		local f
		for f in "$STATE_DIR"/*.json; do
			[[ -e "$f" ]] && files+=("$f")
		done
	else
		local sf
		sf="$(state_file_for "$target")"
		if [[ ! -f "$sf" ]]; then
			echo "No such instance: $target (looked for $sf)" >&2
			exit 2
		fi
		files=("$sf")
	fi

	if (( ${#files[@]} == 0 )); then
		log "no launched instances recorded in $STATE_DIR"
	else
		local vm_up=0
		if vm_is_running && resolve_ip 0; then
			vm_up=1
		else
			echo "[launch-vm.sh] WARNING: $VM_NAME is not reachable - cleaning up host-side state only" >&2
		fi

		local remaining=${#files[@]}
		local sf id udd ext shared tpid hport gport last
		for sf in "${files[@]}"; do
			id="$(read_state_field "$sf" instanceId || true)"
			udd="$(read_state_field "$sf" guestUserDataDir || true)"
			ext="$(read_state_field "$sf" guestExtensionsDir || true)"
			shared="$(read_state_field "$sf" guestSharedDataDir || true)"
			tpid="$(read_state_field "$sf" tunnelPid || true)"
			hport="$(read_state_field "$sf" hostCdpPort || true)"
			gport="$(read_state_field "$sf" guestCdpPort || true)"
			log "killing instance ${id:-?}"
			kill_tunnel "$tpid" "$hport" "$gport"
			remaining=$((remaining - 1))
			last=0
			if (( remaining == 0 )); then last=1; fi
			if (( vm_up == 1 )) && [[ -n "$udd" ]]; then
				kill_guest_instance "$udd" "$ext" "$shared" "$last"
			fi
			rm -f "$sf"
			log "instance ${id:-?} cleaned up"
		done
	fi

	if [[ "$STOP_VM" == "1" ]]; then
		log "stopping VM $VM_NAME"
		tart stop "$VM_NAME" || true
	else
		log "VM $VM_NAME left running"
	fi
}

if [[ "$MODE" == "kill" ]]; then
	mkdir -p "$STATE_DIR"
	do_kill "$KILL_TARGET"
	exit 0
fi

# ---------------------------------------------------------------- launch mode

mkdir -p "$STATE_DIR"
ensure_vm
ensure_display
wait_capture_ready

INSTANCE_ID="$(date +%Y%m%d-%H%M%S)-$$"
# The main process dies with `listen EINVAL ... main.sock` once the
# user-data-dir path passes ~103 characters, so keep these guest-local
# and short. Never point them at the mount - the guest must not write there.
GUEST_UDD="/tmp/vseb-$INSTANCE_ID"
GUEST_EXT="/tmp/vseb-$INSTANCE_ID-ext"
GUEST_SHARED="/tmp/vseb-$INSTANCE_ID-shared"
GUEST_LOG="/tmp/vseb-$INSTANCE_ID.log"
STATE_FILE="$(state_file_for "$INSTANCE_ID")"

GUEST_CDP_PORT="$(pick_guest_port | tail -n1)"
if [[ -z "$GUEST_CDP_PORT" ]]; then
	echo "[launch-vm.sh] no free guest port in $GUEST_PORT_LO-$GUEST_PORT_HI" >&2
	exit 1
fi
HOST_CDP_PORT="$(pick_host_port)"
log "instance $INSTANCE_ID: guest CDP $GUEST_CDP_PORT, host CDP $HOST_CDP_PORT"

EXTRA_QUOTED=""
if (( ${#EXTRA_ARGS[@]} )); then
	for arg in "${EXTRA_ARGS[@]}"; do
		EXTRA_QUOTED="$EXTRA_QUOTED $(shquote "$arg")"
	done
fi

log "launching Code OSS in the guest ($GUEST_REPO)..."
run_guest \
	"repo=$GUEST_REPO" \
	"udd=$GUEST_UDD" \
	"ext=$GUEST_EXT" \
	"shared=$GUEST_SHARED" \
	"log=$GUEST_LOG" \
	"port=$GUEST_CDP_PORT" \
	"extra_args=$EXTRA_QUOTED" <<'EOS' >&2
set -eu
export PATH=/usr/local/bin:$PATH
unset ELECTRON_RUN_AS_NODE || true

rm -rf "$udd" "$ext" "$shared"
mkdir -p "$udd/User" "$ext" "$shared"

# Same reason as on the host: the native file dialog cannot be driven over CDP,
# and the profile is brand new here so there is nothing to merge into.
printf '{\n\t"files.simpleDialog.enable": true\n}\n' > "$udd/User/settings.json"

eval "set -- $extra_args"

# NOTHING builds in the guest: preLaunch would want to download electron,
# compile, and install built-ins - all of which write into the shared mount
# that the host owns. The host has already built everything we run here.
export VSCODE_SKIP_PRELAUNCH=1

cd "$repo"
( nohup ./scripts/code.sh \
	"--user-data-dir=$udd" \
	"--extensions-dir=$ext" \
	"--shared-data-dir=$shared" \
	"--remote-debugging-port=$port" \
	"$@" </dev/null >"$log" 2>&1 & )
echo "[guest] launched; log: $log"
EOS

log "waiting for CDP on guest port $GUEST_CDP_PORT (timeout 120s)..."
if ! run_guest "port=$GUEST_CDP_PORT" "log=$GUEST_LOG" <<'EOS' >&2
set -u
i=0
while [ "$i" -lt 120 ]; do
	i=$((i + 1))
	if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$port/json/version"; then
		echo "[guest] CDP ready after ${i}s"
		exit 0
	fi
	sleep 1
done
echo "[guest] CDP never came up on port $port. Log tail:" >&2
tail -n 80 "$log" >&2 || true
exit 1
EOS
then
	echo "[launch-vm.sh] guest instance failed to come up; cleaning it up" >&2
	kill_guest_instance "$GUEST_UDD" "$GUEST_EXT" "$GUEST_SHARED" 0 || true
	exit 1
fi

log "opening CDP tunnel 127.0.0.1:$HOST_CDP_PORT -> guest 127.0.0.1:$GUEST_CDP_PORT"
ssh "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
	-f -N -L "$HOST_CDP_PORT:127.0.0.1:$GUEST_CDP_PORT" "$SSH_USER@$VM_IP"

# `ssh -f` forks, so $! is the parent that already exited. The forward spec is
# unique to this instance, so match on that.
TUNNEL_PID=""
for i in 1 2 3 4 5 6 7 8 9 10; do
	TUNNEL_PID="$(pgrep -f "L $HOST_CDP_PORT:127\.0\.0\.1:$GUEST_CDP_PORT" 2>/dev/null | head -n1 || true)"
	[[ -n "$TUNNEL_PID" ]] && break
	sleep 1
done
if [[ -z "$TUNNEL_PID" ]]; then
	echo "[launch-vm.sh] could not find the tunnel process for host port $HOST_CDP_PORT" >&2
	exit 1
fi

READY=0
for i in 1 2 3 4 5 6 7 8 9 10; do
	if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$HOST_CDP_PORT/json/version" 2>/dev/null; then
		READY=1
		break
	fi
	sleep 1
done
if [[ "$READY" != "1" ]]; then
	echo "[launch-vm.sh] the tunnel is up (pid $TUNNEL_PID) but CDP did not answer on 127.0.0.1:$HOST_CDP_PORT" >&2
	exit 1
fi
log "tunnel ready (pid $TUNNEL_PID)"

node -e '
	const [instanceId, vm, ip, guestCdpPort, hostCdpPort, tunnelPid,
		guestUserDataDir, guestExtensionsDir, guestSharedDataDir,
		guestLogFile, guestRepo, stateFile] = process.argv.slice(1);
	console.log(JSON.stringify({
		instanceId,
		vm,
		ip,
		guestCdpPort: Number(guestCdpPort),
		hostCdpPort: Number(hostCdpPort),
		tunnelPid: Number(tunnelPid),
		guestUserDataDir,
		guestExtensionsDir,
		guestSharedDataDir,
		guestLogFile,
		guestRepo,
		stateFile,
	}));
' "$INSTANCE_ID" "$VM_NAME" "$VM_IP" "$GUEST_CDP_PORT" "$HOST_CDP_PORT" "$TUNNEL_PID" \
	"$GUEST_UDD" "$GUEST_EXT" "$GUEST_SHARED" "$GUEST_LOG" "$GUEST_REPO" "$STATE_FILE" \
	> "$STATE_FILE"

cat "$STATE_FILE"
