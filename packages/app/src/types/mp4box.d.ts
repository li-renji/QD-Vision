/**
 * `mp4box` 的最小类型声明。
 *
 * `mp4box`（0.5.x）没有随包提供 `.d.ts`，本文件补齐 V1.0 实际用到的部分 API，
 * 避免在业务代码里使用 `any`。
 */
declare module 'mp4box' {
  /** MP4 sample 信息。 */
  export interface MP4Info {
    timescale: number;
    duration: number;
    isFragmented: boolean;
    brands: string[];
    tracks: MP4Track[];
    videoTracks: MP4Track[];
    audioTracks: MP4Track[];
  }

  /** MP4 track 信息。 */
  export interface MP4Track {
    id: number;
    type: string;
    timescale: number;
    duration: number;
    nb_samples: number;
    codec: string;
    video?: { width: number; height: number };
    audio?: { sample_rate: number; channel_count: number };
    samples: MP4Sample[];
  }

  /** MP4 sample。 */
  export interface MP4Sample {
    number: number;
    track_id: number;
    timescale: number;
    is_sync: boolean;
    cts: number;
    dts: number;
    duration: number;
    size: number;
    data: ArrayBuffer | Uint8Array;
  }

  /** 解封装得到的文件片段。 */
  export interface MP4File {
    start: number;
    end: number;
  }

  /** `mp4box` 的 `createFile()` 返回值。 */
  export interface MP4BoxFile {
    onReady: (info: MP4Info) => void;
    onError: (error: string) => void;
    onSamples: (trackId: number, user: unknown, samples: MP4Sample[]) => void;
    appendBuffer: (data: ArrayBuffer & { fileStart?: number }) => number;
    setExtractionOptions: (trackId: number, user?: unknown, options?: { nbSamples?: number }) => void;
    start: () => void;
    stop: () => void;
    flush: () => void;
    releaseUsedSamples: (trackId: number, sampleNumber: number) => void;
    seek: (time: number, useRap: boolean) => { offset: number; time: number };
  }

  /** 创建 mp4box 文件解析器。 */
  export function createFile(): MP4BoxFile;

  /** MP4 box 解析器（可选）。 */
  export const DataStream: unknown;
}
