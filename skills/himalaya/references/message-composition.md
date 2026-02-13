# MML (MIME Meta Language) — Message Composition Reference

MML is a simple markup language for composing MIME emails. It lets you create HTML emails, attach files, embed inline images, and build complex multipart structures without manually constructing MIME boundaries.

Originally defined by the [Emacs MML module](https://www.gnu.org/software/emacs/manual/html_node/emacs-mime/MML-Definition.html), ported to Rust by the [Pimalaya project](https://github.com/pimalaya/core/tree/master/mml).

## Template Structure

A Himalaya email template has two sections separated by a blank line:

```
RFC 822 Headers
<blank line>
Body (plain text and/or MML markup)
```

## Headers

| Header | Purpose | Example |
|--------|---------|---------|
| `From` | Sender address | `From: Alice <alice@example.com>` |
| `To` | Recipient(s) | `To: bob@example.com, Carol <carol@example.com>` |
| `Cc` | Carbon copy | `Cc: dave@example.com` |
| `Bcc` | Blind carbon copy | `Bcc: eve@example.com` |
| `Subject` | Message subject | `Subject: Hello` |
| `Reply-To` | Reply address override | `Reply-To: noreply@example.com` |
| `In-Reply-To` | Message ID being replied to | `In-Reply-To: <id@localhost>` |

Multiple addresses are comma-separated. Named addresses use `Name <email>` format.

## MML Tags

| Tag | Purpose |
|-----|---------|
| `<#part ...>` | Define a single MIME part |
| `<#/part>` | Close a MIME part (optional if followed by another part or multipart end) |
| `<#multipart ...>` | Define a multipart container |
| `<#/multipart>` | Close a multipart container |
| `<#!part>` | Escaped literal `<#part>` (not compiled as MML) |

## Multipart Types

| Value | MIME Type | Use Case |
|-------|-----------|----------|
| `mixed` | `multipart/mixed` | Default. Body + attachments (unrelated parts) |
| `alternative` | `multipart/alternative` | Same content in different formats (text + HTML) |
| `related` | `multipart/related` | HTML with inline images referenced by `cid:` |

## Part Attributes

| Attribute | Description | Default |
|-----------|-------------|---------|
| `type` | MIME type (e.g., `text/html`, `image/jpeg`, `application/pdf`) | `text/plain`; auto-detected from file if `filename` is set |
| `filename` | Local file path to attach (shell `~` expansion supported) | — |
| `name` | Suggested filename in Content-Type header | — |
| `recipient-filename` | Override filename in Content-Disposition | basename of `filename` |
| `disposition` | `inline` or `attachment` | `attachment` when `filename` is set |
| `encoding` | Transfer encoding: `7bit`, `8bit`, `quoted-printable`, `base64` | auto-computed |
| `data-encoding` | Pre-decode inline data: `quoted-printable`, `base64` | — |
| `description` | Content-Description header | — |
| `charset` | Character set | `utf-8` |

## Examples

### Plain Text (no MML needed)

```
From: you@example.com
To: recipient@example.com
Subject: Hello

This is a plain text email. No MML tags required.
```

### HTML-Only Email

```
From: you@example.com
To: recipient@example.com
Subject: HTML Report

<#part type=text/html>
<h1>Monthly Report</h1>
<p>Here are the <strong>key metrics</strong>:</p>
<table>
  <tr><td>Revenue</td><td>$50,000</td></tr>
  <tr><td>Users</td><td>1,200</td></tr>
</table>
<#/part>
```

### Text + HTML Alternative

Email clients choose the best version (usually HTML, falling back to plain text):

```
From: you@example.com
To: recipient@example.com
Subject: Update

<#multipart type=alternative>
Here is the plain text version of the update.

<#part type=text/html>
<h1>Update</h1>
<p>Here is the <em>HTML</em> version of the update.</p>
<#/part>
<#/multipart>
```

### File Attachment

```
From: you@example.com
To: recipient@example.com
Subject: Document attached

Please find the document attached.

<#part filename=~/documents/report.pdf><#/part>
```

MIME type is auto-detected from file contents. Multiple attachments:

```
Here are the files you requested.

<#part filename=~/report.pdf><#/part>
<#part filename=~/data.xlsx><#/part>
```

### Attachment with Custom Name

```
<#part filename=/tmp/generated-output.pdf name=quarterly-report.pdf><#/part>
```

### Attachment with Description

```
<#part filename=~/report.pdf description="Q4 2024 Sales Report"><#/part>
```

### Inline Image

```
<#part disposition=inline filename=~/photos/banner.png><#/part>
```

### HTML Email with Inline Image (CID)

Use `multipart/related` so the HTML can reference the image by `cid:`:

```
From: you@example.com
To: recipient@example.com
Subject: Newsletter

<#multipart type=related>
<#part type=text/html>
<h1>Welcome!</h1>
<img src="cid:logo">
<p>Thanks for subscribing.</p>
<#/part>
<#part disposition=inline filename=~/images/logo.png><#/part>
<#/multipart>
```

### Full Email: Text + HTML + Attachments

The most complete pattern — text/HTML alternative body with file attachments:

```
From: you@example.com
To: recipient@example.com
Cc: manager@example.com
Subject: Quarterly Report

<#multipart type=mixed>
<#multipart type=alternative>
Please find the quarterly report attached.

<#part type=text/html>
<h2>Quarterly Report</h2>
<p>Please find the quarterly report attached.</p>
<p>Key highlights:</p>
<ul>
  <li>Revenue up 15%</li>
  <li>Customer satisfaction at 94%</li>
</ul>
<#/part>
<#/multipart>
<#part filename=~/reports/q4-report.pdf description="Q4 Report"><#/part>
<#part filename=~/reports/q4-data.xlsx description="Raw Data"><#/part>
<#/multipart>
```

### Reply with Attachment

```
From: you@example.com
To: colleague@example.com
In-Reply-To: <original-message-id@example.com>
Subject: Re: Budget Review

Here is the updated spreadsheet.

<#part filename=~/budget-v2.xlsx><#/part>
```

### Inline Text as Attachment

Send text content as a downloadable file:

```
<#part disposition=attachment name=notes.txt>
These are some notes sent as a text file attachment.
<#/part>
```

## Auto-Detection Behavior

- **MIME type**: Auto-detected from file contents when `filename` is set without `type`
- **Disposition**: Defaults to `attachment` when `filename` is set without `disposition`
- **Multipart wrapping**: Multiple top-level parts are auto-wrapped in `multipart/mixed`
- **Encoding**: Transfer encoding is auto-computed unless overridden with `encoding`

## Sending Templates via CLI

All examples above are sent by piping to `himalaya template send`:

```bash
cat << 'EOF' | himalaya template send
From: you@example.com
To: recipient@example.com
Subject: My Email

Body content here (with optional MML tags)
EOF
```

## PGP Encryption and Signing

Requires PGP feature enabled in Himalaya.

### Sign a message

```
<#part sign=pgpmime>
This message is cryptographically signed.
<#/part>
```

### Encrypt a message

```
<#part encrypt=pgpmime>
This is a secret message.
<#/part>
```

### Sign and encrypt

```
<#multipart type=mixed sign=pgpmime encrypt=pgpmime>
Secret signed content here.
<#/multipart>
```

Signing is applied first, then encryption wraps the signed message.
