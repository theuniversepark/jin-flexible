import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Simulation, fmtClock } from './sim.js';
import { FactoryView } from './factory.js';
import { UI } from './ui.js';
import { DataHub, download } from './datahub.js';
import { parseOrder } from './order.js';
import { MIXES } from './zone.js';

const $ = (id) => document.getElementById(id);

// ── 렌더러 ──
const host = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.prepend(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'absolute', top: '0', left: '0' });
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 70, 140);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.3, 300);
const controls = new OrbitControls(camera, labels.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 5; controls.maxDistance = 110;
const VIEWS = {
  all: { pos: [2, 34, 40], tgt: [0, 0, -1.5] },
  top: { pos: [0, 15, 13], tgt: [0, 0, -6] },
  bot: { pos: [2, 14, 22], tgt: [2, 0, 4] },
  weld: { pos: [0.6, 6.2, 3.2], tgt: [0, 0.9, -5.4] },
  plan: { pos: [0, 62, 0.01], tgt: [0, 0, -0.5] },
};
let camAnim = null;
function setView(k, instant = false) {
  const v = VIEWS[k];
  if (instant) { camera.position.set(...v.pos); controls.target.set(...v.tgt); controls.update(); return; }
  camAnim = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.pos), t1: new THREE.Vector3(...v.tgt) };
}
setView('all', true);

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(-18, 38, 22); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 24, bottom: -24, near: 1, far: 110 });
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x9ec9ff, 0.45); fill.position.set(26, 18, -20); scene.add(fill);

// ── 시뮬레이션 ──
const view = new FactoryView(scene);
const ui = new UI();
const hub = new DataHub(); ui.hub = hub;
let sim, speed = 5, playing = true, pending = [];
const params = new URLSearchParams(location.search);
function start(mode, mix) {
  sim = new Simulation({ mode, mix, seed: Math.floor(Math.random() * 1e6) });
  sim.speedMul = speed;
  sim.on((e) => { ui.addLog(e); pending.push(e); });
  view.reset(); ui.bind(sim); ui.redrawLog(); ui.cmp = null;
  for (const e of sim.events) pending.push(e);
  try { localStorage.setItem('fms.mode', mode); localStorage.setItem('fms.mix', mix); } catch {}
}
let saved = {}; try { saved = { mode: localStorage.getItem('fms.mode'), mix: localStorage.getItem('fms.mix') }; } catch {}
start(params.get('mode') ?? saved.mode ?? 'smart', MIXES[saved.mix] ? saved.mix : '2:1');
window.fms = { get sim() { return sim; }, view, ui, hub };   // 디버그·자동 시험용

