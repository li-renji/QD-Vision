/**
 * JSON Schema 校验封装测试（BUG-05）。
 *
 * `validation.ts` 是「工程文件唯一真源」的运行时闸门：
 * - `validateProjectDoc` 把 Ajv 错误翻译成**结构化问题**（JSON Pointer + 中文提示）；
 * - `assertValidProjectDoc` 在失败时抛 `ValidationError`；
 * - `formatValidationErrors` 把问题列表渲染成可读文本。
 *
 * 本文件的目标是把 `toHint` 的**每一个分支**都走到：
 * `required` / `type` / `minimum` / `maximum` / `pattern` / `enum` / `minItems` / 兜底分支。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ValidationError,
  assertValidProjectDoc,
  formatValidationErrors,
  validateProjectDoc,
  type ValidationIssue,
} from '../validation.js';
import { FIXTURE_NAMES, readFixtureJson } from '../../../test/fixtures.js';

/** 深拷贝一个夹具，避免用例之间互相污染。 */
function cloneFixture(name = 'minimal.clipcut.json'): Record<string, unknown> {
  return structuredClone(readFixtureJson(name)) as Record<string, unknown>;
}

/** 取某个字段的校验问题。 */
function issueFor(json: unknown, path: string): ValidationIssue | undefined {
  return validateProjectDoc(json).find((issue) => issue.path === path);
}

