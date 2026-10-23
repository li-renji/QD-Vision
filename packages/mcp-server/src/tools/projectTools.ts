/**
 * `project.*` 工具定义与空 handler。
 */

import {
  MCP_TOOL_DEFINITIONS,
  type JsonSchema,
  type ProjectGetInfoArgs,
  type ProjectInfoResult,
  type ProjectListAssetsArgs,
  type ProjectListAssetsResult,
} from '@clipcut/shared-types';
import { NotImplementedError } from '../bridge/errors.js';
import type { ClipCutBridge } from '../bridge/clipcutBridge.js';

/** 工具定义（可直接注册到 MCP Server）。 */
export const projectToolDefinitions = [
  MCP_TOOL_DEFINITIONS['project.get_info'],
  MCP_TOOL_DEFINITIONS['project.list_assets'],
];

/** 工具入参 schema。 */
export const projectToolSchemas: Record<string, JsonSchema> = {
  'project.get_info': MCP_TOOL_DEFINITIONS['project.get_info'].inputSchema,
  'project.list_assets': MCP_TOOL_DEFINITIONS['project.list_assets'].inputSchema,
};

/**
 * `project.get_info` handler（V1.0 空实现）。
 */
export async function handleProjectGetInfo(
  _bridge: ClipCutBridge,
  _args: ProjectGetInfoArgs,
): Promise<ProjectInfoResult> {
  throw new NotImplementedError('project.get_info');
}

/**
 * `project.list_assets` handler（V1.0 空实现）。
 */
export async function handleProjectListAssets(
  _bridge: ClipCutBridge,
  _args: ProjectListAssetsArgs,
): Promise<ProjectListAssetsResult> {
  throw new NotImplementedError('project.list_assets');
}
