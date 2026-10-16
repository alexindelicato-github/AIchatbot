/**
 * @jest-environment node
 *
 * Tests for the CVE enrichment service
 */

import { extractCveIds, lookupCves, formatCveContext, isCveLookupEnabled, OSV_API_BASE } from '../cveLookup.js';

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

const log4shell = {
  id: 'CVE-2021-44228',
  summary: 'Log4Shell',
  details: 'JNDI lookup RCE',
  published: '2021-12-10T10:15:09Z',
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H' }],
  aliases: ['GHSA-jfh8-c2jp-5v3q'],
  affected: [
    { package: { ecosystem: 'Maven', name: 'org.apache.logging.log4j:log4j-core' } },
    { package: { ecosystem: 'Maven', name: 'org.apache.logging.log4j:log4j-core' } },
  ],
};

describe('extractCveIds', () => {
  test('finds, normalizes and dedupes CVE IDs', () => {
    expect(extractCveIds('Is cve-2021-44228 like CVE-2021-44228 or CVE-2014-0160?'))
      .toEqual(['CVE-2021-44228', 'CVE-2014-0160']);
  });

  test('caps the number of IDs per message', () => {
    const text = Array.from({ length: 8 }, (_, i) => `CVE-2024-${1000 + i}`).join(' ');
    expect(extractCveIds(text)).toHaveLength(5);
  });

  test('ignores malformed IDs and non-string input', () => {
    expect(extractCveIds('CVE-21-1 CVE-2021-12 CVE-2021-1234/../../admin')).toEqual(['CVE-2021-1234']);
    expect(extractCveIds(undefined)).toEqual([]);
    expect(extractCveIds({ content: 'CVE-2021-44228' })).toEqual([]);
  });
});

describe('lookupCves', () => {
  test('fetches each ID from OSV.dev and maps the record', async () => {
    const fetchImpl = jest.fn(async () => okResponse(log4shell));

    const { records, failures } = await lookupCves(['CVE-2021-44228'], { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(`${OSV_API_BASE}CVE-2021-44228`, expect.any(Object));
    expect(failures).toEqual([]);
    expect(records).toEqual([{
      id: 'CVE-2021-44228',
      summary: 'Log4Shell',
      details: 'JNDI lookup RCE',
      severity: ['CVSS_V3 CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H'],
      aliases: ['GHSA-jfh8-c2jp-5v3q'],
      packages: ['Maven/org.apache.logging.log4j:log4j-core'],
      published: '2021-12-10T10:15:09Z',
    }]);
  });

  test('truncates long details', async () => {
    const fetchImpl = async () => okResponse({ id: 'CVE-2024-0001', details: 'x'.repeat(10000) });

    const { records } = await lookupCves(['CVE-2024-0001'], { fetchImpl });

    expect(records[0].details).toHaveLength(1500);
  });

  test('fails open per ID on HTTP errors and exceptions', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('CVE-2000-0001')) return { ok: false, status: 404 };
      if (url.endsWith('CVE-2000-0002')) throw new Error('timeout');
      return okResponse(log4shell);
    });

    const { records, failures } = await lookupCves(
      ['CVE-2000-0001', 'CVE-2000-0002', 'CVE-2021-44228'],
      { fetchImpl }
    );

    expect(records.map((r) => r.id)).toEqual(['CVE-2021-44228']);
    expect(failures).toEqual([
      { id: 'CVE-2000-0001', error: 'HTTP 404' },
      { id: 'CVE-2000-0002', error: 'timeout' },
    ]);
  });
});

describe('formatCveContext', () => {
  test('returns empty string when there are no records', () => {
    expect(formatCveContext([])).toBe('');
  });

  test('labels the data as untrusted and includes record fields', async () => {
    const { records } = await lookupCves(['CVE-2021-44228'], { fetchImpl: async () => okResponse(log4shell) });

    const context = formatCveContext(records);

    expect(context).toMatch(/untrusted reference material/);
    expect(context).toContain('CVE-2021-44228 — Log4Shell');
    expect(context).toContain('Affected packages: Maven/org.apache.logging.log4j:log4j-core');
  });
});

describe('isCveLookupEnabled', () => {
  const original = process.env.CVE_LOOKUP_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.CVE_LOOKUP_ENABLED;
    else process.env.CVE_LOOKUP_ENABLED = original;
  });

  test('is enabled by default', () => {
    delete process.env.CVE_LOOKUP_ENABLED;
    expect(isCveLookupEnabled()).toBe(true);
  });

  test('can be disabled with CVE_LOOKUP_ENABLED=false', () => {
    process.env.CVE_LOOKUP_ENABLED = 'false';
    expect(isCveLookupEnabled()).toBe(false);
  });
});
