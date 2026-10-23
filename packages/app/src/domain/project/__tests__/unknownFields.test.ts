/**
 * 未知字段保留测试（forward-compatible，FR-001 / PRD §4.1）。
 */

import { describe, expect, it } from 'vitest';
import { deserialize } from '../deserialize.js';
import { serialize, serializeToObject } from '../serialize.js';
import { readFixtureJson } from '../../../test/fixtures.js';

describe('domain/project/unknownFields', () => {
  it('根级未知字段原样写回', () => {
    const json = readFixtureJson('minimal.clipcut.json') as Record<string, unknown>;
    json['customFoo'] = 123;

    const { doc } = deserialize(json);
    expect(doc['customFoo']).toBe(123);

    const output = serializeToObject(doc);
    expect(output['customFoo']).toBe(123);
  });

  it('嵌套层级中的未知字段同样保留', () => {
    const json = readFixtureJson('full.clipcut.json') as Record<string, unknown>;
    const tracks = json['tracks'] as Array<Record<string, unknown>>;
    const firstTrack = tracks[0];
    expect(firstTrack).toBeDefined();
    if (firstTrack) {
      firstTrack['customTrackField'] = { nested: true };
    }

    const { doc } = deserialize(json);
    const outputTracks = serializeToObject(doc)['tracks'] as Array<Record<string, unknown>>;
    expect(outputTracks[0]?.['customTrackField']).toEqual({ nested: true });
  });

  it('clip 内的未知字段保留', () => {
    const json = readFixtureJson('minimal.clipcut.json') as Record<string, unknown>;
    const tracks = json['tracks'] as Array<Record<string, unknown>>;
    const clips = tracks[0]?.['clips'] as Array<Record<string, unknown>>;
    const clip = clips[0];
    expect(clip).toBeDefined();
    if (clip) {
      clip['customClipField'] = 'keep-me';
    }

    const { doc } = deserialize(json);
    const output = serializeToObject(doc) as Record<string, unknown>;
    const outputTracks = output['tracks'] as Array<Record<string, unknown>>;
    const outputClips = outputTracks[0]?.['clips'] as Array<Record<string, unknown>>;
    expect(outputClips[0]?.['customClipField']).toBe('keep-me');
  });

  it('未知字段参与往返一致性', () => {
    const json = readFixtureJson('minimal.clipcut.json') as Record<string, unknown>;
    json['customFoo'] = 123;

    const first = serialize(deserialize(json).doc);
    const second = serialize(deserialize(JSON.parse(first) as unknown).doc);
    expect(second).toBe(first);
    expect(JSON.parse(first) as Record<string, unknown>).toHaveProperty('customFoo', 123);
  });
});

describe('domain/project/deserialize · 保留用户自定义值', () => {
  it('clip 的 transform 与 audio 参数不被默认值覆盖', () => {
    const { doc } = deserialize(readFixtureJson('full.clipcut.json'));
    const pip = doc.tracks.flatMap((track) => track.clips).find((clip) => clip.id === 'clip_full_c2');
    expect(pip?.transform.x).toBe(0.75);
    expect(pip?.transform.y).toBe(0.25);
    expect(pip?.transform.scale).toBe(0.4);
    expect(pip?.transform.opacity).toBe(0.9);
    expect(pip?.transform.cornerRadius).toBe(24);

    const audio = doc.tracks.flatMap((track) => track.clips).find((clip) => clip.id === 'clip_full_c3');
    expect(audio?.audio.gain).toBe(0.8);
    expect(audio?.audio.fadeInMs).toBe(500);
    expect(audio?.audio.fadeOutMs).toBe(500);
  });

});
