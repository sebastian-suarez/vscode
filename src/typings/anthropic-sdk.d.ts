/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ambient type declarations for `@anthropic-ai/sdk`.
 *
 * The package is no longer installed (the Copilot removal dropped it from
 * `package.json` together with the GitHub Copilot SDKs), but the agent host
 * still speaks the Anthropic Messages wire protocol: `copilotApiService.ts`
 * talks to CAPI in that format and `claudeProxyService.ts` re-serves it to the
 * Claude Agent SDK. Those modules only ever imported the package for *types*
 * (`import type Anthropic from '@anthropic-ai/sdk'`), so this file declares the
 * subset of the wire protocol they use.
 *
 * Same pattern (and same location) as `copilot-api.d.ts`. Delete this file if
 * `@anthropic-ai/sdk` is ever restored as a real dependency — the ambient
 * declaration shadows the package's own typings.
 */
declare module '@anthropic-ai/sdk' {

	class Anthropic { }

	namespace Anthropic {

		// #region Errors

		export type ErrorType =
			| 'invalid_request_error'
			| 'authentication_error'
			| 'billing_error'
			| 'permission_error'
			| 'not_found_error'
			| 'request_too_large'
			| 'rate_limit_error'
			| 'timeout_error'
			| 'api_error'
			| 'overloaded_error';

		export interface ErrorObject {
			type: ErrorType;
			message: string;
		}

		export interface ErrorResponse {
			type: 'error';
			error: ErrorObject;
			request_id?: string | null;
		}

		// #endregion

		// #region Content blocks (responses)

		export interface TextBlock {
			type: 'text';
			text: string;
			citations?: unknown[] | null;
		}

		export interface ThinkingBlock {
			type: 'thinking';
			thinking: string;
			signature?: string;
		}

		export interface RedactedThinkingBlock {
			type: 'redacted_thinking';
			data: string;
		}

		export interface ToolUseBlock {
			type: 'tool_use';
			id: string;
			name: string;
			input: unknown;
		}

		export interface ServerToolUseBlock {
			type: 'server_tool_use';
			id: string;
			name: string;
			input: unknown;
		}

		export type ContentBlock =
			| TextBlock
			| ThinkingBlock
			| RedactedThinkingBlock
			| ToolUseBlock
			| ServerToolUseBlock;

		// #endregion

		// #region Content blocks (requests)

		export interface TextBlockParam {
			type: 'text';
			text: string;
			cache_control?: unknown;
			citations?: unknown[] | null;
		}

		export interface ImageBlockParam {
			type: 'image';
			source: unknown;
			cache_control?: unknown;
		}

		export interface DocumentBlockParam {
			type: 'document';
			source: unknown;
			cache_control?: unknown;
			title?: string | null;
			context?: string | null;
		}

		export interface ThinkingBlockParam {
			type: 'thinking';
			thinking: string;
			signature?: string;
		}

		export interface ToolUseBlockParam {
			type: 'tool_use';
			id: string;
			name: string;
			input: unknown;
			cache_control?: unknown;
		}

		export interface ToolResultBlockParam {
			type: 'tool_result';
			tool_use_id: string;
			content?: string | Array<TextBlockParam | ImageBlockParam>;
			is_error?: boolean;
			cache_control?: unknown;
		}

		export type ContentBlockParam =
			| TextBlockParam
			| ImageBlockParam
			| DocumentBlockParam
			| ThinkingBlockParam
			| ToolUseBlockParam
			| ToolResultBlockParam;

		// #endregion

		// #region Messages

		export interface MessageParam {
			role: 'user' | 'assistant';
			content: string | ContentBlockParam[];
		}

		export interface Usage {
			input_tokens: number;
			output_tokens: number;
			cache_creation?: unknown;
			cache_creation_input_tokens?: number | null;
			cache_read_input_tokens?: number | null;
			inference_geo?: unknown;
			server_tool_use?: unknown;
			service_tier?: string | null;
			[key: string]: unknown;
		}

		export type StopReason =
			| 'end_turn'
			| 'max_tokens'
			| 'stop_sequence'
			| 'tool_use'
			| 'pause_turn'
			| 'refusal'
			| 'model_context_window_exceeded';

		export interface Message {
			id: string;
			type: 'message';
			role: 'assistant';
			model: string;
			content: ContentBlock[];
			stop_reason: StopReason | null;
			stop_sequence: string | null;
			usage: Usage;
			stop_details?: unknown;
			container?: unknown;
			context_management?: unknown;
		}

		export interface MessageCreateParamsBase {
			model: string;
			max_tokens: number;
			messages: MessageParam[];
			system?: string | TextBlockParam[];
			metadata?: unknown;
			service_tier?: string;
			stop_sequences?: string[];
			temperature?: number;
			thinking?: unknown;
			tool_choice?: unknown;
			tools?: unknown[];
			top_k?: number;
			top_p?: number;
		}

		export interface MessageCreateParamsNonStreaming extends MessageCreateParamsBase {
			stream?: false;
		}

