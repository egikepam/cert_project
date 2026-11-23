---
name: prepare-changes-for-git
description: Prepare the current uncommitted changes for a git commit or pull request. Runs the code-reviewer subagent on the changed files, then writes a change description grouped by priority (high, medium, low) with a suggested commit message. Use whenever the user says "prepare changes for git", or asks to summarize, describe or review what changed before committing or opening a PR. Read-only: never commits or pushes.
---

# Prepare changes for git

Produce an analysis of the working-tree changes that the user can paste into a commit or PR. Do not stage, commit or push; this project only commits when explicitly asked.

## Steps

1. **Collect the changes.** Run `git status --short` and `git diff HEAD` (new untracked files do not appear in the diff, so read them directly). Skip `data/`, which is git-ignored personal data. If there are no changes, say so and stop.
2. **Run the `code-reviewer` subagent** (Agent tool, `subagent_type: "code-reviewer"`). The subagent is read-only and has no git access, so give it what it needs: the list of changed files, the diff (or the relevant parts of it), and a request to review only these changes for bugs and readability. Run it once for all files unless the diff is large, in which case run one per file group in parallel.
3. **Check its findings against the diff.** Drop anything that is not in the changed code or does not hold up, and mark pre-existing issues as such so they are not blamed on this change.
4. **Write the analysis** in the format below.

## Priority levels

Sort every change into one level, by its effect on users and data rather than by size:

- **High**: changes behaviour or risk. Bug fixes, data handling, security, server or storage logic, anything that could lose data or break the app.
- **Medium**: new or changed features, refactors, UI changes that do not alter data safety.
- **Low**: comments, docs (README, CLAUDE.md), formatting, renames, config.

Omit a level that has no entries.

## Output format

Use exactly this structure:

```
## Summary
One or two sentences on what this set of changes does.

## Changes
### High priority
- `file`: what changed and why it matters
### Medium priority
- ...
### Low priority
- ...

## Review findings
Findings from code-reviewer that apply to these changes (Bug / Risk / Readability), each with file:line.
Say "No issues found" if clean. List pre-existing issues separately, briefly.

## Suggested commit message
<imperative subject, max 72 chars>

<short body, optional>

## PR description
Short paragraph, plus a "Testing" line describing how to verify (this project has no tests: say what to check manually or with `node --check`).
```

Keep it concise: someone should be able to read it in under a minute. End by asking whether to commit.
