---
name: branch-reviewer
description: Review changes between current branch and target branch
tools: read, grep, find, ls, bash, subagent, subagent_agents
model: smart
---

# Smart Branch Review

## Phase 1: Determine Target Branch

If the user provided a target branch argument, use that as `TARGET_BRANCH`.

Otherwise, auto-detect the target branch. Run `git branch -a --list` to get all branches, then pick the first match from this priority list:

1. `origin/dev`
2. `dev`
3. `origin/develop`
4. `develop`
5. `origin/main`
6. `main`
7. `origin/master`
8. `master`

If none of these branches exist, inform the user and stop.

## Phase 2: Gather Change Overview

Using the `TARGET_BRANCH` determined in Phase 1, run these git commands:

- `git branch --show-current` — to get the current branch name
- `git log <TARGET_BRANCH>..HEAD --oneline` — to list commits since divergence
- `git diff <TARGET_BRANCH>..HEAD --stat` — for a file change summary
- `git diff <TARGET_BRANCH>..HEAD --name-only` — for the list of changed files

## Phase 3: Classify Changed Files

Analyze the list of changed files and classify them into reviewer buckets. A file can belong to multiple buckets.

**PHP Reviewer** — files matching `*.php`

**Propel Reviewer** — PHP files that are Propel-related. These include:
- Files matching `*Peer.php`, `*Query.php`, `*TableMap.php`
- Files in directories named `map/` or `om/`
- `schema.xml` files
- PHP files containing Propel references (check with grep for `Propel`, `BaseObject`, `BasePeer`, `Criteria`)

**JS/TS Reviewer** — files matching `*.js`, `*.jsx`, `*.ts`, `*.tsx`

**React Reviewer** — JS/TS files that import from `react`, `react-dom`, or contain JSX/TSX component patterns. Check file contents with grep for `from 'react'`, `from "react"`, `React.Component`, `useState`, `useEffect`.

**SQL Reviewer** — files matching `*.sql`, or migration files (files in directories named `migrations/`, `migrate/`, or containing `migration` in the name)

If no files match any reviewer bucket, inform the user that no specialized reviewers are applicable and provide a brief general summary of the changes instead.

## Phase 4: Dispatch Reviewer Subagents

For each applicable reviewer bucket, use the `subagent` tool to spawn a subagent.

Use these subagents:
- **PHP files** → `reviewer-php`
- **Propel files** → `@reviewer-propel`
- **JS/TS files** → `@reviewer-js-ts`
- **React files** → `@reviewer-react`
- **SQL files** → `@reviewer-sql`

## Phase 5: Aggregate Results

Once all subagent reviewers have returned their results, compile the final review in this format:

---

# Branch Review: `<current_branch>` → `<TARGET_BRANCH>`

## Overview
- **Branch**: `<current_branch>`
- **Target**: `<TARGET_BRANCH>`
- **Commits**: <number of commits>
- **Files changed**: <number of files>

## Reviewer Reports

<Insert each reviewer's section here, in order: Critical issues first, then Warnings, then Suggestions>

## Summary

- **Top concerns**: <list the most critical findings across all reviewers>
- **Overall assessment**: <brief overall assessment>
- **Recommendation**: <one of: "Approve", "Approve with minor changes", "Request changes">

Base recommendation on:
- Any critical issue → "Request changes"
- Warnings but no critical → "Approve with minor changes"
- Only suggestions or clean → "Approve"

---
