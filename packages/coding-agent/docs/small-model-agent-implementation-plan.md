# Small-Model Agent Implementation Plan

Status: implementation snapshot after the initial PromptForge runtime + optimizer landing  
Related: `packages/coding-agent/docs/small-model-agent-decisions.md`

This document turns the architecture decisions into a concrete implementation plan after investigating the relevant pi and Ax subsystems.

## Working names

- **Project / fork name:** `PromptForge`
- **Internal act syntax name:** `Text Act Format`

Naming intent:

- `PromptForge` is the umbrella identity for the project
- `Text Act Format` is the descriptive implementation term for the text-native act layer

This keeps the docs honest: the project is still fundamentally a **pi fork** with **DSPy-style prompt middleware** and **GEPA/Ax optimization**, but day-to-day implementation does not need to repeatedly say the full stack description everywhere.

## Scope

Build a small-model-friendly coding-agent mode that:

- keeps pi as the runtime harness
- replaces provider-native tool calling with a text-first model protocol
- preserves append-only sessions and compaction
- uses model-specific GEPA artifacts to improve intent realization

This plan is for a pi fork, not a greenfield agent.

## Current status

The initial planned architecture is now implemented in this branch:

- the runtime adapter is wired into `packages/coding-agent/src/core/sdk.ts`
- Text Act Format modules exist under `packages/coding-agent/src/core/text-act-format/`
- model-scoped artifacts auto-enable the adapter when present
- the optimizer package exists at `packages/coding-agent-optimizer/`
- live GEPA runs can emit per-model artifacts, including multi-model sequential runs

What remains is mostly refinement work: better eval coverage, better reporting, better feedback capture UX, and long-session prompt/render tuning.

## What was investigated

### Pi runtime and prompt seams

| Area | Files | What matters |
| --- | --- | --- |
| Canonical intent prompt | `packages/coding-agent/src/core/system-prompt.ts`, `packages/coding-agent/src/core/agent-session.ts` | pi builds a base system prompt once, then can override it per turn before the agent starts |
| Agent construction | `packages/coding-agent/src/core/sdk.ts` | pi already injects a custom `streamFn`, `transformContext`, and `onPayload` into the underlying agent |
| Dynamic provider seam | `packages/coding-agent/src/core/model-registry.ts`, `packages/coding-agent/src/core/extensions/types.ts`, `packages/coding-agent/docs/custom-provider.md` | pi already supports `streamSimple` registration and custom providers |
| Core loop | `packages/agent/src/agent.ts`, `packages/agent/src/agent-loop.ts` | the loop only needs standard assistant/tool-call events and `toolCall` blocks to keep going |
| AI provider contract | `packages/ai/src/types.ts`, `packages/ai/src/stream.ts`, `packages/ai/src/api-registry.ts` | `AssistantMessageEventStream` is the stable seam; `toolcall_end` is the critical event for loop continuity |
| Sessions and compaction | `packages/coding-agent/src/core/session-manager.ts`, `packages/coding-agent/src/core/messages.ts`, `packages/coding-agent/src/core/compaction/compaction.ts`, `packages/coding-agent/docs/session.md`, `packages/coding-agent/docs/compaction.md` | sessions are append-only JSONL trees; model-facing context is rebuilt from that log plus explicit compaction artifacts |

### Ax / GEPA capabilities

| Area | Files | What matters |
| --- | --- | --- |
| Ax optimizer availability | `/Users/tony/Dev/ThirdParties/ax/README.md`, `/Users/tony/Dev/ThirdParties/ax/src/ax/dsp/optimizers/gepa.ts` | Ax already has `AxGEPA` |
| Agent-specific optimization | `/Users/tony/Dev/ThirdParties/ax/src/ax/prompts/agent/AxAgent.ts`, `/Users/tony/Dev/ThirdParties/ax/src/ax/prompts/agent/optimize.ts` | Ax agents expose `optimize(...)`, `applyOptimization(...)`, and judgeable eval artifacts |
| Example coverage | `/Users/tony/Dev/ThirdParties/ax/src/examples/gepa.ts`, `/Users/tony/Dev/ThirdParties/ax/src/examples/rlm-agent-recursive-optimize.ts`, `/Users/tony/Dev/ThirdParties/ax/src/examples/README.md` | Ax already demonstrates generic GEPA and recursive/agent GEPA flows |

Conclusion: Ax already has the GEPA pieces we need. We do not need to invent the optimizer layer.

