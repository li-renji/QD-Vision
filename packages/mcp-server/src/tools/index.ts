/**
 * 工具注册表：把 15 个工具挂到 MCP Server。
 */

import {
  MCP_TOOL_DEFINITIONS,
  MCP_TOOL_NAMES,
  type McpToolName,
} from '@clipcut/shared-types';
import { NotImplementedError, toChannelError } from '../bridge/errors.js';
import type { ClipCutBridge } from '../bridge/clipcutBridge.js';
import { handleProjectGetInfo, handleProjectListAssets, projectToolDefinitions } from './projectTools.js';
import {
  handleTextCreateOverlay,
  textToolDefinitions,
} from './textTools.js';
import { handleSubtitleImportSrt, subtitleToolDefinitions } from './subtitleTools.js';
import {
  handleExportGetStatus,
  handleExportStart,
  exportToolDefinitions,
} from './exportTools.js';
import { timelineToolDefinitions, timelineToolHandlers } from './timelineTools.js';

/** 全部 15 个工具定义。 */
export const allToolDefinitions = [
  ...projectToolDefinitions,
  ...timelineToolDefinitions,
  ...textToolDefinitions,
  ...subtitleToolDefinitions,
  ...exportToolDefinitions,
];

/**
 * 工具 handler。
 *
 * V1.0 全部返回结构化 `NOT_IMPLEMENTED` 错误，**不崩进程**。
 */
export const toolHandlers: Record<
  string,
  (bridge: ClipCutBridge, args: never) => Promise<unknown>
> = {
  'project.get_info': (bridge, args) => handleProjectGetInfo(bridge, args),
  'project.list_assets': (bridge, args) => handleProjectListAssets(bridge, args),
  'text.create_overlay': (bridge, args) => handleTextCreateOverlay(bridge, args),
  'subtitle.import_srt': (bridge, args) => handleSubtitleImportSrt(bridge, args),
  'export.start': (bridge, args) => handleExportStart(bridge, args),
  'export.get_status': (bridge, args) => handleExportGetStatus(bridge, args),
  ...timelineToolHandlers,
};

/**
 * 执行一个工具调用。
 *
 * @throws ChannelError 统一映射为结构化错误
 */
export async function invokeTool(
  bridge: ClipCutBridge,
  tool: McpToolName | string,
  args: unknown,
): Promise<unknown> {
  const handler = toolHandlers[tool];
  if (!handler) {
    throw new NotImplementedError(tool);
  }
  try {
    return await handler(bridge, args as never);
  } catch (error) {
    throw toChannelError(error);
  }
}

/** 工具名列表（便于校验 15 个工具齐全）。 */
export { MCP_TOOL_NAMES, MCP_TOOL_DEFINITIONS };
