#!/bin/sh
# subfinder-lab: training stand-in for `subfinder -d <domain> -silent`.
# It reads a controlled training feed from the lab (no live sources are queried), so the result is the same for everyone.
# Read it before you run it: it only makes one request to the lab it came from.
LAB="__LAB__"
domain=""
while [ $# -gt 0 ]; do
  case "$1" in
    -d) domain="$2"; shift 2 ;;
    -silent) shift ;;
    *) echo "[FTL] unsupported option: $1 (use: sh subfinder-lab.sh -d <domain> -silent)" >&2; exit 2 ;;
  esac
done
case "$domain" in
  ""|*[!a-z0-9.-]*) echo "[FTL] give a valid domain: -d <domain>" >&2; exit 2 ;;
esac
echo "[SIM] Controlled training dataset: no live sources are queried, so results are the same every run." >&2
curl -fsS "$LAB/feed/$domain.txt" || { echo "[FTL] \"$domain\" is not in scope for this exercise, or the lab is not reachable." >&2; exit 3; }