## Key findings from the codebase

### 1. We do not need to replace pi's loop

`packages/agent/src/agent-loop.ts` already gives us the behavior we want:

- it streams one assistant response
- it keeps going while `toolCall` blocks exist
- it appends tool results back into context
- it only needs standard assistant stream events

This means the fork does **not** need a new runtime loop. It needs a translation layer that produces pi-standard events.

### 2. The strongest seam is the existing stream function

`packages/coding-agent/src/core/sdk.ts` creates the agent with:

- `streamFn`
- `transformContext`
- `onPayload`

That is the natural place to insert a Text Act Format adapter without rewriting the rest of pi.

### 3. `before_provider_request` is too late for the core protocol swap

Pi's `before_provider_request` extension hook is useful for payload mutation and debugging, but it runs **after** provider serialization.

That means it is not the primary seam for this project because we need to own:

- outbound tool rendering
- outbound protocol formatting
- response parsing back into pi events

So the core implementation should happen at the `streamFn` / `streamSimple` layer, not at payload-mutation time.

### 4. pi already provides intent, tools, and transcript at the stream seam

At the stream seam we already get:

- `context.systemPrompt`
- `context.tools`
- `context.messages`

That means the adapter can work from first-class runtime data and does **not** need to scrape tool definitions back out of the system prompt text.

### 5. pi already supports custom `streamSimple`

`packages/coding-agent/src/core/model-registry.ts` and `packages/coding-agent/docs/custom-provider.md` show that pi is already designed for provider-level `streamSimple` customization.

This gives us two implementation options:

1. wrap the global `streamFn` in `sdk.ts`
2. register an internal custom provider / `streamSimple`

Both are viable.

### 6. Append-only sessions already match the desired model

`packages/coding-agent/src/core/session-manager.ts` and `packages/coding-agent/src/core/compaction/compaction.ts` confirm:

- sessions are append-only
- compaction is explicit
- model-facing context is reconstructed from entries
- the session itself is not regenerated into a new synthetic state

This matches the desired coding-agent behavior and should be preserved.

### 7. `ask_user` and `done` do not need to be real pi tools in v1

Because the adapter is responsible for lowering model output back into pi semantics:

- `ask_user` can lower to normal assistant text with no tool calls
- `done` can lower to no more tool calls, with optional final text

This keeps v1 simpler and lets pi's existing session behavior do the rest.

### 8. pi has no native internal self-continue turn, and that is fine

Pi naturally continues because of:

- emitted `toolCall` blocks that create tool-result turns
- queued steering messages
- queued follow-up messages

It does not have a native "take another internal turn for no reason" mechanism, and v1 should not add one just to paper over missing model intent.

### 9. Runtime recovery should stop at malformed explicit intent

There is an important boundary for v1:

- if the model explicitly attempts a tool/action act but the syntax is malformed, the parser/correction layer should try to recover it
- if the model emits no explicit tool/action attempt at all, the runtime should not synthesize one

That means:

- malformed explicit intent is a parser/correction problem
- missing explicit intent is a prompting/eval/GEPA problem

This keeps runtime behavior honest and avoids inventing agent actions that were never actually emitted.

## Working environment and local references

### Nix dev shell

The repo now includes `flake.nix` and `flake.lock` for a reproducible dev shell.

Fresh sessions should prefer:

```bash
nix develop
```

Inside the shell, the intended bootstrap/validation flow is:

```bash
npm install
npm run build
```

The shell also wires up:

- `nodejs_22`
- `bun`
- `python3`
- `ripgrep`
- `tmux`
- compiler/system libs needed by the repo
- local `node_modules/.bin` on `PATH`

### Local Ax checkout

There is also a local Ax checkout available at:

`/Users/tony/Dev/ThirdParties/ax`

Use it as the reference implementation for:

- `AxGEPA`
- `AxAgent.optimize(...)`
- `applyOptimization(...)`
- recursive/agent optimization examples

For this project, Ax is a reference dependency/workspace neighbor, not the main repo being edited unless explicitly needed.

## Recommended v1 architecture

## Layering

1. **Canonical pi intent**
   - existing pi system prompt + project/user customization
   - still the semantic source of truth

2. **Text Act Format adapter**
   - renders model-facing prompt instructions
   - renders tools in text form
   - defines explicit acts like `message`, `tool_call`, `ask_user`, `done`, `blocked`