		export interface MessageCreateParamsStreaming extends MessageCreateParamsBase {
			stream: true;
		}

		export type MessageCreateParams = MessageCreateParamsNonStreaming | MessageCreateParamsStreaming;

		export interface MessageCountTokensParams {
			model: string;
			messages: MessageParam[];
			system?: string | TextBlockParam[];
			thinking?: unknown;
			tool_choice?: unknown;
			tools?: unknown[];
		}

		export interface MessageTokensCount {
			input_tokens: number;
		}

		// #endregion

		// #region Streaming events

		export interface TextDelta {
			type: 'text_delta';
			text: string;
		}

		export interface ThinkingDelta {
			type: 'thinking_delta';
			thinking: string;
		}

		export interface SignatureDelta {
			type: 'signature_delta';
			signature: string;
		}

		export interface InputJSONDelta {
			type: 'input_json_delta';
			partial_json: string;
		}

		export type RawContentBlockDelta = TextDelta | ThinkingDelta | SignatureDelta | InputJSONDelta;

		export interface MessageDeltaUsage {
			output_tokens: number;
			input_tokens?: number | null;
			cache_creation_input_tokens?: number | null;
			cache_read_input_tokens?: number | null;
			server_tool_use?: unknown;
			service_tier?: string | null;
		}

		export interface RawMessageStartEvent {
			type: 'message_start';
			message: Message;
		}

		export interface RawMessageDeltaEvent {
			type: 'message_delta';
			delta: {
				stop_reason: StopReason | null;
				stop_sequence: string | null;
				stop_details?: unknown;
				container?: unknown;
			};
			usage: MessageDeltaUsage;
		}

		export interface RawMessageStopEvent {
			type: 'message_stop';
		}

		export interface RawContentBlockStartEvent {
			type: 'content_block_start';
			index: number;
			content_block: ContentBlock;
		}

		export interface RawContentBlockDeltaEvent {
			type: 'content_block_delta';
			index: number;
			delta: RawContentBlockDelta;
		}

		export interface RawContentBlockStopEvent {
			type: 'content_block_stop';
			index: number;
		}

		export type MessageStreamEvent =
			| RawMessageStartEvent
			| RawMessageDeltaEvent
			| RawMessageStopEvent
			| RawContentBlockStartEvent
			| RawContentBlockDeltaEvent
			| RawContentBlockStopEvent;

		// #endregion

		// #region Models

		export interface ModelInfo {
			id: string;
			type: 'model';
			display_name: string;
			created_at: string;
			capabilities?: unknown;
			max_input_tokens?: number | null;
			max_tokens?: number | null;
		}

		// #endregion

		/**
		 * Beta (`/v1/messages?beta=true`) event-stream shapes. Only the members
		 * the Claude Agent SDK surfaces through `includePartialMessages` are
		 * declared, and message/usage envelopes carry an index signature so
		 * fixtures can populate the SDK's wider field set verbatim.
		 */
		export namespace Beta {

			export interface BetaTextBlock {
				type: 'text';
				text: string;
				citations?: unknown[] | null;
				[key: string]: unknown;
			}

			export interface BetaThinkingBlock {
				type: 'thinking';
				thinking: string;
				signature?: string;
				[key: string]: unknown;
			}

			export interface BetaToolUseBlock {
				type: 'tool_use';
				id: string;
				name: string;
				input: unknown;
				[key: string]: unknown;
			}

			export type BetaContentBlock = BetaTextBlock | BetaThinkingBlock | BetaToolUseBlock;

			export interface BetaUsage {
				input_tokens: number;
				output_tokens: number;
				[key: string]: unknown;
			}

			export interface BetaMessage {
				id: string;
				type: 'message';
				role: 'assistant';
				model: string;
				content: BetaContentBlock[];
				stop_reason: StopReason | null;
				stop_sequence: string | null;
				usage: BetaUsage;
				[key: string]: unknown;
			}

			export interface BetaTextDelta {
				type: 'text_delta';
				text: string;
			}

			export interface BetaThinkingDelta {
				type: 'thinking_delta';
				thinking: string;
			}

			export interface BetaSignatureDelta {
				type: 'signature_delta';
				signature: string;
			}

			export interface BetaInputJSONDelta {
				type: 'input_json_delta';
				partial_json: string;
			}

			export type BetaRawContentBlockDelta =
				| BetaTextDelta
				| BetaThinkingDelta
				| BetaSignatureDelta
				| BetaInputJSONDelta;

			export interface BetaRawMessageStartEvent {
				type: 'message_start';
				message: BetaMessage;
			}

			export interface BetaRawMessageStopEvent {
				type: 'message_stop';
			}

			export interface BetaRawContentBlockStartEvent {
				type: 'content_block_start';
				index: number;
				content_block: BetaContentBlock;
			}

			export interface BetaRawContentBlockDeltaEvent {
				type: 'content_block_delta';
				index: number;
				delta: BetaRawContentBlockDelta;
			}

			export interface BetaRawContentBlockStopEvent {
				type: 'content_block_stop';
				index: number;
			}
		}
	}

	export default Anthropic;
}
