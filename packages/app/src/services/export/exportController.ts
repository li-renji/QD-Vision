/**
 * 导出编排（FR-041 / FR-042）。
 *
 * 流程：能力探测 → **离线混音** → 选路径 → 逐帧 / 实时 → 进度事件 → 取消 → 落库 → 触发下载。
 *
 * 离线混音（`renderOfflineMix`）在选路径**之前**执行：导出音频的来源是
 * `OfflineAudioContext` 渲染的混音总线（拓扑与预览完全一致），
 * 音频编码器（`AudioEncoder`）与容器 codec 的选择都在其后。
 *
 * 资源释放保证：取消或异常时 `encoder.close()` + `muxer.finalize()`（丢弃）
 * + `VideoFrame.close()` + ObjectURL revoke，**无内存泄漏**。
 *
 * ⚠️ 绝不静默：工程里有声音却没渲染出来时，`job.warnings` 里一定有明确说明
 * （PRD §9.0.1 准则四「静默即等于关闭警报」）。
 */

import type { ExportFormat, ProjectDoc } from '@clipcut/shared-types';
import { buildExportPlan, type ExportPlan } from '../../domain/export/exportPlan.js';
import { exportJobId as newJobId } from '../../utils/id.js';
import { addExportRecord } from '../storage/exportHistoryRepo.js';
import { BlobKeys } from '../storage/db.js';
import { putBlob } from '../storage/blobRepo.js';
import { getBlobByKey } from '../storage/blobRepo.js';
import { probeCodecMatrix, type CodecMatrix } from './capabilityProbe.js';
import { downloadBlob } from './download.js';
import { exportWithMediaRecorder } from './mediaRecorderExporter.js';
import { exportWithWebCodecs } from './webCodecsExporter.js';
import { renderOfflineMix } from './offlineAudioRenderer.js';
import { getAudioEncoderCtor } from '../../types/webcodecs.js';

/** 导出任务状态。 */
export type ExportJobStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

/** 导出任务。 */
export interface ExportJob {
  jobId: string;
  status: ExportJobStatus;
  progress: number;
  currentTimeMs: number;
  totalTimeMs: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  error: string | null;
  /** 降级 / 警告信息 */
  warnings: string[];
  blobKey: string | null;
  format: ExportFormat;
}

/** 导出请求。 */
export interface ExportRequest {
  doc: ProjectDoc;
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  burnInSubtitle: boolean;
  /** 取帧函数（导出管线用） */
  getFrame: (assetId: string, sourceMs: number) => Promise<ImageBitmap | null>;
  /**
   * 预渲染的混音结果。
   *
   * 传 `null`（或不传）表示「由导出管线**自动渲染离线混音**」——
   * 导出的音频一律来自 `OfflineAudioContext` 渲染的混音总线。
   */
  audioBuffer?: AudioBuffer | null;
  /** 显式跳过离线混音渲染（导出无声视频）。 */
  skipAudio?: boolean;
  /** 混音流（MediaRecorder 兜底路径用） */
  audioStream?: MediaStream | null;
  /** 进度回调 */
  onProgress?: (job: ExportJob) => void;
  /** 产物就绪回调 */
  onComplete?: (job: ExportJob, blob: Blob) => void;
}

/** 导出控制器。 */
export class ExportController {
  private controller: AbortController | null = null;

  private currentJob: ExportJob | null = null;

  /** 取得当前任务。 */
  getJob(): ExportJob | null {
    return this.currentJob;
  }

  /** 取消当前导出。 */
  cancel(): void {
    this.controller?.abort();
  }

  /** 是否正在导出。 */
  isRunning(): boolean {
    return this.currentJob?.status === 'running';
  }

