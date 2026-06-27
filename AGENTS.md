# AGENTS.md

## Collaboration Model

This repository is worked by a small agent team.

- Claude Code is the primary implementation actor when available.
- Codex acts primarily as documentation, requirements validation, review, evidence, and handoff agent.
- When Claude Code is rate-limited, unavailable, or explicitly paused, Codex may act as the implementation agent.
- Both agents work on the same branch and treat each other as collaborators on the same task, not as competing owners.
- The active shared branch is `feat/oefa-full-extraction` unless the user explicitly changes it.

## Shared Git Discipline

- Always inspect `git status` before editing.
- Verify the current branch before committing or pushing.
- Treat unrecognized changes as user or teammate work.
- Never reset, checkout, revert, or delete teammate changes unless the user explicitly asks.
- Keep commits focused and reviewable.
- Prefer small commits with clear messages.
- Before pushing, summarize what changed and verify the branch.

## Command Permissions

Within this repository, agents may run safe diagnostic, build, test, validation, and git-inspection commands without asking first.

Safe commands include:

- `git status`, `git diff`, `git log`, branch inspection, and remote inspection.
- File reads and searches such as `rg`, `Get-Content`, directory listings, and line counts.
- TypeScript builds and project tests.
- Dry-runs, validation scripts, local output inspection, and non-destructive scraper probes.
- Small local scripts that only inspect or summarize repository files and outputs.

Agents must still ask before:

- Destructive filesystem operations.
- Discarding git changes.
- Deleting large output directories or generated datasets.
- Killing unrelated processes.
- Changing system configuration.
- Installing dependencies or using network access when the environment requires approval.
- Running long scraping jobs that may overwrite important outputs, unless the user has clearly requested that run.

## Role Split

Claude Code default role:

- Implement scraper changes.
- Run long scraping routines.
- Optimize performance.
- Fix runtime bugs.
- Produce code diffs and operational outputs.

Codex default role:

- Maintain README, sprint notes, diagrams, and review docs.
- Validate requirements against code and artifacts.
- Inspect generated outputs such as JSONL, PDFs, checkpoints, and run reports.
- Produce checklists for human, DB, and LLM review.
- Review diffs for risks, missing tests, broken assumptions, and unclear documentation.
- Act as implementer when Claude is limited, unavailable, or the user asks Codex directly.

## Repo Context

Project: `pj-peru-scraper`.

Current goal: robust and fast HTTP scraper for OEFA/PJ Peru, with OEFA as the validated target.

Important current facts:

- OEFA HTTP scraper is modular and works without browser automation.
- `npm run scrape:oefa:test100` is the controlled validation run.
- Confidential OEFA records are expected unavailable PDFs, not scraper failures.
- Review artifacts include:
  - `run-summary.json`
  - `page-events.jsonl`
  - `run-report.md`
  - `failed-pdfs.json`
- Main performance work is around OEFA sector extraction, especially MINERIA.

## Required Start Of Work

Before editing or validating, inspect:

- `git status`
- current branch
- recent commits when relevant
- `package.json`
- files directly related to the task

For scraper/runtime tasks, also inspect:

- `src/scraper/scraper.ts`
- `src/scraper/sectorScraper.ts`
- `src/pdf/downloader.ts`
- `src/display/terminal.ts`
- relevant `output/` artifacts if present

## Validation Expectations

For code changes:

- Run `npm run build` at minimum when TypeScript changes.
- Prefer small dry-runs before long scraping runs.
- Do not treat confidential PDFs as failed downloads.
- Preserve structured artifacts for DB and LLM review.

For documentation changes:

- Keep docs human-readable and operational.
- Include exact commands and artifact paths.
- Separate observed local state from guaranteed behavior.
- Prefer Mermaid diagrams for flows that reviewers need to inspect.

## Handoff Protocol

When handing work to the other agent or to the user, include:

- Current branch.
- Commit hash if committed.
- Files changed.
- Commands run.
- Evidence from outputs.
- Known risks or next decisions.