describe('domain/project/validation', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../../../../../schema/project.schema.json');
    vi.restoreAllMocks();
  });

  describe('validateProjectDoc', () => {
    it.each(FIXTURE_NAMES)('夹具 %s 校验通过（无问题）', (name) => {
      expect(validateProjectDoc(readFixtureJson(name))).toEqual([]);
    });

    it('required：缺失字段的路径指向缺失的字段名', () => {
      const json = cloneFixture();
      delete json['tracks'];

      const issue = issueFor(json, '/tracks');

      expect(issue).toBeDefined();
      expect(issue?.message).toBe("must have required property 'tracks'");
      expect(issue?.hint).toBe('字段 /tracks 缺少必填字段');
    });

    it('required：嵌套对象的缺失字段路径逐级拼接', () => {
      const json = cloneFixture();
      const settings = json['settings'] as Record<string, unknown>;
      delete settings['canvas'];

      const issue = issueFor(json, '/settings/canvas');

      expect(issue).toBeDefined();
      expect(issue?.hint).toBe('字段 /settings/canvas 缺少必填字段');
    });

    it('type：类型不符时提示期望类型', () => {
      const json = cloneFixture();
      json['name'] = 123;

      const issue = issueFor(json, '/name');

      expect(issue).toBeDefined();
      expect(issue?.hint).toBe('字段 /name 类型应为 string');
    });

    it('type：根节点类型不符时提示「根节点」', () => {
      const issue = validateProjectDoc('not-an-object').find((item) => item.path === '');

      expect(issue).toBeDefined();
      expect(issue?.hint).toBe('根节点 类型应为 object');
    });

    it('minimum：数值下界', () => {
      const json = cloneFixture();
      const settings = json['settings'] as Record<string, unknown>;
      (settings['canvas'] as Record<string, unknown>)['width'] = 0;

      const issue = issueFor(json, '/settings/canvas/width');

      expect(issue).toBeDefined();
      // 分支识别：minimum → 「不能小于」
      expect(issue?.hint).toMatch(/^字段 \/settings\/canvas\/width 不能小于 /);
      // 数值边界由 Ajv 原始信息承载（稳定断言）
      expect(issue?.message).toBe('must be >= 1');
    });

    it('maximum：数值上界', () => {
      const json = cloneFixture();
      const settings = json['settings'] as Record<string, unknown>;
      (settings['canvas'] as Record<string, unknown>)['width'] = 999_999;

      const issue = issueFor(json, '/settings/canvas/width');

      expect(issue).toBeDefined();
      // 分支识别：maximum → 「不能大于」
      expect(issue?.hint).toMatch(/^字段 \/settings\/canvas\/width 不能大于 /);
      expect(issue?.message).toBe('must be <= 7680');
    });

    it('minimum 与 maximum 是两条不同分支（提示文案不混淆）', () => {
      const low = cloneFixture();
      (low['settings'] as Record<string, unknown>)['canvas'] = {
        ...((low['settings'] as Record<string, unknown>)['canvas'] as Record<string, unknown>),
        width: 0,
      };
      const high = cloneFixture();
      (high['settings'] as Record<string, unknown>)['canvas'] = {
        ...((high['settings'] as Record<string, unknown>)['canvas'] as Record<string, unknown>),
        width: 999_999,
      };

      const lowHint = issueFor(low, '/settings/canvas/width')?.hint ?? '';
      const highHint = issueFor(high, '/settings/canvas/width')?.hint ?? '';

      expect(lowHint).toContain('不能小于');
      expect(highHint).toContain('不能大于');
      expect(lowHint).not.toBe(highHint);
    });

    it('pattern：字符串格式', () => {
      const json = cloneFixture();
      json['schemaVersion'] = 'not-a-version';

      const issue = issueFor(json, '/schemaVersion');

      expect(issue).toBeDefined();
      expect(issue?.hint).toBe('字段 /schemaVersion 格式不合法');
    });

    it('enum：枚举取值', () => {
      const json = cloneFixture();
      const settings = json['settings'] as Record<string, unknown>;
      (settings['canvas'] as Record<string, unknown>)['aspectPreset'] = '21:9';

      const issue = issueFor(json, '/settings/canvas/aspectPreset');

      expect(issue).toBeDefined();
      expect(issue?.hint).toBe('字段 /settings/canvas/aspectPreset 取值不在允许范围内');
    });

    it('兜底分支：minLength 等未专门处理的关键字', () => {
      const json = cloneFixture();
      json['projectId'] = '';

      const issue = issueFor(json, '/projectId');

      expect(issue).toBeDefined();
      expect(issue?.hint).toContain('字段 /projectId 不合法');
      expect(issue?.message).toBe('must NOT have fewer than 1 characters');
    });

    it('exclusiveMinimum：数值严格下界（走显式分支，不再落到兜底）', () => {
      const json = cloneFixture();
      const tracks = json['tracks'] as Array<Record<string, unknown>>;
      const clips = tracks[0]?.['clips'] as Array<Record<string, unknown>>;
      const transform = clips[0]?.['transform'] as Record<string, unknown>;
      transform['scale'] = 0;

      const issue = issueFor(json, '/tracks/0/clips/0/transform/scale');

      expect(issue).toBeDefined();
      // clipTransform.scale 是 exclusiveMinimum: 0 → 提示必须带阈值
      expect(issue?.hint).toBe('字段 /tracks/0/clips/0/transform/scale 必须大于 0');
    });

    it('minItems：数组元素数量不足（该分支在当前 schema 下不可达，用定制 schema 覆盖）', async () => {
      // 当前 `schema/project.schema.json` 里没有任何 `minItems` 约束，
      // 因此这条分支无法通过真实工程数据触达。这里用一份**最小定制 schema**
      // 重新加载校验模块，验证 `toHint` 的 minItems 文案确实正确。
      vi.resetModules();
      vi.doMock('../../../../../../schema/project.schema.json', () => ({
        default: {
          type: 'object',
          required: ['tracks'],
          properties: {
            tracks: { type: 'array', minItems: 2 },
          },
        },
      }));

      const { validateProjectDoc: validateWithMinItems } = await import('../validation.js');
      const issues = validateWithMinItems({ tracks: [{ id: 'only-one' }] });

      expect(issues.length).toBe(1);
      expect(issues[0]?.hint).toBe('字段 /tracks 至少需要 2 个元素');
      expect(issues[0]?.path).toBe('/tracks');
    });

    it('一次收集全部问题（allErrors），而不是只报第一个', () => {
      const json = cloneFixture();
      delete json['tracks'];
      json['name'] = 123;
      json['schemaVersion'] = 'bad';

      const issues = validateProjectDoc(json);

      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(['/tracks', '/name', '/schemaVersion']),
      );
    });

    it('非对象输入不会抛异常，只返回问题列表', () => {
      for (const input of [null, undefined, 42, 'str', [], true]) {
        expect(() => validateProjectDoc(input)).not.toThrow();
        expect(validateProjectDoc(input).length).toBeGreaterThan(0);
      }
    });

    it('问题对象的 message 来自 Ajv 原始信息（不是中文提示）', () => {
      const json = cloneFixture();
      delete json['tracks'];

      const issue = issueFor(json, '/tracks');

      expect(issue?.message).not.toContain('缺少必填字段');
      expect(issue?.message).toContain('tracks');
    });
  });

  /**
   * `toHint` 数值边界文案 —— Ajv v8 `params` 参数名回归。
   *
   * Ajv v8（实测 8.20.0）的数值类错误 `params` 结构为：
   * `{ comparison: '>=' | '<=' | '>' | '<', limit: <约束数值> }`
   * —— `comparison` 是**操作符**，`limit` 才是**约束数值**。
   *
   * 历史 BUG：`toHint` 取的是 `params.comparison`，
   * 于是提示变成「不能小于 >=」—— 把运算符当阈值展示给用户。
   * 这组用例锁死「提示里必须出现真实阈值、且不得出现运算符」。
   */
  describe('toHint 数值边界文案（Ajv v8 params 参数名回归）', () => {
    it('minimum：提示包含真实阈值，而不是运算符', () => {
      const json = cloneFixture();
      const settings = json['settings'] as Record<string, unknown>;
      (settings['canvas'] as Record<string, unknown>)['fps'] = 5;

      const issue = issueFor(json, '/settings/canvas/fps');

      expect(issue).toBeDefined();
      // canvas.fps 的 minimum 是 10
      expect(issue?.hint).toContain('10');
      // 运算符绝不能出现在提示里
      expect(issue?.hint).not.toContain('>=');
      expect(issue?.hint).not.toContain('undefined');
      // 方向必须正确：minimum = 不得小于下界
      expect(issue?.hint).not.toContain('不能大于');
      expect(issue?.hint).toBe('字段 /settings/canvas/fps 不能小于 10');
    });

    it('maximum：提示包含真实阈值，而不是运算符', () => {
      const json = cloneFixture();
      const settings = json['settings'] as Record<string, unknown>;
      (settings['canvas'] as Record<string, unknown>)['width'] = 99_999;

      const issue = issueFor(json, '/settings/canvas/width');

      expect(issue).toBeDefined();
      // canvas.width 的 maximum 是 7680
      expect(issue?.hint).toContain('7680');
      expect(issue?.hint).not.toContain('<=');
      expect(issue?.hint).not.toContain('undefined');
      // 方向必须正确：maximum = 不得大于上界
      expect(issue?.hint).not.toContain('不能小于');
      expect(issue?.hint).toBe('字段 /settings/canvas/width 不能大于 7680');
    });

    it('exclusiveMinimum：提示包含真实阈值，而不是运算符', () => {
      const json = cloneFixture();
      const tracks = json['tracks'] as Array<Record<string, unknown>>;
      (tracks[0] as Record<string, unknown>)['height'] = 0;

      const issue = issueFor(json, '/tracks/0/height');

      expect(issue).toBeDefined();
      // track.height 是 exclusiveMinimum: 0 → 必须严格大于
      expect(issue?.hint).toContain('必须大于');
      expect(issue?.hint).not.toContain('>');
      expect(issue?.hint).not.toContain('undefined');
      expect(issue?.hint).toBe('字段 /tracks/0/height 必须大于 0');
    });

    it('exclusiveMaximum：提示包含真实阈值，而不是运算符', async () => {
      // 当前 `schema/project.schema.json` 里没有 `exclusiveMaximum` 约束，
      // 因此用一份**最小定制 schema** 重新加载校验模块，覆盖该分支。
      vi.resetModules();
      vi.doMock('../../../../../../schema/project.schema.json', () => ({
        default: {
          type: 'object',
          properties: {
            h: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 200 },
          },
        },
      }));

      const { validateProjectDoc: validateWithExclusiveMaximum } = await import('../validation.js');
      const issues = validateWithExclusiveMaximum({ h: 500 });

      expect(issues.length).toBe(1);
      expect(issues[0]?.path).toBe('/h');
      expect(issues[0]?.hint).toContain('必须小于');
      expect(issues[0]?.hint).toContain('200');
      expect(issues[0]?.hint).not.toContain('<');
      expect(issues[0]?.hint).not.toContain('undefined');
      expect(issues[0]?.hint).toBe('字段 /h 必须小于 200');
    });

    it('参数名回归锁：所有数值边界的提示都不含 undefined / >= / <=', () => {
      const cases: Array<{ path: string; mutate: (json: Record<string, unknown>) => void }> = [
        {
          path: '/settings/canvas/fps',
          mutate: (json) => {
            const settings = json['settings'] as Record<string, unknown>;
            (settings['canvas'] as Record<string, unknown>)['fps'] = 5;
          },
        },
        {
          path: '/settings/canvas/width',
          mutate: (json) => {
            const settings = json['settings'] as Record<string, unknown>;
            (settings['canvas'] as Record<string, unknown>)['width'] = 99_999;
          },
        },
        {
          path: '/tracks/0/height',
          mutate: (json) => {
            const tracks = json['tracks'] as Array<Record<string, unknown>>;
            (tracks[0] as Record<string, unknown>)['height'] = 0;
          },
        },
      ];

      for (const { path, mutate } of cases) {
        const json = cloneFixture();
        mutate(json);

        const hint = issueFor(json, path)?.hint ?? '';

        expect(hint).not.toBe('');
        // 防止「又改回 comparison」或「取错字段名导致 undefined」
        expect(hint).not.toContain('undefined');
        expect(hint).not.toContain('>=');
        expect(hint).not.toContain('<=');
        // 提示末尾必须是一个数字（真实阈值），而不是运算符
        expect(hint).toMatch(/\d$/);
      }
    });
  });

  describe('assertValidProjectDoc', () => {
    it('合法工程不抛错', () => {
      expect(() => {
        assertValidProjectDoc(readFixtureJson('minimal.clipcut.json'));
      }).not.toThrow();
    });

    it('非法工程抛 ValidationError，并带上问题列表', () => {
      const json = cloneFixture();
      delete json['tracks'];

      let caught: unknown = null;
      try {
        assertValidProjectDoc(json);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      const error = caught as ValidationError;
      expect(error.name).toBe('ValidationError');
      expect(error.issues.length).toBeGreaterThan(0);
      expect(error.issues[0]?.path).toBe('/tracks');
    });

    it('错误信息包含问题数量与首条提示', () => {
      const json = cloneFixture();
      delete json['tracks'];

      expect(() => {
        assertValidProjectDoc(json);
      }).toThrowError(/工程数据校验失败（1 项问题）：字段 \/tracks 缺少必填字段/);
    });
  });

  describe('ValidationError', () => {
    it('问题列表为空时提示后缀为空字符串', () => {
      const error = new ValidationError([]);

      expect(error.message).toBe('工程数据校验失败（0 项问题）：');
      expect(error.issues).toEqual([]);
    });

    it('保留传入的问题列表', () => {
      const issues: ValidationIssue[] = [
        { path: '/a', message: 'm', hint: 'h' },
        { path: '/b', message: 'm2', hint: 'h2' },
      ];

      const error = new ValidationError(issues);

      expect(error.issues).toBe(issues);
      expect(error.message).toBe('工程数据校验失败（2 项问题）：h');
    });

    it('是 Error 的实例，可被 instanceof 捕获', () => {
      const error = new ValidationError([]);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ValidationError);
    });
  });

  describe('formatValidationErrors', () => {
    it('空列表返回空字符串', () => {
      expect(formatValidationErrors([])).toBe('');
    });

    it('按序编号渲染每一行', () => {
      const issues: ValidationIssue[] = [
        { path: '/a', message: 'm', hint: '第一条' },
        { path: '/b', message: 'm', hint: '第二条' },
      ];

      expect(formatValidationErrors(issues)).toBe('1. 第一条\n2. 第二条');
    });

    it('与 validateProjectDoc 的输出串起来即为可读错误报告', () => {
      const json = cloneFixture();
      delete json['tracks'];
      json['name'] = 123;

      const text = formatValidationErrors(validateProjectDoc(json));

      expect(text.split('\n')).toHaveLength(2);
      expect(text).toContain('缺少必填字段');
      expect(text).toContain('类型应为 string');
    });
  });
});