  /**
   * 启动一次导出。
   */
  async start(request: ExportRequest): Promise<ExportJob> {
    if (this.isRunning()) {
      throw new Error('已有导出任务正在进行中。');
    }

    const matrix: CodecMatrix = await probeCodecMatrix();
    const plan: ExportPlan = buildExportPlan(request.doc, {
      width: request.width,
      height: request.height,
      fps: request.fps,
      format: request.format,
      videoBitrate: request.videoBitrate,
      audioBitrate: request.audioBitrate,
      burnInSubtitle: request.burnInSubtitle,
    });

    const job: ExportJob = {
      jobId: newJobId(),
      status: 'running',
      progress: 0,
      currentTimeMs: 0,
      totalTimeMs: plan.durationMs,
      elapsedMs: 0,
      estimatedRemainingMs: 0,
      error: null,
      warnings: [...plan.errors],
      blobKey: null,
      format: request.format,
    };
    this.currentJob = job;

    const controller = new AbortController();
    this.controller = controller;

    const emit = (): void => {
      request.onProgress?.({ ...job });
    };

    try {
      const blob = await this.runExport(request, plan, matrix, job, controller.signal, emit);

      if (controller.signal.aborted) {
        job.status = 'cancelled';
        job.warnings.push('导出已取消。');
        emit();
        return job;
      }

      // 落库
      const blobKey = BlobKeys.export(job.jobId);
      await putBlob(blobKey, blob);
      job.blobKey = blobKey;
      job.status = 'done';
      job.progress = 1;
      emit();

      // 导出历史
      await addExportRecord({
        id: job.jobId,
        at: new Date().toISOString(),
        format: request.format,
        durationMs: plan.durationMs,
        sizeBytes: blob.size,
        blobKey,
        width: request.width,
        height: request.height,
        fps: request.fps,
      });

      // 触发下载
      const fileName = `${sanitizeFileName(request.doc.name)}.${request.format}`;
      downloadBlob(fileName, blob);
      request.onComplete?.({ ...job }, blob);

      return job;
    } catch (error) {
      if (controller.signal.aborted) {
        job.status = 'cancelled';
        job.warnings.push('导出已取消。');
      } else {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      }
      emit();
      return job;
    } finally {
      this.controller = null;
    }
  }

  /**
   * 渲染离线混音，并把告警写进 `job.warnings`。
   *
   * 导出音频的**唯一来源**：`OfflineAudioContext` 渲染的混音总线
   * （拓扑与预览完全一致，见 `services/export/offlineAudioRenderer.ts`）。
   *
   * 返回 `null` 表示「本次导出没有音频」，但**是否属于异常**由
   * `hasAudibleClips` 判定 —— 工程本来就没有音频时，静音是预期结果，不告警。
   */
  private async renderMix(
    request: ExportRequest,
    plan: ExportPlan,
    job: ExportJob,
    signal: AbortSignal,
  ): Promise<{ buffer: AudioBuffer | null; hasAudibleClips: boolean }> {
    if (request.skipAudio) {
      return { buffer: null, hasAudibleClips: false };
    }

    // 调用方自带了混音结果（预渲染场景）→ 直接用，不再渲染一次。
    if (request.audioBuffer) {
      return { buffer: request.audioBuffer, hasAudibleClips: true };
    }

    const mix = await renderOfflineMix(request.doc, {
      sampleRate: plan.audio.sampleRate,
      channelCount: plan.audio.channels,
      signal,
    });

    for (const warning of mix.warnings) {
      job.warnings.push(warning);
    }

    // ⚠️ 准则四（PRD §9.0.1）：「静默即等于关闭警报」。
    // 工程里明明有声音却没渲染出来 → 必须显式告知，不能让人以为导出成功。
    if (mix.hasAudibleClips && !mix.buffer) {
      job.warnings.push('⚠️ 工程含有音频，但离线混音未能生成，本次导出文件没有声音。');
    }

    return { buffer: mix.buffer, hasAudibleClips: mix.hasAudibleClips };
  }

