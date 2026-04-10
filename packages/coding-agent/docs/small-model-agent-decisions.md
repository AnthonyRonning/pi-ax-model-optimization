# Small-Model Coding Agent Decisions

Status: discussion snapshot for the planned pi fork.

This document records the current architecture and product decisions from the design discussion. It is intentionally focused on the coding-agent layer, not Sage's personal-memory use case.

## Working names

- **Project / fork name:** `PromptForge`
- **Internal act syntax name:** `Text Act Format`

These names are intentionally separated:

- `PromptForge` is the umbrella identity for the pi fork
- `Text Act Format` is the descriptive name for the text-native act emission/parsing layer

Technical truth:

- this is still a **pi fork**
- the implementation uses **DSPy-style prompt middleware**
- optimization is expected to use **GEPA/Ax**

`Text Act Format` is called a **format** on purpose. It is not meant to imply a grand external standard, only the concrete text shape that the model emits and the adapter parses.

## Problem framing

- This fork exists to make small models more reliable as coding agents.
- The main target is not "better code quality" in the abstract. The target is reducing the gap between model intent and what the runtime actually realizes.
- Personality is prompt style. Memory is tool/runtime behavior. The important work happens at the coding-agent layer.

## Core goal

Build a pi-based coding agent that lets each model express its intended agentic behavior reliably:

- inspect files when it wants to inspect files
- edit files when it wants to edit files
- ask the user when it needs input
- run validations when it intends to validate
- keep looping until the task is complete, blocked, or waiting on the user

## Main pain points to solve

The biggest reliability failures seen with small models are:

1. intended tool use never appears as valid tool JSON
2. provider/native stop behavior ends the turn even though the task is unfinished
3. tool outputs are misunderstood because the prompt/protocol/tool surface is confusing

The first problem is treated as the biggest source of avoidable friction.

## High-level architecture direction

### Fork pi instead of rewriting from scratch

- This repository becomes the working home for the fork.
- Keep pi as the base runtime instead of doing a full rewrite.
- Preserve pi's session model, tool runtime, and coding-agent workflow expectations.

### Accept a custom protocol layer

- A custom `streamSimple`-style layer is acceptable if needed.
- Its purpose is to replace provider-native tool parsing/serialization with a text-first protocol while keeping pi's loop, tools, sessions, and UI model intact.

## Prompt layering

The stack should be split into four layers:

1. **Canonical pi intent**
   - the base agent behavior
   - tool expectations
   - project/user customizations
   - workflow rules that must actually be followed
2. **DSPy/DSRS middleware**
   - the protocol renderer/translator
   - turns canonical intent into a model-facing prompt/protocol
3. **Model-specific GEPA adapter**
   - compact wording
   - examples
   - continuation cues
   - result-handling cues
   - formatting hints
4. **Dynamic runtime context**
   - transcript
   - tool results
   - repo state
   - AGENTS/context files
   - user replies

Decision: GEPA should optimize the translation/adaptation layers, not replace canonical pi intent.

## Canonical intent is the source of truth

- The main pi prompt is the canonical intent.
- User and project customizations to that intent are first-class.
- If canonical intent says "do X before Y" or "ask before build", that is in scope for evaluation and should be respected by the GEPA judge.
- The middleware exists to make the intent work well for a specific model, not to invent a different product behavior.

## Text-based tool protocol over native JSON tool calling

- V1 should move away from provider-native JSON tool calling as the core protocol.
- Tools should be presented in a DSPy/DSRS-style text-first format.
- The runtime should parse explicit acts from model output instead of trusting native tool calling behavior.
- This is primarily to remove provider/tool-parser friction, especially for small models.

## Runtime recovery boundary

- If the model makes an explicit tool-use attempt but the act is malformed or partially malformed, the correction/parser layer should try to recover it.
- If the model emits no explicit tool-use attempt at all, the runtime should **not** invent one.
- Missing tool intent is treated as a model/protocol failure, not as a runtime invitation to guess.
- In that case, pi should just treat the output as ordinary assistant output / stop behavior unless some explicit parsed act says otherwise.
- Pi's natural continuation mechanism should stay intact: normal continuation comes from emitted tool calls and queued user messages, not from synthetic extra internal turns invented by the fork.

## Stop semantics

