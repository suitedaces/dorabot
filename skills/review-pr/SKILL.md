---
name: review-pr
description: "Review GitHub pull requests with structured code analysis. Use when asked to review a PR, check a pull request, or audit code changes."
metadata:
  { "requires": { "bins": ["gh", "jq"] } }
---

# PR Review Skill

Review GitHub pull requests with structured analysis covering correctness, security, performance, and style.

## Invocation

Triggered by: `/review-pr <url-or-number>`, "review this PR", "review PR #123", or a GitHub PR URL.

Parse the input:
- Full URL: `https://github.com/owner/repo/pull/123` -> extract owner, repo, number
- Number only: `#123` or `123` -> use current repo from `gh repo view --json nameWithOwner -q .nameWithOwner`
- If ambiguous, ask for the repo.

## Step 1: Gather Context

Run these in parallel:

```bash
# PR metadata
gh pr view <number> --repo <owner/repo> --json title,body,author,baseRefName,headRefName,createdAt,additions,deletions,changedFiles,labels,reviewRequests,mergeable,state

# Full diff
gh pr diff <number> --repo <owner/repo>

# File list with stats
gh pr view <number> --repo <owner/repo> --json files --jq '.files[] | "\(.additions)+/\(.deletions)- \(.path)"'

# CI status
gh pr checks <number> --repo <owner/repo> 2>/dev/null || echo "No checks"

# Existing review comments (avoid duplicating feedback)
gh api repos/<owner>/<repo>/pulls/<number>/comments --jq '.[] | "[\(.path):\(.line // .original_line)] @\(.user.login): \(.body)"' 2>/dev/null | head -50
```

## Step 2: Analyze the Diff

Read the full diff carefully. For each file, evaluate:

### Correctness
- Logic errors, off-by-one, null/undefined handling
- Missing error handling or edge cases
- Broken contracts (function signatures changed without updating callers)
- Race conditions or concurrency issues

### Security
- User input flowing to SQL, shell commands, file paths, or HTML without sanitization
- Hardcoded secrets, API keys, or credentials
- Overly broad permissions or missing auth checks
- Unsafe deserialization or eval usage

### Performance
- O(n^2) or worse algorithms where O(n) is possible
- Unnecessary re-renders in React (missing memo/useMemo/useCallback)
- N+1 queries or unbounded data fetching
- Large allocations in hot paths

### Architecture
- Does this change belong in this file/module?
- Are abstractions appropriate (not too much, not too little)?
- Does it follow existing patterns in the codebase?
- Will this be maintainable?

### Style
- Naming clarity
- Dead code or TODOs left behind
- Missing types (in TypeScript)
- Inconsistent formatting (only flag if egregious)

## Step 3: Write the Review

Output a structured review in this format:

```
## PR Review: <title>

**Summary**: 1-3 sentence overview of what this PR does and whether it's ready.

**Verdict**: APPROVE | REQUEST_CHANGES | COMMENT

### Findings

#### <severity-emoji> <category>: <short description>
**File**: `path/to/file.ts` L<line>-L<line>
<explanation of the issue and why it matters>

**Suggested fix**:
\`\`\`diff
- old code
+ new code
\`\`\`

---
(repeat for each finding)
```

Severity emojis:
- `[blocker]` - Must fix before merge. Bugs, security issues, data loss risks.
- `[warning]` - Should fix. Performance problems, poor patterns, missing edge cases.
- `[nit]` - Optional. Style, naming, minor improvements.
- `[praise]` - Good stuff. Call out well-written code (do this at least once).

### Guidelines

- Be specific. Quote the code, give line numbers, explain why.
- Suggest fixes, not just problems. Include diff snippets.
- Don't nitpick formatting if there's a formatter configured.
- If the PR is large (>500 lines), focus on the riskiest files first.
- If the PR description explains a deliberate tradeoff, don't re-litigate it.
- Check the test coverage: are new code paths tested? Are edge cases covered?

## Step 4: Post the Review (Optional)

Only post to GitHub if the user explicitly asks. Use:

```bash
# Post a review comment (not individual line comments)
gh pr review <number> --repo <owner/repo> --comment --body "<review body>"

# Or approve/request changes
gh pr review <number> --repo <owner/repo> --approve --body "<review body>"
gh pr review <number> --repo <owner/repo> --request-changes --body "<review body>"
```

For inline comments on specific lines:

```bash
gh api repos/<owner>/<repo>/pulls/<number>/comments \
  -f body="<comment>" \
  -f path="<file>" \
  -f commit_id="$(gh pr view <number> --repo <owner/repo> --json headRefOid -q .headRefOid)" \
  -F line=<line_number> \
  -f side="RIGHT"
```

Always show the review to the user first and get confirmation before posting to GitHub.

## Quick Mode

For small PRs (<100 lines changed), skip the full structure. Give a concise paragraph covering the key points and verdict.

## Batch Review

When reviewing multiple PRs (e.g., "review all open PRs"):

```bash
gh pr list --repo <owner/repo> --json number,title,author,additions,deletions --jq '.[] | "#\(.number) \(.title) by @\(.author.login) (+\(.additions)/-\(.deletions))"'
```

Triage by size and risk, review the largest/riskiest first.
