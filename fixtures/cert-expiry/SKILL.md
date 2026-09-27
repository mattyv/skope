---
name: cert-expiry
description: Check and renew TLS certificates before they expire. Use when a cert expiry alert fires or a site shows an expiring certificate.
---

# Cert expiry

*A [skope](https://github.com/mattyv/skope) skill. Run it with `skope` (see the run-skope-skill skill),
never by hand: its commands are reviewed as a set. `{names}` are params, set in the skope block below.*

```skope
format: 1
params:
  domain: example.com
  warn_seconds: 1209600   # 14 days
limits:
  run_timeout: 60s
  do_timeout: 5m
  ask_context: 2k tokens
```

Keep TLS certificates renewed. **Never** issue a cert with a new key
unless a human asks. Renewal should be boring: dry run first, then renew,
then reload. Don't **run** certbot with `--force-renewal`; it burns rate limits.

## Triage
Check what's actually being served, then what's on disk.

- **check** `echo | openssl s_client -connect {domain}:443 -servername {domain} 2>/dev/null | openssl x509 -checkend {warn_seconds} -noout` succeeds → stop
- **check** `openssl x509 -checkend {warn_seconds} -noout -in /etc/letsencrypt/live/{domain}/cert.pem` succeeds → [Reload]
- **run** `systemctl list-timers certbot.timer --no-pager` as timer
- **run** `journalctl -u certbot -n 50 --no-pager` as renew_log
- **Note:** a stopped timer or a failed HTTP challenge are the usual causes.
- **ask** Given {timer} and {renew_log}, what's the best next step? · sure 85%
  - [Renew]
  - [Page]
  - [Investigate]

## Renew
Dry run first, so nothing changes if the real renewal would fail. Always
keep the existing key.

- **do** `certbot renew --dry-run --cert-name {domain}` · else [Investigate]
- **do** `certbot renew --reuse-key --cert-name {domain}`
- **then** [Reload]

## Reload
The cert on disk is fresh, so the server just needs to pick it up.

- **run** `ss -ltnp 'sport = :443'` as listeners
- **ask** Given {listeners}, which server is serving {domain}? → one of [Servers] as server · sure 90%
- **do** `systemctl reload {server}`
- **check** `echo | openssl s_client -connect {domain}:443 -servername {domain} 2>/dev/null | openssl x509 -checkend {warn_seconds} -noout` succeeds → stop
- **then** [Page]

## Page
The cert can't be fixed automatically. Tell a human.

- **page** "{host}: cert for {domain} expires soon and couldn't be fixed automatically."

## Investigate
- **hand off**

Renewal is failing and the reason isn't obvious. Read the certbot log from
Triage. Common causes: DNS moved, port 80 blocked, a redirect breaking the
HTTP challenge. Don't change DNS or firewall rules without asking a human.

When you're done, suggest an edit to this skill as a diff. Don't edit the file.

## Servers
- nginx
- haproxy
