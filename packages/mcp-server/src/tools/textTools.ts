/**
 * `text.create_overlay` 工具定义与空 handler。
 */

import {
  MCP_TOOL_DEFINITIONS,
  type JsonSchema,
  type TextCreateOverlayArgs,
  type TextCreateOverlayResult,
} from '@clipcut/shared-types';
import { NotImplementedError } from '../bridge/errors.js';
import type { ClipCutBridge } from '../bridge/clipcutBridge.js';

/** 工具定义。 */
export const textToolDefinitions = [MCP_TOOL_DEFINITIONS['text.create_overlay']];

/** 工具入参 schema。 */
export const textToolSchemas: Record<string, JsonSchema> = {
  'text.create_overlay': MCP_TOOL_DEFINITIONS['text.create_overlay'].inputSchema,
};

/**
 * `text.create_overlay` handler（V1.0 空实现）。
 */
export async function handleTextCreateOverlay(
  _bridge: ClipCutBridge,
  _args: TextCreateOverlayArgs,
): Promise<TextCreateOverlayResult> {
  throw new NotImplementedError('text.create_overlay');
}
