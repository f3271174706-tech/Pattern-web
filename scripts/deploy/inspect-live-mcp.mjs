// Read-only observation; does not create projects, sessions or deployment state.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const page = await browser.newPage();
try {
  const origin = 'https://perler.cloud';
  const document = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const records = [{ path: '/', method: 'GET', status: document.status(), contentType: document.headers()['content-type'] }];
  for (const path of ['/api/v1/health', '/mcp']) {
    const response = await page.request.get(origin + path);
    records.push({ path, method: 'GET', status: response.status(), contentType: response.headers()['content-type'] });
  }
  const response = await page.request.post(origin + '/mcp', { headers: { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'readonly-audit', version: '1.0' } } } });
  records.push({ path: '/mcp', method: 'POST initialize', status: response.status(), contentType: response.headers()['content-type'] });
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), origin, records }));
} finally { await browser.close(); }
