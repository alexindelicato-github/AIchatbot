/**
 * Tests for the content moderation service
 */

import { moderateText, isModerationEnabled, MODERATION_MODEL } from '../moderation.js';

const fakeClient = (impl) => ({ moderations: { create: jest.fn(impl) } });

describe('moderateText', () => {
  test('returns flagged categories from the moderation result', async () => {
    const client = fakeClient(async () => ({
      results: [{ flagged: true, categories: { harassment: true, violence: false, 'self-harm': true } }],
    }));

    const result = await moderateText(client, 'some bad text');

    expect(result).toEqual({ flagged: true, categories: ['harassment', 'self-harm'] });
    expect(client.moderations.create).toHaveBeenCalledWith({ model: MODERATION_MODEL, input: 'some bad text' });
  });

  test('passes clean content through', async () => {
    const client = fakeClient(async () => ({ results: [{ flagged: false, categories: { harassment: false } }] }));

    expect(await moderateText(client, 'how do I hash passwords?')).toEqual({ flagged: false, categories: [] });
  });

  test('skips the API call for empty input', async () => {
    const client = fakeClient(async () => ({}));

    expect(await moderateText(client, '')).toEqual({ flagged: false, categories: [] });
    expect(client.moderations.create).not.toHaveBeenCalled();
  });

  test('truncates very large input', async () => {
    const client = fakeClient(async () => ({ results: [{ flagged: false, categories: {} }] }));

    await moderateText(client, 'a'.repeat(100000));

    expect(client.moderations.create.mock.calls[0][0].input).toHaveLength(32000);
  });

  test('fails open and reports the error when the API call throws', async () => {
    const client = fakeClient(async () => { throw new Error('network down'); });

    expect(await moderateText(client, 'hello')).toEqual({ flagged: false, categories: [], error: 'network down' });
  });
});

describe('isModerationEnabled', () => {
  const original = process.env.MODERATION_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.MODERATION_ENABLED;
    else process.env.MODERATION_ENABLED = original;
  });

  test('is enabled by default', () => {
    delete process.env.MODERATION_ENABLED;
    expect(isModerationEnabled()).toBe(true);
  });

  test('can be disabled with MODERATION_ENABLED=false', () => {
    process.env.MODERATION_ENABLED = 'false';
    expect(isModerationEnabled()).toBe(false);
  });
});
