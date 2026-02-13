# Himalaya Configuration Reference

Configuration file location: `~/.config/himalaya/config.toml`

## Interactive Setup

The easiest way to configure an account:

```bash
himalaya account configure
```

This walks through IMAP/SMTP setup interactively.

## Manual Configuration

### Minimal Example (IMAP + SMTP)

```toml
[accounts.personal]
email = "you@example.com"
display-name = "Your Name"
default = true

backend.type = "imap"
backend.host = "imap.example.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "you@example.com"
backend.auth.type = "password"
backend.auth.cmd = "pass show email/imap"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.example.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "you@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "pass show email/smtp"
```

### Multiple Accounts

```toml
[accounts.personal]
email = "personal@example.com"
display-name = "Your Name"
default = true
# ... backend config ...

[accounts.work]
email = "you@company.com"
display-name = "Your Name"
# ... backend config ...
```

Use `--account work` to select a non-default account.

## Authentication Methods

### Password Command (recommended)

Runs a shell command that outputs the password on stdout. Works with `pass`, `1password-cli`, `security` (macOS keychain), etc.

```toml
backend.auth.type = "password"
backend.auth.cmd = "pass show email/imap"
```

macOS Keychain example:

```toml
backend.auth.cmd = "security find-generic-password -a you@example.com -s himalaya-imap -w"
```

1Password CLI example:

```toml
backend.auth.cmd = "op read 'op://Personal/Email/password'"
```

### OAuth2

```toml
backend.auth.type = "oauth2"
backend.auth.client-id = "your-client-id"
backend.auth.client-secret.cmd = "pass show email/oauth-secret"
backend.auth.access-token.cmd = "pass show email/oauth-access"
backend.auth.refresh-token.cmd = "pass show email/oauth-refresh"
backend.auth.auth-url = "https://accounts.google.com/o/oauth2/auth"
backend.auth.token-url = "https://oauth2.googleapis.com/token"
backend.auth.scopes = ["https://mail.google.com/"]
```

## Encryption Types

| Value | Port (typical) | Description |
|-------|----------------|-------------|
| `tls` | 993 (IMAP), 465 (SMTP) | Implicit TLS from connection start |
| `start-tls` | 143 (IMAP), 587 (SMTP) | Starts unencrypted, upgrades via STARTTLS |
| `none` | — | No encryption (not recommended) |

## Common Provider Settings

### Gmail

```toml
backend.type = "imap"
backend.host = "imap.gmail.com"
backend.port = 993
backend.encryption.type = "tls"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.gmail.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
```

Gmail requires an App Password or OAuth2 (regular password won't work with 2FA enabled).

### Outlook / Microsoft 365

```toml
backend.type = "imap"
backend.host = "outlook.office365.com"
backend.port = 993
backend.encryption.type = "tls"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.office365.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
```

### Fastmail

```toml
backend.type = "imap"
backend.host = "imap.fastmail.com"
backend.port = 993
backend.encryption.type = "tls"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.fastmail.com"
message.send.backend.port = 465
message.send.backend.encryption.type = "tls"
```

### iCloud Mail

```toml
backend.type = "imap"
backend.host = "imap.mail.me.com"
backend.port = 993
backend.encryption.type = "tls"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.mail.me.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
```

iCloud requires an App-Specific Password (generate at appleid.apple.com).

## Alternative Backends

### Notmuch (local indexing)

```toml
backend.type = "notmuch"
backend.db-path = "~/.local/share/notmuch/default"
```

### Maildir (local storage)

```toml
backend.type = "maildir"
backend.root-dir = "~/Maildir"
```

### Sendmail (local sending)

```toml
message.send.backend.type = "sendmail"
message.send.backend.cmd = "/usr/sbin/sendmail"
```

## Optional Settings

### Folder Aliases

Map custom names to server folder names:

```toml
[accounts.personal.folder.alias]
inbox = "INBOX"
sent = "Sent Mail"
drafts = "[Gmail]/Drafts"
trash = "[Gmail]/Trash"
```

### Signature

```toml
[accounts.personal]
signature = "Best regards,\nYour Name"
# or from file:
signature.cmd = "cat ~/.signature"
```

### Downloads Directory

```toml
[accounts.personal]
downloads-dir = "~/Downloads"
```