3. **Stream translation layer**
   - calls the underlying provider without native tool calling
   - parses streamed text into pi `AssistantMessageEvent`s
   - emits `toolcall_end` when model intent becomes a tool call

4. **Existing pi runtime**
   - tool execution
   - session persistence
   - compaction
   - steering/follow-up behavior
   - UI / RPC / JSONL modes

## Recommended technical approach

### Implemented choice: global adapter wrapper, not provider duplication

V1 uses the following path:

- keep the user's selected model as-is
- wrap the call path in `packages/coding-agent/src/core/sdk.ts`
- let the adapter call the underlying provider with text-only context
- parse the response back into standard pi events

Why this was the right first move:

- no model duplication
- no extra provider names
- the optimization key stays the real selected model
- we can still externalize later through `registerProvider()` if we want

### Deferred alternative: internal custom provider registration

This is still a viable option, but better as a second step if we want the protocol layer to become independently pluggable.

Tradeoffs:

- good: aligns with existing pi extension/provider architecture
- bad: awkward if every real model needs an adapter-wrapper model entry

## Runtime behavior for v1

### What stays native to pi

- loop continuation based on emitted `toolCall` blocks
- tool execution and result injection
- session persistence
- compaction
- queued steering / follow-up messages
- normal interactive / print / json / rpc modes

### What the adapter owns

- text-based tool rendering
- model-facing act grammar
- parsing response text back into:
  - assistant text blocks
  - tool call blocks
  - explicit completion intent
  - correction/recovery for malformed explicit acts

### What the adapter should not trust

- provider-native tool calling
- provider-native `stop_reason` as semantic completion

### What the adapter should not invent

- missing tool intent
- missing continuation intent
- missing user-question intent

If the model does not emit an explicit act, v1 should not guess one on its behalf.

## Likely code touch points

## Runtime fork changes

### Primary

- `packages/coding-agent/src/core/sdk.ts`
  - wraps the existing `streamFn`
  - loads model-scoped artifacts
  - auto-enables Text Act Format when an artifact exists
  - supports explicit env override via `PI_CODING_AGENT_TEXT_ACT_FORMAT`

- `packages/coding-agent/src/core/system-prompt.ts`
  - still acts as the canonical intent source
  - no special restructuring was required for the first working version

### Implemented runtime modules

Implemented area:

- `packages/coding-agent/src/core/text-act-format/`

Current files:

- `adapter.ts` — main wrapper around underlying stream call
- `render.ts` — render canonical intent + tools + replay/tool results into model-facing protocol
- `parser.ts` — parse explicit acts and recover malformed explicit tool calls
- `artifacts.ts` — load model-specific GEPA artifacts
- `feedback.ts` — append JSONL feedback records for later GEPA curation
- `types.ts` — act definitions, adapter config, parse results

Lowering ended up living inside `adapter.ts` instead of a separate `lowering.ts`.

### Existing code that should stay mostly unchanged

- `packages/agent/src/agent-loop.ts`
- `packages/ai/src/types.ts`
- `packages/coding-agent/src/core/session-manager.ts`
- `packages/coding-agent/src/core/compaction/compaction.ts`

The goal is to avoid destabilizing pi's core runtime.

## Offline optimization/eval plan

### Implemented: separate workspace package

Do **not** cram Ax/GEPA code directly into the runtime package first.

Implemented package:

- `packages/coding-agent-optimizer/`

Purpose:

- Ax dependency boundary
- eval dataset definitions
- judge logic
- GEPA runs
- artifact generation

This keeps runtime and offline experimentation separate.

### Why this package split helps

- avoids mixing heavy optimizer dependencies into core runtime code
- makes it easy to run GEPA offline
- keeps generated artifacts explicit
- makes it easier to rerun experiments per model later

### Feedback capture queue

In addition to curated train/validation datasets, add a lightweight feedback-capture path for bad live traces.

Implemented helper path:

- helpers can append a bad run into `.pi/promptforge/feedback/text-act-format.jsonl`
- records are JSONL review data, not direct trainset rows
- a first-class command/UI flow for capturing these traces is still missing

Suggested payload:

- model id
- active canonical pi intent/custom prompt state
- active tools
- transcript slice
- raw assistant output
- parsed acts if any
- optional human note
- failure tag

Suggested first tags:

- `missing_tool_attempt`
- `premature_stop`
- `misread_tool_output`
- `failed_to_ask_user`

This gives us a clean loop from live failures to later GEPA curation.

