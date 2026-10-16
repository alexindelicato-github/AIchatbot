/**
 * @jest-environment node
 *
 * Tests for the RAG knowledge base (chunking, embeddings, Qdrant calls)
 */

import { chunkText, createKnowledgeBase, formatKnowledgeContext, EMBEDDING_MODEL } from '../knowledgeBase.js';

const fakeOpenAI = () => ({
  embeddings: {
    create: jest.fn(async ({ input }) => ({ data: input.map((_, i) => ({ embedding: [i, 0.5] })) })),
  },
});

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function setup(routes = {}) {
  const fetchImpl = jest.fn(async (url, init) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    const handler = routes[key];
    return handler ? handler(JSON.parse(init.body || 'null'), init) : jsonResponse({ result: true });
  });
  const openai = fakeOpenAI();
  const kb = createKnowledgeBase({
    openai, url: 'http://qdrant:6333/', apiKey: 'secret', collection: 'kb', topK: 3, minScore: 0.4, fetchImpl,
  });
  return { kb, openai, fetchImpl };
}

describe('chunkText', () => {
  test('returns no chunks for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(undefined)).toEqual([]);
  });

  test('keeps short text as a single chunk', () => {
    expect(chunkText('  hello world  ')).toEqual(['hello world']);
  });

  test('splits long text into overlapping chunks no larger than the size', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Line ${i} `.repeat(5)).join('\n');
    const chunks = chunkText(text, { size: 300, overlap: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(300));
    expect(chunks[0]).toContain(chunks[1].slice(0, 30)); // consecutive chunks overlap
  });

  test('caps the number of chunks per document', () => {
    expect(chunkText('x'.repeat(1_000_000))).toHaveLength(200);
  });
});

describe('createKnowledgeBase', () => {
  test('is disabled without a Qdrant URL', () => {
    expect(createKnowledgeBase({ openai: fakeOpenAI(), url: '' })).toEqual({ enabled: false });
  });

  test('creates the collection when it does not exist', async () => {
    const { kb, fetchImpl } = setup({ 'GET /collections/kb': () => jsonResponse({}, 404) });

    await kb.ensureCollection();

    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe('http://qdrant:6333/collections/kb');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ vectors: { size: 1536, distance: 'Cosine' } });
    expect(init.headers['api-key']).toBe('secret');
  });

  test('does not recreate an existing collection', async () => {
    const { kb, fetchImpl } = setup();

    await kb.ensureCollection();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('ingest embeds each chunk and upserts points with document payload', async () => {
    const { kb, openai, fetchImpl } = setup();

    const result = await kb.ingest({ documentId: 'doc-1', title: 'Policy', text: 'Use bcrypt for passwords.' });

    expect(result).toEqual({ chunks: 1 });
    expect(openai.embeddings.create).toHaveBeenCalledWith({ model: EMBEDDING_MODEL, input: ['Use bcrypt for passwords.'] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://qdrant:6333/collections/kb/points?wait=true');
    const { points } = JSON.parse(init.body);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      vector: [0, 0.5],
      payload: { document_id: 'doc-1', title: 'Policy', chunk_index: 0, text: 'Use bcrypt for passwords.' },
    });
  });

  test('ingest skips Qdrant for empty documents', async () => {
    const { kb, fetchImpl } = setup();

    expect(await kb.ingest({ documentId: 'd', title: 't', text: '   ' })).toEqual({ chunks: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('search embeds the query and maps hits', async () => {
    const { kb, fetchImpl } = setup({
      'POST /collections/kb/points/search': () => jsonResponse({
        result: [{ id: 'p1', score: 0.82, payload: { document_id: 'doc-1', title: 'Policy', text: 'Use bcrypt.' } }],
      }),
    });

    const hits = await kb.search('how should I store passwords?');

    expect(hits).toEqual([{ documentId: 'doc-1', title: 'Policy', text: 'Use bcrypt.', score: 0.82 }]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ limit: 3, score_threshold: 0.4, with_payload: true });
  });

  test('search returns nothing for empty queries without calling out', async () => {
    const { kb, openai, fetchImpl } = setup();

    expect(await kb.search('')).toEqual([]);
    expect(openai.embeddings.create).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('deleteDocument removes points by document_id filter', async () => {
    const { kb, fetchImpl } = setup();

    await kb.deleteDocument('doc-1');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://qdrant:6333/collections/kb/points/delete?wait=true');
    expect(JSON.parse(init.body)).toEqual({ filter: { must: [{ key: 'document_id', match: { value: 'doc-1' } }] } });
  });

  test('surfaces Qdrant HTTP errors', async () => {
    const { kb } = setup({ 'POST /collections/kb/points/search': () => jsonResponse({}, 500) });

    await expect(kb.search('anything')).rejects.toThrow('HTTP 500');
  });
});

describe('formatKnowledgeContext', () => {
  test('returns empty string when there are no hits', () => {
    expect(formatKnowledgeContext([])).toBe('');
  });

  test('labels excerpts as untrusted and numbers them by title', () => {
    const context = formatKnowledgeContext([
      { title: 'Policy', text: 'Use bcrypt.' },
      { title: 'Runbook', text: 'Rotate keys quarterly.' },
    ]);

    expect(context).toMatch(/untrusted reference material/);
    expect(context).toContain('[1] Policy\nUse bcrypt.');
    expect(context).toContain('[2] Runbook\nRotate keys quarterly.');
  });
});
