/**
 * @jest-environment node
 *
 * Tests for the upload storage service (local disk and S3 backends)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { S3Client } from '@aws-sdk/client-s3';
import { createUploadStore, generateStoredName } from '../storage.js';

describe('generateStoredName', () => {
  test('keeps the extension and randomises the name', () => {
    const a = generateStoredName('config.yaml');
    const b = generateStoredName('config.yaml');
    expect(a).toMatch(/^\d+-[0-9a-f]{16}\.yaml$/);
    expect(a).not.toBe(b);
  });
});

describe('local backend', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
    store = createUploadStore({ bucket: '', uploadDir: dir });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('reads, links and removes a file written by multer', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');

    expect(store.backend).toBe('local');
    expect(await store.save({ filename: 'a.txt' })).toBe('a.txt');
    expect(await store.read('a.txt')).toEqual({ size: 5, content: 'hello' });
    expect(await store.downloadUrl('a.txt')).toBe('/uploads/a.txt');

    await store.remove('a.txt');
    expect(await store.read('a.txt')).toBeNull();
  });

  test('blocks path traversal', async () => {
    expect(await store.read('../../etc/passwd')).toBeNull();
  });
});

describe('S3 backend', () => {
  const client = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIDTEST', secretAccessKey: 'secret' } });
  const store = createUploadStore({ bucket: 'test-bucket', uploadDir: '/unused', urlTtlSeconds: 120, client });

  afterEach(() => jest.restoreAllMocks());

  test('uploads to the bucket with encryption and records the stored name', async () => {
    const send = jest.spyOn(client, 'send').mockResolvedValue({});
    const file = { originalname: 'main.tf', buffer: Buffer.from('resource {}') };

    const name = await store.save(file);

    expect(store.backend).toBe('s3');
    expect(file.filename).toBe(name);
    const input = send.mock.calls[0][0].input;
    expect(input).toMatchObject({ Bucket: 'test-bucket', Key: `uploads/${name}`, ServerSideEncryption: 'AES256' });
    expect(input.Body.toString()).toBe('resource {}');
  });

  test('reads content back and returns null for missing keys', async () => {
    const send = jest.spyOn(client, 'send')
      .mockResolvedValueOnce({ ContentLength: 3, Body: { transformToString: async () => 'abc' } })
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));

    expect(await store.read('x.txt')).toEqual({ size: 3, content: 'abc' });
    expect(await store.read('../y.txt')).toBeNull();
    expect(send.mock.calls[1][0].input.Key).toBe('uploads/y.txt');
  });

  test('signs a short-lived download URL that forces an attachment', async () => {
    const url = new URL(await store.downloadUrl('page.html'));

    expect(url.hostname).toContain('test-bucket');
    expect(url.pathname).toBe('/uploads/page.html');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="page.html"');
    expect(url.searchParams.get('response-content-type')).toBe('text/plain; charset=utf-8');
  });
});