## Dataset and judge plan

### What to optimize for

The judge should score:

- whether intended actions were realized
- whether the loop persisted until completion / block / user handoff
- whether tool outputs were used correctly
- whether active pi intent/customization was followed
- whether emitted acts were parseable and stable

### What not to optimize for

- code beauty
- preferred tool order
- frontier-model-level code quality

### Likely eval record shape

Each eval example should carry:

- task input
- active pi intent/custom instructions
- initial repo/session setup
- expected completion style
- optional expected actions / forbidden actions
- optional blocking / clarification expectation

Each prediction record should carry:

- completion type
- emitted acts
- executed tool calls
- tool errors
- tool results used
- stop/continue behavior
- turn count
- final user-visible output

Ax already has patterns close to this in `AxAgent.optimize()` and related judge types.

## Proposed phases

## Phase 0 — protocol paper design

Status: completed

Deliverables:

- act vocabulary
- parse/lowering rules
- terminal semantics
- two or three candidate text formats

Output:

- one protocol spec doc
- one parser test plan

## Phase 1 — runtime proof of concept

Status: completed

Goal:

- prove that pi can stay the harness while the adapter controls prompt/render/parse

Work:

- add adapter wrapper behind a feature flag or internal config
- render tools as text
- suppress native tool calling on the outbound request
- parse at least:
  - assistant text
  - one tool call
  - `done`

Delivered:

- the agent can inspect files, call real pi tools, and continue through pi's normal loop
- Text Act Format is injected through the `streamFn` seam without replacing the loop

## Phase 2 — act coverage and loop correctness

Status: completed for the initial act set

Work:

- support multiple tool calls
- support `ask_user`
- support `blocked`
- make completion independent from transport `stop_reason`
- add replay formatting for prior tool calls and tool results
- add malformed-act correction handling

Delivered:

- support for multiple tool calls
- support for `ask_user`
- support for `blocked`
- completion based on parsed semantic acts rather than transport stop reason
- replay formatting for prior tool calls and tool results
- malformed explicit act recovery without guessing missing intent

## Phase 3 — evaluation harness with Ax

Status: completed for the first live harness

Work:

- create `packages/coding-agent-optimizer/`
- define eval datasets around intent realization
- add a first Ax judge
- run fixed non-GEPA baseline evaluations against a small target model
- add a feedback-capture review queue and import path for later curation

Delivered:

- `packages/coding-agent-optimizer/`
- heuristic + judge-backed scoring
- seed datasets covering tool use, ask-user, blocked, and tool-grounding cases
- feedback JSONL import helpers

## Phase 4 — GEPA artifact generation

Status: completed for the first live flow

Work:

- add GEPA optimization flow in Ax
- emit per-model artifacts
- load artifacts into runtime adapter

Delivered:

- per-model artifact generation
- runtime artifact loading
- multi-model sequential live runs via `PROMPTFORGE_STUDENT_MODELS`
- validated artifacts for Kimi and Gemma

## Phase 5 — refinement

Status: current focus

Work:

- more models
- better compaction-aware rendering
- optional provider-specific overrides later if needed
- optional externalization through pi's provider registration API

## Remaining design options to defer

## 1. Provider-specific overrides

Current state:

- v1 targets the model, not a specific backend route
- artifacts are stored at the provider/model path that the runtime selects

Open question:

- whether some models need additional provider-specific tuning beyond model-level artifacts

## 2. Feedback capture UX

Current state:

- low-level feedback queue helpers exist

Open question:

- whether capture should land as a built-in command, extension flow, or both

## 3. Compaction-aware rendering

Current state:

- the current rendering path works for normal sessions and replayed tool results

Open question:

- how much prompt/render specialization long compacted sessions need

## Immediate next implementation tasks

The next concrete tasks are:

1. persist explicit baseline-vs-optimized scores in live run outputs and artifacts
2. expand the live dataset beyond the current small seed set
3. add a user-facing way to capture bad live traces into the feedback queue
4. improve long-session and compaction-aware rendering
5. run broader model sweeps and compare per-model artifact quality

## Summary

The investigation supports the original thesis:

- pi already has the right runtime substrate
- the main missing piece is a text-first Text Act Format adapter
- Ax already has the GEPA and agent optimization machinery we need

So the plan is not to build a new agent runtime.  
The plan is to keep pi's runtime and replace the model-facing protocol layer with something small-model-friendly and GEPA-optimizable.
