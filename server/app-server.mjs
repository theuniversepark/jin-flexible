// 정적 파일 제공 + 데이터 연동 API. npm start(server.mjs)가 쓴다.
//   GET  /api/status         — 서버·MQTT 브로커 상태
//   POST /api/mqtt/publish   — 브라우저(시뮬레이션)가 만든 OPC UA PubSub JSON 메시지를 내장 MQTT 브로커로 발행
//   POST /api/episodes       — 에피소드 JSONL을 data/episodes/에 저장 (본문 8MB 이하)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMqtt, mqttStatus, mqttPublish } from './mqtt-gateway.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };
const PUBLIC = ['index.html', 'css/', 'js/', 'vendor/', 'assets/', 'docs/'];
const DATA_DIR = () => process.env.FMS_DATA_DIR || path.join(ROOT, 'data');

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (!PUBLIC.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)))) { res.writeHead(404); return res.end('not found'); }
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

export async function startServer({ port = 8770, host = '127.0.0.1' } = {}) {
  await startMqtt();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (url.pathname === '/api/status') return send(res, 200, { ok: true, app: 'Jin-FMS', mqtt: mqttStatus() });
      if (url.pathname === '/api/mqtt/publish' && req.method === 'POST') {
        const j = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
        return send(res, 200, { published: mqttPublish(Array.isArray(j.messages) ? j.messages : []) });
      }
      if (url.pathname === '/api/episodes' && req.method === 'POST') {
        const id = url.searchParams.get('id') ?? '';
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) return send(res, 400, { error: 'id 형식 오류' });
        const buf = await readBody(req, 8 * 1024 * 1024);
        const dir = path.join(DATA_DIR(), 'episodes'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${id}.jsonl`), buf);
        return send(res, 200, { ok: true, bytes: buf.length });
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'unknown api' });
      return serveStatic(req, res, url);
    } catch (e) { return send(res, 400, { error: e.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, port: server.address().port };
}
