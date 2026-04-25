<!-- OSS_WEEKEND_START -->
# 🏖️ OSS Weekend

**Issue tracker reopens Monday, April 13, 2026.**

OSS weekend runs Thursday, April 2, 2026 through Monday, April 13, 2026. New issues and PRs from unapproved contributors are auto-closed during this time. Approved contributors can still open issues and PRs if something is genuinely urgent, but please keep that to pressing matters only. For support, join [Discord](https://discord.com/invite/3cU7Bz4UPx).

> _Current focus: at the moment i'm deep in refactoring internals, and need to focus._
<!-- OSS_WEEKEND_END -->

---

# PromptForge / Text Act Format Experiment

This branch is an experiment on top of the pi monorepo. The goal is to test whether a pi-based coding agent can make tool-fragile or format-sensitive models behave more like dependable coding agents by replacing provider-native tool calling with a text-native act format and optimizing the adapter prompt with GEPA.

The base project is still pi. The experiment keeps pi's loop, sessions, tools, compaction, TUI, and provider abstractions. The main change is the model-facing protocol layer.

## Research question

Can we improve coding-agent reliability by optimizing the interface between the model and the runtime instead of replacing the runtime?

The specific failures we are targeting are:

- the model clearly intends to use a tool but fails to emit valid provider-native tool JSON
- the provider returns a stop condition even though the task is not semantically complete
- the model emits malformed tool syntax that the runtime treats as inert text
- the model answers from stale assumptions instead of reading files or grounding on tool results
- the model fails to ask the user when required context is missing
- the model attempts unavailable tools instead of reporting that it is blocked

The working hypothesis is:

- pi already has the right runtime substrate
- provider-native tool calling is a weak point for some models
- a compact text-native format is easier for those models to learn
- malformed explicit intent should be recoverable by the parser
- missing explicit intent should be fixed by prompt optimization, not by runtime guessing

## What changed from `origin/main`

This branch adds the PromptForge experiment across runtime, optimizer, artifacts, and local routing:

- `packages/coding-agent/src/core/text-act-format/`
  - runtime adapter, renderer, parser, artifact loader, feedback queue, and types
- `packages/coding-agent/src/core/sdk.ts`
  - wraps the existing `streamFn` seam to optionally enable Text Act Format
- `packages/coding-agent-optimizer/`
  - Ax/GEPA optimization package for Text Act Format artifacts
- `.pi/promptforge/text-act-format/`
  - checked-in model-scoped optimized artifacts
- `.pi/agent/models.json`
  - project-local model routing for OpenRouter-through-LiteLLM experiments
- `packages/ai/src/providers/openai-completions.ts`
  - OpenAI-compatible proxy support needed for LiteLLM routing
- `flake.nix` / `flake.lock`
  - reproducible local dev shell for the experiment

For the detailed design paper trail, see:

- [`packages/coding-agent/docs/small-model-agent-decisions.md`](packages/coding-agent/docs/small-model-agent-decisions.md)
- [`packages/coding-agent/docs/small-model-agent-implementation-plan.md`](packages/coding-agent/docs/small-model-agent-implementation-plan.md)

## Text Act Format

Text Act Format is the text-native interface the model emits. The runtime parses this text and lowers it back into normal pi assistant text and tool-call events.

Supported acts:

```text
<message>visible text for the user</message>

<tool_call name="read">{"path":"README.md"}</tool_call>

<ask_user>Which file should I inspect?</ask_user>

<blocked>I cannot run tests because no bash tool is available.</blocked>

<done />
```

Rules:

- tool use must be explicit through `<tool_call>`
- tool arguments must be JSON objects
- `ask_user` means the agent needs user input
- `blocked` means the available tools cannot satisfy the task
- `done` is semantic termination and does not create visible output
- provider stop reasons are treated as transport metadata, not semantic truth

The adapter suppresses native provider tools and sends the model a text-only view of:

- canonical pi system intent
- available tools rendered as text
- prior assistant messages
- prior tool calls
- prior tool results
- optional model-specific PromptForge artifact hints

The parsed output is then lowered into standard pi stream events, so the existing agent loop still owns tool execution, continuation, session persistence, and compaction.

## Runtime architecture

The important design choice is that we did not replace pi's loop.

Pi already has the behavior this experiment wants:

1. stream one assistant response
2. execute emitted tool calls
3. append tool results
4. continue while tool calls exist
5. stop when the assistant stops producing tool calls

PromptForge only changes the model-facing protocol:

```text
pi context + tools
        |
        v
Text Act Format renderer
        |
        v
provider text completion with native tools disabled
        |
        v
Text Act Format parser
        |
        v
normal pi assistant text + toolCall blocks
        |
        v
existing pi loop
```

The adapter is activated when a model-specific artifact exists, or explicitly with:

```bash
PI_CODING_AGENT_TEXT_ACT_FORMAT=1
```

It can be forced off with:

```bash
PI_CODING_AGENT_TEXT_ACT_FORMAT=0
```

Artifacts are loaded from project-local and agent-local paths such as:

```text
.pi/promptforge/text-act-format/<provider>/<model>.json
.pi/promptforge/text-act-format/<provider>/default.json
.pi/promptforge/text-act-format/default.json
```

## Parser recovery boundary

The parser intentionally recovers malformed explicit intent, but does not invent missing intent.

Recovered examples include:

```text
<tool_call name="read">
path: "README.md"
```

```text
<tool_call>
read path="README.md"
<tool_call>
read path="AGENTS.md"
```

```text
<tool_call name="read">{"path":"README.md"}
```

These are explicit tool-use attempts, so the runtime can safely recover them.

This is not recovered:

```text
I will read README.md next.
```

That is a missing tool attempt. The runtime should not guess a tool call from prose. Those failures belong in the optimizer dataset.

## Optimizer package

The GEPA work lives outside the runtime package:

```text
packages/coding-agent-optimizer/
```

Important modules:

- `src/program.ts`
  - Ax-compatible optimization program over `text-act-format.instructions`
- `src/optimize.ts`
  - GEPA compile wrapper
- `src/metrics.ts`
  - heuristic score vector
- `src/judge.ts`
  - Claude-backed judge blended with heuristics
- `src/live-dataset.ts`
  - curated live seed and validation examples
- `src/live-runner.ts`
  - executes a student model against Text Act Format prompts
- `src/live-optimize.ts`
  - live optimization entry point
- `src/artifact.ts`
  - writes runtime artifacts with optimizer metadata and Pareto fronts
- `src/feedback.ts`
  - imports feedback queue records for later curation

The score vector is:

- `actParsing`
- `toolSelection`
- `completion`
- `toolGrounding`
- `failureAvoidance`

The optimizer does not try to make the model write beautiful code. It optimizes the adapter prompt for reliable agent-runtime behavior.

## Live GEPA flow

The current live flow uses:

- student model: OpenRouter-compatible models, optionally routed through LiteLLM
- teacher/judge: Claude Sonnet 4.6 through Anthropic
- optimizer: Ax GEPA
- output: model-scoped PromptForge artifacts

Typical command:

```bash
cd packages/coding-agent-optimizer
npm run optimize:live
```

Useful environment variables:

```bash
ANTHROPIC_API_KEY=...
OPENROUTER_API_KEY=...
LITELLM_API_KEY=...
OPENROUTER_API_URL=...
LITELLM_API_URL=...
LITELLM_API_HOST=...
PROMPTFORGE_STUDENT_MODEL=qwen/qwen3.5-9b
PROMPTFORGE_STUDENT_MODELS="moonshotai/kimi-k2.5,qwen/qwen3.5-9b"
PROMPTFORGE_ARTIFACT_PATH=/absolute/path/to/artifact.json
PROMPTFORGE_MAX_METRIC_CALLS=24
PROMPTFORGE_NUM_TRIALS=4
PROMPTFORGE_MINIBATCH_SIZE=3
PROMPTFORGE_EARLY_STOPPING_TRIALS=2
```

When routing through LiteLLM, the optimizer can use OpenAI-compatible proxy mode and prefix request model IDs such as:

```text
openrouter/qwen/qwen3.5-9b
```

while keeping the model-scoped artifact path keyed by:

```text
openrouter/qwen/qwen3.5-9b.json
```

## Current artifacts

Checked-in artifacts:

| Model | Path | Best score |
| --- | --- | ---: |
| `moonshotai/kimi-k2.5` | `.pi/promptforge/text-act-format/openrouter/moonshotai/kimi-k2.5.json` | `0.6091666666666666` |
| `google/gemma-4-31b-it` | `.pi/promptforge/text-act-format/openrouter/google/gemma-4-31b-it.json` | `0.8666666666666666` |
| `qwen/qwen3.5-9b` | `.pi/promptforge/text-act-format/openrouter/qwen/qwen3.5-9b.json` | `0.8080277777777777` |

The latest Qwen artifact was produced after adding real failure traces where the model emitted malformed tool calls like:

```text
<tool_call>
read path="README.md"
```

GEPA selected stronger instructions emphasizing:

- exact `<tool_call name="TOOL_NAME">{...}</tool_call>` syntax
- JSON object bodies only
- no `key=value` tool arguments
- no nameless `<tool_call>` tags
- no unclosed tool calls
- checking `availableTools` before calling tools
- preferring `read` for known file inspection
- emitting fully closed blocks for multiple tool calls

This materially improved live behavior for the observed traces. One later trace still emitted a stray leading `<tool_call>`, but it then emitted a valid nested read call, which the parser recovered and executed.

## Feedback loop

The runtime includes a low-level feedback queue helper:

```text
.pi/promptforge/feedback/text-act-format.jsonl
```

Feedback records are intended to capture bad live traces before they become curated training/eval rows. A record can include:

- provider/model
- canonical intent
- active tools
- transcript slice
- raw assistant output
- parsed acts
- failure tag
- optional human note
- artifact path

Current failure tags include:

- `missing_tool_attempt`
- `premature_stop`
- `misread_tool_output`
- `failed_to_ask_user`
- `unparseable_act`
- `other`

The user-facing capture flow is still future work.

## LiteLLM / Langfuse routing

This branch also experiments with routing OpenRouter models through a LiteLLM-compatible proxy for tracing.

The sustainable approach is:

- keep normal pi model IDs where possible
- discover project-local `.pi/agent/models.json`
- let provider config transform the outbound request model ID
- avoid requiring ad hoc runtime flags like `PI_CODING_AGENT_DIR`
- avoid duplicating random user-facing model aliases

Relevant files:

- `.pi/agent/models.json`
- `packages/coding-agent/src/config.ts`
- `packages/coding-agent/src/core/model-registry.ts`
- `packages/ai/src/providers/openai-completions.ts`

## Validation commands used during the experiment

Root validation:

```bash
npm run check
```

Targeted runtime tests:

```bash
cd packages/coding-agent
../../node_modules/.bin/tsx ../../node_modules/vitest/dist/cli.js --run test/text-act-format.test.ts
```

Targeted optimizer tests:

```bash
cd packages/coding-agent-optimizer
../../node_modules/.bin/tsx ../../node_modules/vitest/dist/cli.js --run test/live-text-act-format.test.ts
../../node_modules/.bin/tsx ../../node_modules/vitest/dist/cli.js --run test/text-act-format-optimizer.test.ts
```

## Research learnings so far

### 1. The runtime seam is enough

The `streamFn` seam in `packages/coding-agent/src/core/sdk.ts` was sufficient. We did not need to rewrite `packages/agent`.

### 2. Text-native acts are easier to debug than provider-native tool JSON

The raw model output is inspectable and can be copied directly into regression tests or optimizer examples.

### 3. Parser recovery and GEPA solve different problems

Parser recovery handles malformed explicit intent.

GEPA handles missing or unreliable intent by changing the model-facing instructions.

Both are needed.

### 4. Real traces are much more valuable than synthetic examples

The largest improvements came from adding observed failures to the dataset, especially malformed tag cases and project-context read cases.

### 5. The best optimized prompt is not necessarily the longest prompt

GEPA selected concise, concrete constraints around exact syntax and tool availability rather than broad behavioral prose.

### 6. Transport stop reasons should not define agent semantics

The runtime now treats parsed acts as semantic truth. A provider stop is just the end of that response, not proof that the task is complete.

### 7. Model-level artifacts are a practical first granularity

Provider-specific tuning may become useful, but model-scoped artifacts were enough to prove the loop.

## Known limitations and open questions

- The live dataset is still small.
- Artifacts do not yet store full baseline-vs-optimized comparison reports.
- Feedback capture is implemented as helpers, not a user-facing command.
- Long-session and compaction-aware rendering need more testing.
- Provider-specific overrides may be needed for some deployment stacks.
- Current scoring focuses on intent realization, not final code quality.
- The optimizer package duplicates some Text Act Format parsing/types from runtime to preserve package boundaries.
- More model sweeps are needed before drawing broad conclusions.

## Original pi monorepo

This is still the pi monorepo.

> Looking for the pi coding agent? See [`packages/coding-agent`](packages/coding-agent) for installation and usage.

Tools for building AI agents and managing LLM deployments.

| Package | Description |
| --- | --- |
| [`@mariozechner/pi-ai`](packages/ai) | Unified multi-provider LLM API |
| [`@mariozechner/pi-agent-core`](packages/agent) | Agent runtime with tool calling and state management |
| [`@mariozechner/pi-coding-agent`](packages/coding-agent) | Interactive coding agent CLI |
| [`@mariozechner/pi-mom`](packages/mom) | Slack bot that delegates messages to the pi coding agent |
| [`@mariozechner/pi-tui`](packages/tui) | Terminal UI library with differential rendering |
| [`@mariozechner/pi-web-ui`](packages/web-ui) | Web components for AI chat interfaces |
| [`@mariozechner/pi-pods`](packages/pods) | CLI for managing vLLM deployments on GPU pods |

## Development

```bash
npm install
npm run check
./test.sh
./pi-test.sh
```

The repo also includes a Nix shell for this experiment:

```bash
nix develop
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution guidelines and [`AGENTS.md`](AGENTS.md) for project-specific rules.

## License

MIT