- Provider `stop_reason` is transport metadata, not semantic truth.
- Semantic completion should come from explicit agent acts, not from the transport stopping.
- The runtime should treat unfinished work plus missing terminal intent as interruption/failure, not successful completion.

Acts still need to be formalized, but the working set is:

- `message`
- `tool_call`
- `ask_user`
- `done`
- `blocked`

## What the judge should evaluate

The GEPA judge should score:

- whether the agent realized its apparent intent
- whether it kept going while work remained
- whether it used tool outputs correctly
- whether it followed the active canonical pi intent
- whether it emitted stable, parseable protocol acts
- whether it stopped only when complete, blocked, or waiting for the user

## What the judge should not evaluate

The GEPA judge should not primarily score:

- code aesthetics
- whether the model chose the "best" tool ordering
- whether the model used the same reasoning path a human would prefer
- whether the model produced frontier-model-quality code

Code quality is largely out of scope. Intent following under runtime constraints is in scope.

## Tool-flow judgment rule

- The judge should not criticize tool choice or tool ordering by default.
- It should only enforce specific tool-flow expectations when those expectations are explicitly part of canonical pi intent.
- The goal is not to RL models into one preferred choreography. The goal is to make their intended choreography actually work.

## Prompting strategy

Start with the smallest viable contract:

- you are a coding agent
- here are your tools
- here is the task
- keep going until complete, blocked, or user input is needed
- use tool outputs as ground truth

Decision: start minimal and only add more prompting when evaluation data shows it is necessary.

Heavy behavioral prompting is a last resort, not the default strategy.

## Optimization granularity

- V1 optimization target is the **model**, not the inference provider.
- Provider-specific tuning is a possible later extension, but not a foundational V1 requirement.
- If someone deliberately targets a specific backend, they can rerun GEPA against that stack.
- If provider-specific overrides are easy later, they can be added as optional refinement.

## Transcript and context strategy

- Do **not** adopt Sage's regenerated "system + user prompt as reconstructed state" approach for coding-agent sessions.
- Coding-agent sessions should remain append-only.
- Compaction is expected and acceptable.
- The model-facing context may be assembled each step from the append-only log plus compaction artifacts.
- The session itself should not be rewritten into a synthetic regenerated state.

Decision: pi keeps the session substrate; DSPy/DSRS/GEPA operate as per-step middleware.

## ReAct / multi-turn stance

- ReAct-style `act -> observe -> act -> observe` behavior is a useful mental model.
- It should not replace pi's session and loop architecture.
- Pi should own the transcript, resumability, interruptions, and compaction behavior.
- DSPy middleware should shape each step, not become the primary session substrate.
- There should be no special runtime-only "self continue" turn when the model failed to emit an act. That is a GEPA/eval issue, not a loop invention issue.

## Working success definition

Success is not "the model wrote perfect code."

Success is:

- the model intended to inspect, edit, ask, validate, or continue
- the runtime successfully realized those intentions
- the loop persisted until an explicit completion, block, or user handoff state

## Feedback capture for later GEPA runs

- The runtime should make it easy to report bad traces for future optimization.
- Reported traces should go into a **feedback queue / review log**, not directly into the final GEPA trainset.
- This queue should capture things like:
  - model id
  - active canonical pi intent / prompt customization
  - active tool surface
  - relevant transcript slice
  - raw assistant output
  - optional human feedback note
  - failure tag
- Example failure tags:
  - `missing_tool_attempt`
  - `premature_stop`
  - `misread_tool_output`
  - `failed_to_ask_user`
- Queued feedback is later curated into proper GEPA datasets.

## Known failure taxonomy to drive GEPA

The optimization and evaluation work should track failures such as:

- intended tool use not emitted
- emitted but unparsable
- parsed but wrong arguments
- tool output misunderstood
- premature stop
- unnecessary stop after partial progress
- failure to ask the user when blocked
- failure to resume correctly after user input

Important distinction:

- malformed explicit intent should be handled by parser/correction
- missing explicit intent should be surfaced to GEPA/evals, not repaired by runtime guessing

## Open items

These are not yet decided and should be defined next:

- exact text protocol format for acts
- replay/tool-result rendering format
- exact terminal semantics for `done` and `blocked`
- how canonical pi intent is compiled into model-facing adapters