// ── 입력 ──
$('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b && b.dataset.mode !== sim.modeKey) start(b.dataset.mode, sim.mix); });
$('mixSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-mix]'); if (!b) return; sim.setMix(b.dataset.mix); ui.renderStatic(); try { localStorage.setItem('fms.mix', sim.mix); } catch {} });
$('speedSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-speed]'); if (!b) return; speed = +b.dataset.speed; sim.speedMul = speed; for (const x of $('speedSeg').children) x.classList.toggle('on', x === b); });
const togglePlay = () => { playing = !playing; sim.paused = !playing; $('playBtn').textContent = playing ? '❚❚' : '▶'; };
$('playBtn').addEventListener('click', togglePlay);
$('btnEstop').addEventListener('click', () => {
  sim.estop = !sim.estop;
  $('btnEstop').classList.toggle('on', sim.estop); $('estopBanner').hidden = !sim.estop;
  $('btnEstop').textContent = sim.estop ? '↺ 리셋' : '🛑 비상정지';
  sim.log(sim.estop ? 'alarm' : 'ok', 'ORCH', null, sim.estop ? '비상정지 발령 — 안전 PLC가 모든 셀·AMR 정지 (AI 명령 차단)' : '비상정지 리셋 — 안전 확인 후 셀 재가동');
});
$('orderForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const r = parseOrder($('orderIn').value);
  ui.orderErr = r.error ?? null;
  if (!r.error) {
    if (r.mix) { sim.setMix(r.mix); ui.renderStatic(); }
    if (r.items || r.qty) sim.addOrder({ items: r.items, qty: r.qty, label: $('orderIn').value.trim().slice(0, 30) });
    $('orderIn').value = '';
  }
  ui.renderKpis(sim);
});
$('injBtns').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-inj]'); if (!b) return;
  const ok = sim.inject(b.dataset.inj);
  if (!ok) sim.log('info', 'ORCH', null, `[시나리오] ${b.textContent} — 지금은 대상이 없습니다 (이송 중인 AMR 없음)`);
});
$('cellList').addEventListener('click', (e) => { const r = e.target.closest('[data-cell]'); if (r) select({ kind: 'cell', id: r.dataset.cell }); });
$('dockTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (!b) return; ui.tab === b.dataset.tab ? ui.closeDock() : ui.openDock(b.dataset.tab); });
$('dockClose').addEventListener('click', () => ui.closeDock());
$('dockBody').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-dl]'); if (!b) return;
  const stamp = new Date(hub.t0 + sim.t * 1000).toISOString().slice(0, 19).replace(/[:T]/g, '');
  const k = b.dataset.dl, base = `A1-FMS_${sim.modeKey}_${stamp}`;
  if (k === 'episodes') download(`${base}_episodes.jsonl`, hub.episodesJsonl(sim), 'application/x-ndjson');
  if (k === 'events') download(`${base}_events.csv`, '﻿' + hub.eventsCsv(sim), 'text/csv');
  if (k === 'series') download(`${base}_kpi.csv`, hub.seriesCsv(sim), 'text/csv');
  if (k === 'aas') download(`${base}.aas.json`, JSON.stringify(hub.aasEnvironment(sim), null, 1));
  if (k === 'snapshot') download(`${base}_snapshot.json`, JSON.stringify(sim.snapshot(), null, 1));
});
$('views').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
$('infoClose').addEventListener('click', () => select(null));
$('tglLeft').addEventListener('click', () => document.body.classList.toggle('hide-left'));
$('tglRight').addEventListener('click', () => document.body.classList.toggle('hide-right'));
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === '[') document.body.classList.toggle('hide-left');
  if (e.key === ']') document.body.classList.toggle('hide-right');
  if (e.key === 'Escape') { if (ui.tab) ui.closeDock(); else select(null); }
  const keys = { 1: 'legacy', 2: 'smart', 3: 'dark' };
  if (keys[e.key]) start(keys[e.key], sim.mix);
});

function select(sel) { view.selected = sel?.id ?? null; ui.showInfo(sel); }
view.onPick = select;
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let down = null;
labels.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
labels.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(view.pickables, false)[0];
  const u = hit?.object.userData;
  if (!u?.pick) return;
  select(u.pick === 'amr' ? { kind: 'amr', id: u.id } : u.pick === 'robot' ? { kind: 'robot', id: u.id, cell: u.cell } : { kind: 'cell', id: u.id });
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
});

// ── 메인 루프 ──
const clock = new THREE.Clock();
let uiT = 0, pubT = 0;
hub.probe();
function frame() {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, clock.getDelta());
  if (playing && !sim.estop) {
    // 배속만큼 시뮬레이션 시간을 0.1초 간격으로 진행
    let left = rdt * speed;
    while (left > 1e-6) { const d = Math.min(0.1, left); sim.step(d); left -= d; }
  }
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + rdt * 1.6);
    const k = 1 - (1 - camAnim.t) ** 3;
    camera.position.lerpVectors(camAnim.p0, camAnim.p1, k); controls.target.lerpVectors(camAnim.t0, camAnim.t1, k);
    if (camAnim.t >= 1) camAnim = null;
  }
  controls.update();
  view.update(sim, rdt * (playing ? speed : 0), rdt);
  $('clock').textContent = fmtClock(sim.t);
  uiT += rdt; pubT += rdt;
  if (uiT > 0.4) {
    uiT = 0; ui.renderKpis(sim); ui.renderInfo(); ui.renderBlocks();
    if (ui.tab && ui.tab !== 'compare' && !$('dock').matches(':hover')) ui.renderDock();
  }
  if (pubT > 2) { pubT = 0; if (hub.server) hub.publish(sim, pending.splice(0)); else pending.length = 0; }
  renderer.render(scene, camera);
  labels.render(scene, camera);
}
frame();
