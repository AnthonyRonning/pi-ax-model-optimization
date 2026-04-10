import type { TextActFormatAct, TextActFormatParseResult } from "./types.js";

function decodeScalar(value: string): unknown {
	const trimmed = value.trim().replace(/,$/, "");
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return trimmed.replace(/^["']|["']$/g, "");
}

function stripCodeFences(text: string): string {
	return text
		.replace(/^```[a-zA-Z0-9_-]*\s*/, "")
		.replace(/\s*```$/, "")
		.trim();
}

function extractBalancedJsonObject(text: string): string | undefined {
	const source = stripCodeFences(text);
	const start = source.indexOf("{");
	if (start === -1) return undefined;

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = start; index < source.length; index++) {
		const char = source[index];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === "{") depth++;
		if (char === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(start, index + 1);
			}
		}
	}

	return undefined;
}

function parseLineObject(text: string): Record<string, unknown> | undefined {
	const result: Record<string, unknown> = {};
	let found = false;

	for (const line of stripCodeFences(text).split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const separatorIndex = trimmed.indexOf(":");
		if (separatorIndex === -1) continue;

		const key = trimmed
			.slice(0, separatorIndex)
			.trim()
			.replace(/^["']|["']$/g, "");
		const value = trimmed.slice(separatorIndex + 1);
		if (!key) continue;

		result[key] = decodeScalar(value);
		found = true;
	}

	return found ? result : undefined;
}

function parseToolArguments(
	rawArguments: string,
): { arguments: Record<string, unknown>; recovered: boolean } | undefined {
	const cleaned = stripCodeFences(rawArguments);
	if (!cleaned) {
		return { arguments: {}, recovered: false };
	}

	try {
		const parsed = JSON.parse(cleaned);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return { arguments: parsed as Record<string, unknown>, recovered: false };
		}
	} catch {
		// ignore malformed direct JSON and try recovery paths
	}

	const balancedJson = extractBalancedJsonObject(cleaned);
	if (balancedJson) {
		try {
			const parsed = JSON.parse(balancedJson);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return { arguments: parsed as Record<string, unknown>, recovered: true };
			}
		} catch {
			// ignore malformed recovered JSON and try line-object recovery
		}
	}

	const lineObject = parseLineObject(cleaned);
	if (lineObject) {
		return { arguments: lineObject, recovered: true };
	}

	return undefined;
}

function createMessageAct(type: Extract<TextActFormatAct["type"], "message" | "ask_user" | "blocked">, text: string) {
	return { type, text: text.trim() } as TextActFormatAct;
}

const TOOL_CALL_PATTERN = /<tool_call\b[^>]*name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/tool_call>/gi;
const ACT_PATTERN =
	/<tool_call\b[^>]*name=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/tool_call>|<(message|ask_user|blocked)>([\s\S]*?)<\/\3>|<done(?:\s*\/>|>\s*<\/done>)/gi;

function parseRecoveredTrailingToolCall(source: string): TextActFormatAct | undefined {
	const startMatch = /<tool_call\b[^>]*name=["']?([^"'>\s]+)["']?[^>]*>/i.exec(source);
	if (!startMatch || startMatch.index === undefined) {
		return undefined;
	}

	const bodyStart = startMatch.index + startMatch[0].length;
	const body = source.slice(bodyStart);
	const parsedArguments = parseToolArguments(body);
	if (!parsedArguments) {
		return undefined;
	}

	return {
		type: "tool_call",
		name: startMatch[1],
		arguments: parsedArguments.arguments,
		rawArguments: body.trim(),
		recovered: true,
	};
}

export function parseTextActFormat(rawText: string): TextActFormatParseResult {
	const source = rawText.trim();
	if (!source) {
		return { acts: [], hadExplicitToolAttempt: false, usedPlainTextFallback: false };
	}

	const acts: TextActFormatAct[] = [];
	let hadExplicitToolAttempt = TOOL_CALL_PATTERN.test(source);
	TOOL_CALL_PATTERN.lastIndex = 0;
	let lastIndex = 0;
	let matchedAnyAct = false;

	for (const match of source.matchAll(ACT_PATTERN)) {
		matchedAnyAct = true;
		const matchIndex = match.index ?? 0;
		const leadingText = source.slice(lastIndex, matchIndex).trim();
		if (leadingText) {
			acts.push(createMessageAct("message", leadingText));
		}

		if (match[1]) {
			const parsedArguments = parseToolArguments(match[2] ?? "");
			if (parsedArguments) {
				acts.push({
					type: "tool_call",
					name: match[1],
					arguments: parsedArguments.arguments,
					rawArguments: (match[2] ?? "").trim(),
					recovered: parsedArguments.recovered,
				});
			}
		} else if (match[3]) {
			acts.push(createMessageAct(match[3] as "message" | "ask_user" | "blocked", match[4] ?? ""));
		} else {
			acts.push({ type: "done" });
		}

		lastIndex = matchIndex + match[0].length;
	}

	const trailingText = source.slice(lastIndex).trim();
	if (trailingText) {
		if (trailingText.includes("<tool_call")) {
			hadExplicitToolAttempt = true;
			const recoveredToolCall = parseRecoveredTrailingToolCall(trailingText);
			if (recoveredToolCall) {
				const textBeforeTool = trailingText.slice(0, trailingText.indexOf("<tool_call")).trim();
				if (textBeforeTool) {
					acts.push(createMessageAct("message", textBeforeTool));
				}
				acts.push(recoveredToolCall);
			} else {
				acts.push(createMessageAct("message", trailingText));
			}
		} else {
			acts.push(createMessageAct("message", trailingText));
		}
	}

	if (!matchedAnyAct && acts.length === 0) {
		return {
			acts: [createMessageAct("message", source)],
			hadExplicitToolAttempt,
			usedPlainTextFallback: true,
		};
	}

	const usedPlainTextFallback = acts.length === 1 && acts[0].type === "message" && acts[0].text === source;
	return {
		acts,
		hadExplicitToolAttempt,
		usedPlainTextFallback,
	};
}
