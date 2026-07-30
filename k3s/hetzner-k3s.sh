#!/usr/bin/env bash
set -euo pipefail

if (($# == 0)); then
  printf 'Usage: ADMIN_CIDR=<ip>/32 %s <hetzner-k3s-command> [arguments]\n' "$0" >&2
  exit 64
fi

: "${ADMIN_CIDR:?Set ADMIN_CIDR to the administrative IP or CIDR allowed to reach SSH and the Kubernetes API.}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$repo_root/k3s/cluster-orbit-eu.yaml"
config="$(mktemp)"

cleanup() {
  rm -f "$config"
}
trap cleanup EXIT

while IFS= read -r line || [[ -n $line ]]; do
  printf '%s\n' "${line//__ADMIN_CIDR__/$ADMIN_CIDR}"
done < "$template" > "$config"

cd "$repo_root"
hetzner-k3s "$@" --config "$config"
