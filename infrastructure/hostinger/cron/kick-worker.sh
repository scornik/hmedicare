#!/bin/sh
# hPanel Custom Cron (every minute): wakes the worker and, in `cron` runner mode, runs one bounded job batch
# (ADR-015 §7, HOST-005/006). The token is read from a private file outside the web root; it is never on
# the command line (process lists) and never committed.
#
#   * * * * *  sh ~/hmedic-ops/kick-worker.sh https://worker.<domain> ~/hmedic-ops/cron-token
#
# Create the token file once with mode 600:  umask 077 && printf '%s' '<INTERNAL_CRON_TOKEN>' > ~/hmedic-ops/cron-token
set -eu
URL="${1:?worker base URL}"
TOKEN_FILE="${2:?token file}"
[ -r "$TOKEN_FILE" ] || { echo "kick-worker: token file not readable" >&2; exit 2; }
# curl reads the header from stdin (-H @-) so the token never appears in argv.
printf 'Authorization: Bearer %s\n' "$(cat "$TOKEN_FILE")" |
  curl -fsS -m 55 -o /dev/null -X POST -H @- "$URL/internal/jobs/run"
