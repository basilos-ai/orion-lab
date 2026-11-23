# Unified Agent workspace

The only user-facing mode is **Agent**. A new conversation starts with Auto and
does not require a project. The adopted Harness PromptInput, images, streaming,
model choices, decision-engine preference and local/cloud scope stay together.
There is no replacement Ask toggle.

## Admission and model capabilities

The shared `planTurn` contract separates direct answers from project tools.
Without a project, ordinary questions use the controlled answer endpoint. With a
project, Auto/9B/DeepSeek enter Pi, which may answer without calling tools.
Direct-only models remain selectable inside projects and never receive project
files automatically. Explicit file requests/attached files show a switch action
instead of silently changing the model. No-project file requests retain the draft
and offer project selection. These deterministic hints are not an accuracy claim
or authorization boundary; an unrecognized request may need clearer wording or a
tool-capable model. The server independently limits tools and permissions.

| Request | Answer/tool path |
| --- | --- |
| Ordinary Auto | Existing lightweight 4B / complex 9B and authorized cloud rules |
| Project tools Auto | Existing 9B / DeepSeek decision, model locked for the run |
| Image Auto | Local 9B, no Pi tools or cloud |
| Manual image | Local 9B or CPU MiniCPM-V 4.7 1B |
| Manual 2B / 4B / CPU MiniCPM | Direct answer; switch for project operations |
| Manual 27B | Direct answer only; never Auto or project tools |

Decision engines stay Laya / Houmo 2B / Houmo 4B. Semantic routing rules and
thresholds are unchanged. Local scope is checked at admission and dispatch.

## Permissions and images

Project tasks default to read access. Explicit mutation/check requests can enable
proposal tools, whose writes/checks still need individual expiring approvals bound
to parameters and old-file SHA. Switching models never sends or approves a task.
No free shell, arbitrary host path or Docker socket is added.

Images work in project conversations through the answer path. Image plus project
operations in a single Pi run remain unsupported: complete the image discussion,
then start a text project task. Reviews stay local. AI Gateway input Block, decision
Monitor, failure-stop behavior and the policy bridge stay active. Streaming output
is not semantically reviewed. Native Pi Hooks are not added.

## History and compatibility

New snapshots use `mode: agent`, with separate `execution: answer|tools` and
`access`. Historical `ask` snapshots and attested older clients are accepted.
Restoring an old failed turn restores draft/model/scope/context, never a mode
selector or automatic tool replay. Existing storage keys and server data stay.
Attested direct project answers must match the owned conversation binding;
browsers cannot attest completed turns. `#chat` and legacy `#agent` open the same
workspace. Ports remain 17790 (workspace), 17780 (dashboard) and existing AI Gateway.

## Start, release and rollback

Development commands remain `npm ci`, `npm run dev`, and `npm run dev:agent`.

```sh
systemctl --user status o6n-smart-chat orion-agent model-benchmark-dashboard --no-pager
systemctl --user start o6n-smart-chat orion-agent model-benchmark-dashboard
journalctl --user -u o6n-smart-chat -u orion-agent -n 60 --no-pager
curl --fail http://127.0.0.1:17790/api/health
```

Back up private state and confirm no active task before publishing matched React
assets, bundled Agent server and `agent_extension.py`. Restart only chat and Pi;
retain models, ports and data. Roll back all three artifacts with previous release
links and the bridge backup. Keep conversations/runs created since deployment.

Functional acceptance is a separate table on `#controlled`; it never increases
benchmark sample counts or rewrites historical measurements.


## Composer label (2026-10-22)

The redundant Agent icon/text is removed from the composer. Agent remains the default; context, image, model, scope, history and approval behavior are unchanged.
