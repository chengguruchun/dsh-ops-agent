# `@dsh-ops-agent/code-review`

Sibling **code-review** domain (not nested inside ops AgentLoop).

```text
fetch → analyze (heuristics) → optional static (CR_REVIEW_COMMAND) → summarize → optional publish
```

## Honest boundary

| This package | DSH host |
|--------------|----------|
| `gh` / `glab` fetch, file list, diff capture | Deep semantic / LLM review of the change |
| Heuristics: secrets, huge diff, missing tests, TODO density | Judgment, style, architecture critique |
| Optional `CR_REVIEW_COMMAND` | Providing `llmSummary` / `reviewNotes` into the loop |
| `gh pr comment` / `glab mr note` publish | Deciding whether/when to publish |

Deep LLM review stays on the DSH host. This library is **fetch / heuristics / publish**.

## Config (`CR_*` + forge tokens)

| Env | Meaning |
|-----|---------|
| `CR_PROVIDER` | `github` (default) \| `gitlab` |
| `CR_REPO` | `owner/repo` or `group/project` |
| `GH_TOKEN` / `CR_GH_TOKEN` | GitHub CLI auth (never logged) |
| `GITLAB_TOKEN` / `CR_GITLAB_TOKEN` | GitLab / glab auth |
| `CR_GITLAB_URL` / `GITLAB_URL` | GitLab host |
| `CR_REVIEW_COMMAND` | Optional lint/test shell |
| `CR_STATIC_CHECKS` | Default whether loop runs static (default true if command set) |
| `CR_PUBLISH` | Default whether loop posts a comment (default false) |
| `CR_HUGE_DIFF_LINES` | Huge-diff warning threshold (default 800) |
| `CR_TODO_DENSITY` | TODO density warning threshold (default 5) |
| `CR_CHECKPOINT_DIR` | Checkpoint directory (default `.cr-checkpoints/`) |

## Tools (`CR_TOOL_CATALOG`)

- `cr_fetch_pr`
- `cr_list_files`
- `cr_heuristic_review`
- `cr_run_checks`
- `cr_post_comment`
- `cr_review_loop_start` (optional `resumeFrom` / `runId`)

Registered by `@dsh-ops-agent/pi2dsh-plugin` alongside `ops_*`.

## Develop

```sh
npm test -w @dsh-ops-agent/code-review
npm run typecheck -w @dsh-ops-agent/code-review
```

Live forge calls need `gh`/`glab` auth on the host; unit tests inject `exec` and stay offline.