  /** 按能力矩阵选择导出路径并执行。 */
  private async runExport(
    request: ExportRequest,
    plan: ExportPlan,
    matrix: CodecMatrix,
    job: ExportJob,
    signal: AbortSignal,
    emit: () => void,
  ): Promise<Blob> {
    // ---- 离线混音（导出音频的唯一来源）----
    // 必须在选路径**之前**渲染：MediaRecorder 兜底路径同样需要知道
    // 「工程到底有没有声音」，否则就会悄悄导出一个静音文件。
    const mix = await this.renderMix(request, plan, job, signal);

    // 首选 WebCodecs 主路径
    const canUseWebCodecs = matrix.video.h264.supported || matrix.video.vp9.supported;
    if (canUseWebCodecs) {
      const videoCodec =
        request.format === 'mp4'
          ? (matrix.video.h264.supported ? preferredVideoCodec(matrix, 'mp4') : null)
          : preferredVideoCodec(matrix, 'webm');

      if (videoCodec) {
        const audioCodec =
          request.format === 'mp4'
            ? matrix.audio.aac.supported
              ? 'mp4a.40.2'
              : null
            : matrix.audio.opus.supported
              ? 'opus'
              : null;

        // 音频编码器不存在时**必须**把 audioCodec 置空：
        // 否则 mp4-muxer 会建一条**空音轨**（有声无内容），播放器仍显示「有音轨」。
        const hasAudioEncoder = getAudioEncoderCtor() !== undefined;

        if (mix.buffer && !audioCodec) {
          job.warnings.push('当前浏览器不支持目标音频编码，导出结果将不含音频。');
        }
        if (mix.buffer && audioCodec && !hasAudioEncoder) {
          job.warnings.push('当前浏览器不支持 AudioEncoder，导出结果将不含音频。');
        }

        const usableAudioCodec =
          mix.buffer && audioCodec && hasAudioEncoder ? audioCodec : null;

        return exportWithWebCodecs({
          doc: request.doc,
          plan,
          getFrame: request.getFrame,
          audioBuffer: mix.buffer,
          videoCodec,
          audioCodec: usableAudioCodec,
          signal,
          onProgress: (progress) => {
            job.progress = progress.ratio;
            job.currentTimeMs = progress.currentTimeMs;
            job.elapsedMs = progress.elapsedMs;
            job.estimatedRemainingMs = progress.estimatedRemainingMs;
            emit();
          },
        });
      }
    }

    // 兜底：MediaRecorder（WebM）
    if (matrix.recorder.webm) {
      job.warnings.push(
        'WebCodecs 不可用，已切换到 MediaRecorder 兜底模式（性能较低，录制期间请勿切走标签页）。',
      );
      if (mix.hasAudibleClips) {
        // MediaRecorder 兜底路径是**实时录制**，离线混音结果无法直接接进去
        // （它需要实时 AudioContext + MediaStreamDestination，且受自动播放策略限制）。
        // 这里明确告知，而不是让人以为导出的 WebM 有声音。
        job.warnings.push('MediaRecorder 兜底模式暂不支持音频，本次导出文件没有声音。');
      }
      const result = await exportWithMediaRecorder({
        doc: request.doc,
        plan,
        getFrame: (assetId, sourceMs) => {
          void assetId;
          void sourceMs;
          return null;
        },
        audioStream: request.audioStream ?? null,
        signal,
        onProgress: (progress) => {
          job.progress = progress.ratio;
          job.currentTimeMs = progress.currentTimeMs;
          job.elapsedMs = progress.elapsedMs;
          job.estimatedRemainingMs = progress.estimatedRemainingMs;
          emit();
        },
      });
      return result.blob;
    }

    throw new Error('当前浏览器既不支持 WebCodecs，也不支持 MediaRecorder，无法导出。');
  }
}

/** 依据容器选择视频 codec 串。 */
function preferredVideoCodec(matrix: CodecMatrix, format: ExportFormat): string | null {
  if (format === 'mp4') {
    return matrix.video.h264.supported ? matrix.video.h264.codec : null;
  }
  if (matrix.video.vp9.supported) return matrix.video.vp9.codec;
  if (matrix.video.av1.supported) return matrix.video.av1.codec;
  return null;
}

/** 文件名净化。 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'clipcut-export';
}

/** 全局导出控制器。 */
export const exportController = new ExportController();

/** 读取导出产物。 */
export async function readExportArtifact(blobKey: string): Promise<Blob | null> {
  return getBlobByKey(blobKey);
}
