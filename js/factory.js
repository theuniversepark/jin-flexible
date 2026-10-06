// 3D 화면 — 유연생산 Zone 바닥·차로·셀 설비·로봇(IK)·AMR·작업물·작업자.
// 시뮬레이션(sim.js) 상태를 매 프레임 읽어 그린다. 좌표는 zone.js 레이아웃(m)과 같다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CELLS, LAY, PRODUCTS, CELL_STATES, AMR as AMR_SPEC, PARK, family, isDoor } from './zone.js';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...o });
const MAT = {
  floor: M(0x2a3038, { roughness: 0.92 }), zone: M(0x323a44, { roughness: 0.85 }), pad: M(0x3a434e, { roughness: 0.8 }),
  steel: M(0xb9c1ca, { metalness: 0.55, roughness: 0.35 }), dark: M(0x262b31), black: M(0x15181c),
  robot: M(0xe8edf2, { roughness: 0.45 }), robotAcc: M(0x2f7cf6, { roughness: 0.4 }), joint: M(0x3b4048),
  orange: M(0xf08a24), yellow: M(0xf5c518), red: M(0xe23b3b), green: M(0x2fbf71), blue: M(0x2b6fd6),
  fence: new THREE.MeshStandardMaterial({ color: 0xf5c518, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  post: M(0xd9a400), glass: new THREE.MeshStandardMaterial({ color: 0x9fd7ff, transparent: true, opacity: 0.25, depthWrite: false }),
  panel: M(0xc8ced6, { metalness: 0.6, roughness: 0.32, side: THREE.DoubleSide }), sealer: M(0xf2d16b, { emissive: 0x6a5410, roughness: 0.4 }),
  weld: M(0x3a3026, { roughness: 0.9 }), skin: M(0xf0c8a0), vest: M(0xff8a1f), pants: M(0x34495e), helmet: M(0xffffff),
};
const lineMat = (c, o = 1) => new THREE.LineBasicMaterial({ color: c, transparent: o < 1, opacity: o });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(r, h, mat, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function flatRect(w, d, mat, x, z, y = 0.01) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true;
  return m;
}
function rectOutline(x0, z0, x1, z1, color, y = 0.03, opacity = 1) {
  const g = new THREE.BufferGeometry().setFromPoints([[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.Line(g, lineMat(color, opacity));
}
function label(text, cls) {
  const d = document.createElement('div');
  d.className = cls; d.textContent = text;
  return new CSS2DObject(d);
}

// ── 6축 로봇: 2링크 해석적 IK로 작업점을 따라간다 ─────────────
class Robot {
  constructor(spec, tool) {
    this.spec = spec;
    const g = this.g = new THREE.Group();
    const S = this.S = tool === 'cobot' ? 0.62 : 1;
    this.L1 = 1.15 * S; this.L2 = 1.25 * S; this.shoulderY = 0.8 * S; this.off = 0.22 * S;
    this.toolLen = tool === 'spot' ? 0.55 : tool === 'handling' ? 0.32 : tool === 'cobot' ? 0.18 : 0.3;
    g.add(cyl(0.36 * S, 0.12, MAT.joint, 0, 0.06, 0), cyl(0.3 * S, 0.34 * S, MAT.robot, 0, 0.29 * S, 0));
    this.turret = new THREE.Group(); this.turret.position.y = 0.45 * S; g.add(this.turret);
    this.turret.add(cyl(0.27 * S, 0.3 * S, MAT.robotAcc, 0, 0.12 * S, 0), box(0.5 * S, 0.3 * S, 0.42 * S, MAT.robot, this.off * 0.6, 0.3 * S, 0));
    this.shoulder = new THREE.Group(); this.shoulder.position.set(this.off, this.shoulderY - 0.45 * S, 0); this.turret.add(this.shoulder);
    const j2 = cyl(0.17 * S, 0.5 * S, MAT.joint); j2.rotation.x = Math.PI / 2; this.shoulder.add(j2);
    this.shoulder.add(box(0.26 * S, this.L1, 0.26 * S, MAT.robot, 0, this.L1 / 2, 0));
    this.elbow = new THREE.Group(); this.elbow.position.y = this.L1; this.shoulder.add(this.elbow);
    const j3 = cyl(0.14 * S, 0.42 * S, MAT.joint); j3.rotation.x = Math.PI / 2; this.elbow.add(j3);
    this.elbow.add(box(0.2 * S, this.L2 * 0.82, 0.2 * S, MAT.robot, 0, this.L2 * 0.41, 0), cyl(0.09 * S, this.L2 * 0.2, MAT.robotAcc, 0, this.L2 * 0.9, 0));
    this.wrist = new THREE.Group(); this.wrist.position.y = this.L2; this.elbow.add(this.wrist);
    const j5 = cyl(0.08 * S, 0.2 * S, MAT.joint); j5.rotation.x = Math.PI / 2; this.wrist.add(j5);
    this.tool = new THREE.Group(); this.wrist.add(this.tool);
    this.buildTool(tool);
    this.tip = new THREE.Object3D(); this.tip.position.y = this.toolLen; this.tool.add(this.tip);
    this.cur = new THREE.Vector3(); this.goal = new THREE.Vector3(); this.inited = false;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  buildTool(kind) {
    const t = this.tool;
    if (kind === 'spot') {
      // 서보 스폿건 (C형 프레임)
      t.add(box(0.16, 0.18, 0.16, MAT.joint, 0, 0.09, 0), box(0.12, 0.42, 0.08, MAT.orange, 0.16, 0.32, 0));
      t.add(box(0.3, 0.07, 0.08, MAT.orange, 0.06, 0.52, 0), box(0.3, 0.07, 0.08, MAT.orange, 0.06, 0.12, 0));
      t.add(cyl(0.022, 0.12, MAT.steel, -0.08, 0.5, 0), cyl(0.022, 0.12, MAT.steel, -0.08, 0.16, 0));
    } else if (kind === 'handling') {
      // 대형 판넬 진공 그리퍼 프레임
      t.add(cyl(0.06, 0.2, MAT.joint, 0, 0.1, 0), box(0.9, 0.05, 0.06, MAT.steel, 0, 0.24, 0), box(0.06, 0.05, 0.5, MAT.steel, 0, 0.24, 0));
      for (const [x, z] of [[-0.42, 0], [0.42, 0], [0, -0.23], [0, 0.23]]) t.add(cyl(0.045, 0.08, MAT.black, x, 0.3, z, 12));
    } else if (kind === 'sealer') {
      t.add(cyl(0.07, 0.16, MAT.joint, 0, 0.08, 0), cyl(0.035, 0.16, MAT.steel, 0, 0.22, 0), cyl(0.012, 0.08, MAT.yellow, 0, 0.32, 0, 8));
    } else if (kind === 'nutrunner') {
      t.add(cyl(0.07, 0.26, MAT.joint, 0, 0.13, 0), cyl(0.03, 0.06, MAT.steel, 0, 0.29, 0));
    } else {
      t.add(cyl(0.05, 0.1, MAT.joint, 0, 0.05, 0), box(0.12, 0.05, 0.05, MAT.steel, 0, 0.12, 0));
    }
  }
  // 목표점(월드) — 공구 끝이 아래를 향하게 놓는다
  solve(p) {
    const base = this.g.getWorldPosition(new THREE.Vector3());
    const yawBase = this.g.rotation.y;
    let dx = p.x - base.x, dz = p.z - base.z;
    const c = Math.cos(-yawBase), s = Math.sin(-yawBase);
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;   // 로봇 받침 로컬
    const yaw = Math.atan2(-lz, lx);
    const r = Math.max(0.15, Math.hypot(lx, lz) - this.off);
    const h = p.y + this.toolLen - (base.y + this.shoulderY);
    const L1 = this.L1, L2 = this.L2;
    let D = (r * r + h * h - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    D = Math.max(-1, Math.min(1, D));
    const q3 = Math.acos(D);
    const th2 = Math.atan2(h, r) + Math.atan2(L2 * Math.sin(q3), L1 + L2 * Math.cos(q3));
    this.turret.rotation.y = yaw;
    this.shoulder.rotation.z = th2 - Math.PI / 2;
    this.elbow.rotation.z = -q3;
    this.wrist.rotation.z = -Math.PI / 2 - th2 + q3;   // 공구(+y)가 아래(−y)를 향하게
  }
  setGoal(p, snap = false) {
    this.goal.copy(p);
    if (snap || !this.inited) { this.cur.copy(p); this.inited = true; }
  }
  update(dt, speed = 1) {
    const k = Math.min(1, dt * 5 * speed);
    this.cur.lerp(this.goal, k);
    this.solve(this.cur);
  }
  tipWorld() { return this.tip.getWorldPosition(new THREE.Vector3()); }
}

// ── 작업물 (후드·도어 판넬) ────────────────────────
function hoodGeometry(sz) {
  const [w, , d] = sz;
  const g = new THREE.BoxGeometry(w, 0.025, d, 24, 1, 10);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // 앞쪽이 낮게 떨어지는 후드 곡면 + 가로 방향 볼록
    pos.setY(i, pos.getY(i) + 0.09 * (1 - (2 * x / w) ** 2) + 0.05 * (z / d));
  }
  g.computeVertexNormals();
  return g;
}
function doorGeometry(sz) {
  const [w, , d] = sz;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -d / 2); s.lineTo(w / 2, -d / 2); s.lineTo(w / 2, d / 2); s.lineTo(-w / 2 + 0.18, d / 2); s.lineTo(-w / 2, d / 2 - 0.25); s.lineTo(-w / 2, -d / 2);
  const hole = new THREE.Path();
  hole.moveTo(-w / 2 + 0.16, d / 2 - 0.3); hole.lineTo(w / 2 - 0.1, d / 2 - 0.08); hole.lineTo(w / 2 - 0.1, 0.02); hole.lineTo(-w / 2 + 0.16, 0.02); hole.lineTo(-w / 2 + 0.16, d / 2 - 0.3);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, 0, 0);
  return g;
}
const GEO = {};
function partMesh(product) {
  const P = PRODUCTS[product];
  const key = family(product);
  GEO[key] ??= key === 'HOOD' ? hoodGeometry(P.size) : doorGeometry(P.size);
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO[key], MAT.panel); body.castShadow = true; g.add(body);
  if (product === 'DOOR_RH') g.scale.z = -1;
  const [w, , d] = P.size;
  // 제품 표시 띠
  g.add(box(0.06, 0.03, d * 0.9, M(P.color, { emissive: P.color, emissiveIntensity: 0.25 }), -w / 2 + 0.05, 0.03, 0));
  // 진행 표시: 용접점 · 실러 비드 · 헤밍 테두리 · 검사 태그
  const welds = new THREE.Group(); welds.visible = false; g.add(welds);
  const nW = key === 'HOOD' ? 14 : 10;
  for (let i = 0; i < nW; i++) {
    const t = i / (nW - 1), side = i % 2 ? 1 : -1;
    const sp = cyl(0.025, 0.012, MAT.weld, -w / 2 + 0.15 + t * (w - 0.3), key === 'HOOD' ? 0.12 : 0.04, side * (d / 2 - 0.06), 10);
    welds.add(sp);
  }
  const beadPts = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    beadPts.push(new THREE.Vector3(Math.cos(a) * (w / 2 - 0.08) * Math.min(1, 1.3 * Math.abs(Math.cos(a)) ** 0.2), key === 'HOOD' ? 0.11 : 0.045, Math.sin(a) * (d / 2 - 0.08)));
  }
  const bead = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(beadPts, true), 60, 0.012, 6, true), MAT.sealer);
  bead.visible = false; g.add(bead);
  const hem = rectOutline(-w / 2, -d / 2, w / 2, d / 2, 0x6b7785, key === 'HOOD' ? 0.07 : 0.04);
  hem.visible = false; g.add(hem);
  const tag = box(0.16, 0.04, 0.1, MAT.green, w / 2 - 0.15, key === 'HOOD' ? 0.12 : 0.05, 0); tag.visible = false; g.add(tag);
  g.userData = { welds, bead, hem, tag, product };
  return g;
}
const STEP_MARK = { C03: 'welds', C04: 'bead', C05: 'hem' };
function markProgress(part, job) {
  if (!part || !job) return;
  const done = new Set(job.route.slice(0, job.step));
  const u = part.userData;
  u.welds.visible = done.has('C03');
  u.bead.visible = done.has('C04');
  u.hem.visible = done.has('C05');
  u.tag.visible = !!job.inspected;
  u.tag.material = job.ng ? MAT.red : job.scrap ? MAT.red : MAT.green;
}

// ── AMR (KMP 1500P급 전방향) · 레거시 대차 ──────────────
function amrMesh(id) {
  const g = new THREE.Group();
  const L = AMR_SPEC.len, W = AMR_SPEC.wid;
  g.add(box(L, 0.32, W, M(0xd5dbe2, { roughness: 0.5 }), 0, 0.26, 0), box(L + 0.04, 0.08, W + 0.04, MAT.black, 0, 0.1, 0));
  g.add(box(L * 0.98, 0.04, 0.05, MAT.orange, 0, 0.36, W / 2), box(L * 0.98, 0.04, 0.05, MAT.orange, 0, 0.36, -W / 2));
  for (const [x, z] of [[L / 2 - 0.08, W / 2 - 0.08], [-L / 2 + 0.08, -W / 2 + 0.08]]) g.add(cyl(0.06, 0.08, MAT.black, x, 0.46, z, 12));   // 안전 스캐너
  const led = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.03, W * 0.7), new THREE.MeshStandardMaterial({ color: 0x37a0ff, emissive: 0x37a0ff, emissiveIntensity: 1.4 }));
  led.position.y = 0.43; g.add(led);
  // 지그 (12세트)
  for (const [x, z] of [[-0.7, -0.42], [0.7, -0.42], [-0.7, 0.42], [0.7, 0.42]]) g.add(box(0.07, 0.45, 0.07, MAT.dark, x, 0.66, z));
  g.add(box(1.55, 0.05, 0.08, MAT.dark, 0, 0.88, -0.42), box(1.55, 0.05, 0.08, MAT.dark, 0, 0.88, 0.42));
  const lab = label(id, 'lbl amr'); lab.position.set(0, 1.55, 0); g.add(lab);
  // 배터리 막대
  const bat = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.07), new THREE.MeshBasicMaterial({ color: 0x3ddc84, side: THREE.DoubleSide }));
  bat.position.set(0, 0.47, W / 2 + 0.03); g.add(bat);
  g.userData = { led, lab, bat, kind: 'amr', id };
  return g;
}
function cartMesh(id) {
  const g = new THREE.Group();
  g.add(box(1.8, 0.06, 1.0, MAT.blue, 0, 0.55, 0));
  for (const [x, z] of [[-0.8, -0.42], [0.8, -0.42], [-0.8, 0.42], [0.8, 0.42]]) g.add(box(0.05, 0.5, 0.05, MAT.steel, x, 0.3, z), cyl(0.08, 0.05, MAT.black, x, 0.08, z, 10));
  g.add(box(0.05, 0.45, 0.9, MAT.steel, -0.92, 0.95, 0));
  for (const [x, z] of [[-0.6, -0.36], [0.6, -0.36], [-0.6, 0.36], [0.6, 0.36]]) g.add(box(0.05, 0.3, 0.05, MAT.dark, x, 0.72, z));
  const w = workerMesh(); w.position.set(-1.3, 0, 0); w.rotation.y = 0; g.add(w);
  const lab = label(id, 'lbl amr'); lab.position.set(0, 2.0, 0); g.add(lab);
  g.userData = { lab, kind: 'cart', id, worker: w };
  return g;
}
function workerMesh() {
  const g = new THREE.Group();
  g.add(box(0.16, 0.8, 0.14, MAT.pants, 0, 0.4, -0.1), box(0.16, 0.8, 0.14, MAT.pants, 0, 0.4, 0.1));
  g.add(box(0.28, 0.62, 0.46, MAT.vest, 0, 1.12, 0));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), MAT.skin)); g.children[3].position.set(0, 1.58, 0);
  const hel = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.helmet); hel.position.set(0, 1.62, 0); g.add(hel);
  g.add(box(0.1, 0.55, 0.1, MAT.vest, 0.12, 1.1, -0.3), box(0.1, 0.55, 0.1, MAT.vest, 0.12, 1.1, 0.3));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ── 스택 라이트 ──
function stackLight() {
  const g = new THREE.Group();
  g.add(cyl(0.03, 1.6, MAT.dark, 0, 0.8, 0, 8));
  const mk = (c, y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 14), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.05, transparent: true, opacity: 0.9 })); m.position.y = y; g.add(m); return m; };
  g.userData = { r: mk(0xff3b3b, 1.95), y: mk(0xffc23b, 1.82), g: mk(0x3ddc84, 1.69) };
  return g;
}

export class FactoryView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.cells = {}; this.carriers = new Map(); this.parts = new Map(); this.workers = [];
    this.pickables = [];
    this.t = 0;
    this.buildFloor();
    for (const [id, def] of Object.entries(CELLS)) this.buildCell(id, def);
    this.buildDisplay();
    this.sparks = this.makeSparks();
  }

  // ── 바닥·차로·표시 ──
  buildFloor() {
    const r = this.root, B = LAY.bounds;
    r.add(flatRect(80, 50, MAT.floor, 0, -1, 0));
    r.add(flatRect(B.x1 - B.x0, B.z1 - B.z0, MAT.zone, (B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2, 0.005));
    r.add(rectOutline(B.x0, B.z0, B.x1, B.z1, 0x37e8ff, 0.02, 0.5));
    const laneMat = (c, o) => new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: o, roughness: 0.9, emissive: c, emissiveIntensity: 0.08 });
    const wMain = LAY.rightX - LAY.leftX;
    r.add(flatRect(wMain + 1.6, 1.8, laneMat(0x2b6fd6, 0.32), (LAY.leftX + LAY.rightX) / 2, LAY.mainZ, 0.012));
    r.add(flatRect(wMain + 1.6, 1.8, laneMat(0x2fbf71, 0.28), (LAY.leftX + LAY.rightX) / 2, LAY.retZ, 0.012));
    r.add(flatRect(1.8, LAY.retZ - LAY.mainZ + 1.8, laneMat(0xf5c518, 0.3), LAY.rightX, (LAY.mainZ + LAY.retZ) / 2, 0.014));   // 통제 이송 (인터록)
    r.add(flatRect(1.8, LAY.retZ - LAY.mainZ, laneMat(0x2fbf71, 0.22), LAY.leftX, (LAY.mainZ + LAY.retZ) / 2, 0.013));
    r.add(flatRect(13.2, 1.3, laneMat(0x8f8f8f, 0.16), 4.3, LAY.innerZ, 0.011), flatRect(6.4, 1.3, laneMat(0x8f8f8f, 0.16), -9.2, LAY.innerZ, 0.011));
    // 진행 방향 화살표
    const arrowGeo = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.35, -0.3), new THREE.Vector2(0.35, 0), new THREE.Vector2(-0.35, 0.3), new THREE.Vector2(-0.15, 0)]));
    const arrow = (x, z, rot, c) => { const m = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 })); m.rotation.set(-Math.PI / 2, 0, rot); m.position.set(x, 0.02, z); r.add(m); };
    for (let x = LAY.leftX + 2; x < LAY.rightX - 1; x += 3.5) { arrow(x, LAY.mainZ, 0, 0x6aa8ff); arrow(x + 1.75, LAY.retZ, Math.PI, 0x5be38f); }
    arrow(LAY.rightX, -1.0, -Math.PI / 2, 0xffd23b); arrow(LAY.leftX, -1.0, Math.PI / 2, 0x5be38f);
    const lab = (t, x, z, cls = 'lbl floor') => { const l = label(t, cls); l.position.set(x, 0.05, z); r.add(l); };
    lab('부품·재공품 이송 →', -3, LAY.mainZ + 0.55); lab('← 양품 회수·출하 (복귀)', -3, LAY.retZ - 0.55);
    lab('통제 이송 · 인터록', LAY.rightX + 1.9, -1.0); lab('후면 보전·유틸리티 공간', 0, -11.2); lab('보전·비상 접근 공간', 0, 9.6);
    lab('부품 반입 ▶', LAY.bounds.x0 + 1.4, -7, 'lbl floor io'); lab('◀ 완성품 반출', LAY.bounds.x0 + 1.4, 5, 'lbl floor io');
    // AMR 대기 구역 (차로 밖)
    for (const p of PARK) {
      const z = p.row === 'top' ? LAY.dockTopZ : LAY.dockBotZ;
      r.add(rectOutline(p.x - 1.05, z - 0.65, p.x + 1.05, z + 0.65, 0x9aa7b5, 0.03, 0.6));
    }
    lab('AMR 대기', -18.2, LAY.dockTopZ - 1.0); lab('AMR 대기', -18.2, LAY.dockBotZ + 1.0);
    // 기둥
    for (const x of [-30, -10, 10, 30]) for (const z of [-16]) r.add(box(0.6, 7, 0.6, MAT.dark, x, 3.5, z));
    // 뒤쪽 벽
    r.add(box(70, 7, 0.3, M(0x1d232b), 0, 3.5, -17), box(0.3, 7, 34, M(0x1d232b), -35, 3.5, -0.5));
  }

  buildCell(id, def) {
    const g = new THREE.Group(); g.position.set(def.x, 0, def.z); this.root.add(g);
    const top = def.row === 'top', w = def.w, d = LAY.cellD;
    const front = top ? d / 2 : -d / 2;   // 차로 쪽
    const back = -front, sgn = top ? -1 : 1;   // sgn: 셀 안쪽(뒤) 방향 z 부호
    const pad = flatRect(w, d, def.ext ? M(0x2e3a3a, { roughness: 0.85 }) : MAT.pad, 0, 0, 0.015); g.add(pad);
    pad.userData = { pick: 'cell', id }; this.pickables.push(pad);
    const outline = rectOutline(-w / 2, -d / 2, w / 2, d / 2, def.ext ? 0x7fd6c2 : 0x37a0ff, 0.04);
    g.add(outline);
    if (def.ext) {
      // 확장 예비공간: X 표시
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, 0.03, -d / 2), new THREE.Vector3(w / 2, 0.03, d / 2)]), lineMat(0x7fd6c2, 0.35)));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, 0.03, d / 2), new THREE.Vector3(w / 2, 0.03, -d / 2)]), lineMat(0x7fd6c2, 0.35)));
    }
    // 도킹 위치 표시 (D)
    const docks = id === 'C07' || id === 'C09' ? [-1.3, 1.3] : [0];
    for (const dx of docks) {
      const dz = (top ? LAY.dockTopZ : LAY.dockBotZ) - def.z;
      g.add(rectOutline(dx - 1.05, dz - 0.65, dx + 1.05, dz + 0.65, 0xffffff, 0.035, 0.55));
      const l = label('D', 'lbl dockmark'); l.position.set(dx + 1.25, 0.05, dz); g.add(l);
    }
    // 안전 펜스 (로봇 셀): 뒤·양옆, 앞은 라이트 커튼
    if (def.robots.length) {
      const fz0 = back * 0.96, fz1 = front * 0.86;
      const fence = (x0, z0, x1, z1) => {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.8), MAT.fence);
        m.position.set((x0 + x1) / 2, 0.95, (z0 + z1) / 2); m.rotation.y = Math.atan2(-(z1 - z0), x1 - x0); g.add(m);
        for (let k = 0; k <= Math.ceil(len / 1.5); k++) { const t = k / Math.ceil(len / 1.5); g.add(box(0.05, 1.9, 0.05, MAT.post, x0 + (x1 - x0) * t, 0.95, z0 + (z1 - z0) * t)); }
      };
      fence(-w / 2 + 0.1, fz0, w / 2 - 0.1, fz0); fence(-w / 2 + 0.1, fz0, -w / 2 + 0.1, fz1); fence(w / 2 - 0.1, fz0, w / 2 - 0.1, fz1);
      for (const x of [-1.35, 1.35]) { const p = box(0.06, 1.7, 0.06, MAT.yellow, x, 0.85, front * 0.86); g.add(p); }
    }
    const cell = this.cells[id] = { id, def, g, robots: [], sl: null, labelEl: null, extra: {} };
    const sl = stackLight(); sl.position.set(w / 2 - 0.35, 0, back * 0.8); g.add(sl); cell.sl = sl;
    const lab = label(`${def.no} ${def.label}`, 'lbl cell'); lab.position.set(0, 2.9, back * 0.55); g.add(lab);
    cell.labelEl = lab.element;
    lab.element.addEventListener('click', () => this.onPick?.({ kind: 'cell', id }));
    lab.element.style.pointerEvents = 'auto';
    // 로봇
    const rz = (top ? -6.1 : 4.0) - def.z;   // 로봇 받침 위치 (셀 로컬 z)
    const rx = def.robots.length === 2 ? [-1.7, 1.7] : [0];
    def.robots.forEach((spec, i) => {
      const rb = new Robot(spec, spec.kind);
      rb.g.position.set(rx[i], 0, rz); g.add(rb.g);
      rb.g.rotation.y = top ? -Math.PI / 2 : Math.PI / 2;   // 로봇 정면(+x)을 차로(도킹) 쪽으로
      const rl = label(spec.id, 'lbl robot'); rl.position.set(0, 2.5, 0); rb.g.add(rl);
      rb.g.traverse((o) => { if (o.isMesh) { o.userData = { pick: 'robot', id: spec.id, cell: id }; this.pickables.push(o); } });
      cell.robots.push(rb);
    });
    this.buildEquip(cell, sgn);
  }

  buildEquip(cell, sgn) {
    const { id, g, def } = cell, w = def.w, E = cell.extra;
    const zb = (k) => sgn * k;   // 셀 중심에서 뒤쪽으로 k m
    if (id === 'C01') {
      for (const x of [-1.9, 1.9]) {
        const rack = new THREE.Group(); rack.position.set(x, 0, zb(1.6)); g.add(rack);
        rack.add(box(1.7, 0.06, 1.0, MAT.dark, 0, 0.5, 0), box(1.7, 0.06, 1.0, MAT.dark, 0, 1.05, 0));
        for (const [px, pz] of [[-0.82, -0.47], [0.82, -0.47], [-0.82, 0.47], [0.82, 0.47]]) rack.add(box(0.05, 1.3, 0.05, MAT.blue, px, 0.65, pz));
        for (let k = 0; k < 5; k++) rack.add(box(1.5, 0.02, 0.6, MAT.panel, 0, 0.55 + k * 0.03, 0), box(1.5, 0.02, 0.6, MAT.panel, 0, 1.1 + k * 0.03, 0));
      }
      E.pick = [new THREE.Vector3(-1.9, 1.2, zb(1.6)), new THREE.Vector3(1.9, 1.2, zb(1.6))];
      // ID 인식 포털
      g.add(box(0.08, 1.6, 0.08, MAT.steel, -1.2, 0.8, zb(-1.5)), box(0.08, 1.6, 0.08, MAT.steel, 1.2, 0.8, zb(-1.5)), box(2.5, 0.1, 0.12, MAT.steel, 0, 1.6, zb(-1.5)));
      E.scanner = box(0.2, 0.08, 0.15, new THREE.MeshStandardMaterial({ color: 0xff2d55, emissive: 0xff2d55, emissiveIntensity: 0.6 }), 0, 1.5, zb(-1.5)); g.add(E.scanner);
    }
    if (id === 'C02') {
      g.add(box(0.12, 2.2, 0.12, MAT.steel, -1.8, 1.1, zb(-0.9)), box(1.0, 0.08, 0.1, MAT.steel, -1.35, 2.2, zb(-0.9)));
      g.add(box(0.28, 0.16, 0.18, MAT.black, -0.9, 2.1, zb(-0.9)));   // 3D 비전
      E.cam = new THREE.Vector3(-0.9, 2.05, zb(-0.9));
      g.add(box(1.8, 0.75, 0.9, MAT.dark, 0, 0.375, zb(1.7)), box(1.7, 0.05, 0.8, MAT.steel, 0, 0.78, zb(1.7)));   // 지그 보관대
      E.pick = [new THREE.Vector3(0, 1.0, zb(1.7))];
    }
    if (id === 'C03') {
      g.add(box(1.0, 0.9, 0.7, MAT.dark, 0, 0.45, zb(2.0)), box(0.3, 0.2, 0.3, MAT.orange, 0, 1.0, zb(2.0)));   // 팁 드레서·용접 타이머
      E.dresser = new THREE.Vector3(0, 1.15, zb(2.0));
      for (const x of [-2.4, 2.4]) g.add(box(0.5, 1.6, 0.6, M(0x4a5560), x, 0.8, zb(2.0)));   // 용접 컨트롤러
    }
    if (id === 'C04') {
      g.add(cyl(0.32, 0.9, MAT.yellow, -1.9, 0.45, zb(1.9)), box(0.5, 1.2, 0.5, MAT.dark, -1.2, 0.6, zb(1.9)));   // 실러 드럼·펌프
      g.add(box(2.6, 0.35, 1.4, M(0x59636e), 0, 3.0, zb(0.3)), box(0.2, 0.9, 0.2, M(0x59636e), 0, 3.6, zb(0.3)));   // 배기 후드
      const l = label('배기', 'lbl tiny'); l.position.set(0, 3.4, zb(0.3)); g.add(l);
    }
    if (id === 'C05') {
      const pr = new THREE.Group(); pr.position.set(0, 0, zb(1.75)); g.add(pr);
      pr.add(box(2.6, 0.9, 1.4, MAT.dark, 0, 0.45, 0), box(2.3, 0.08, 1.1, MAT.steel, 0, 0.94, 0));
      for (const x of [-1.2, 1.2]) pr.add(box(0.25, 2.6, 0.3, MAT.blue, x, 1.3, 0));
      pr.add(box(2.7, 0.35, 0.5, MAT.blue, 0, 2.6, 0));
      E.platen = box(2.2, 0.2, 1.0, MAT.steel, 0, 2.2, 0); pr.add(E.platen);
      E.press = new THREE.Vector3(0, 1.05, zb(1.75));
    }
    if (id === 'C06') {
      for (const x of [-1.8, 1.8]) g.add(box(0.18, 2.5, 0.18, MAT.steel, x, 1.25, zb(-0.4)));
      g.add(box(3.8, 0.16, 0.2, MAT.steel, 0, 2.5, zb(-0.4)));
      for (const x of [-1.8, 1.8]) g.add(box(0.14, 0.12, 2.6, MAT.steel, x, 2.45, zb(-1.7)));
      E.gantry = new THREE.Group(); E.gantry.position.set(0, 2.35, zb(-2.95)); g.add(E.gantry);
      E.gantry.add(box(0.18, 0.1, 3.4, MAT.dark, 0, 0, 0));
      for (const z of [-0.6, 0.6]) E.gantry.add(box(0.2, 0.18, 0.16, MAT.black, 0, -0.12, z));
      E.beam = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.5), new THREE.MeshBasicMaterial({ color: 0x37e8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      E.beam.rotation.x = 0; E.beam.position.set(0, -0.85, 0); E.beam.scale.set(1, 1, 1); E.gantry.add(E.beam);
      g.add(box(0.7, 1.1, 0.5, MAT.dark, 2.4, 0.55, zb(1.6)), box(0.6, 0.4, 0.05, new THREE.MeshStandardMaterial({ color: 0x37a0ff, emissive: 0x1d5ea8 }), 2.4, 1.3, zb(1.33)));   // 판정 PC
    }
    if (id === 'C07') {
      g.add(box(2.4, 0.85, 0.9, MAT.dark, 0, 0.425, zb(1.55)), box(2.3, 0.05, 0.8, MAT.steel, 0, 0.87, zb(1.55)));
      const iso = new THREE.Group(); iso.position.set(-2.0, 0, zb(1.65)); g.add(iso);
      for (const [px, pz] of [[-0.5, -0.35], [0.5, -0.35], [-0.5, 0.35], [0.5, 0.35]]) iso.add(box(0.05, 1.5, 0.05, MAT.red, px, 0.75, pz));
      iso.add(box(1.05, 0.04, 0.75, MAT.red, 0, 0.6, 0), box(1.05, 0.04, 0.75, MAT.red, 0, 1.2, 0));
      E.isoStack = []; for (let k = 0; k < 6; k++) { const p = box(0.9, 0.02, 0.5, MAT.panel, 0, 0.64 + k * 0.03, 0); p.visible = false; iso.add(p); E.isoStack.push(p); }
      const l = label('격리', 'lbl tiny warn'); l.position.set(-2.0, 1.8, zb(1.65)); g.add(l);
      E.worker = workerMesh(); E.worker.position.set(0.4, 0, zb(0.95)); E.worker.rotation.y = sgn > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(E.worker);
      E.cobot = new Robot({ id: 'RW-01', kind: 'cobot' }, 'cobot'); E.cobot.g.position.set(1.1, 0.87, zb(1.55)); E.cobot.g.rotation.y = -Math.PI / 2; g.add(E.cobot.g);
      cell.robots.push(E.cobot);
    }
    if (id === 'C08') {
      E.fifo = [];
      for (const x of [-1.5, 1.5]) {
        const rack = new THREE.Group(); rack.position.set(x, 0, zb(1.7)); g.add(rack);
        for (const [px, pz] of [[-0.9, -0.5], [0.9, -0.5], [-0.9, 0.5], [0.9, 0.5]]) rack.add(box(0.06, 2.1, 0.06, MAT.green, px, 1.05, pz));
        for (let k = 0; k < 4; k++) rack.add(box(1.9, 0.04, 1.05, MAT.dark, 0, 0.35 + k * 0.5, 0));
        const stack = []; for (let k = 0; k < 8; k++) { const p = box(1.6, 0.025, 0.55, MAT.panel, 0, 0.4 + Math.floor(k / 2) * 0.5 + (k % 2) * 0.05, 0); p.visible = false; rack.add(p); stack.push(p); }
        E.fifo.push(stack);
      }
      const l = label('양품 FIFO 2', 'lbl tiny'); l.position.set(0, 2.4, zb(1.7)); g.add(l);
      E.lift = box(1.6, 0.05, 0.6, MAT.yellow, 0, 0.95, zb(-1.0)); E.lift.visible = false; g.add(E.lift);
    }
    if (id === 'C09') {
      E.chg = [];
      for (const x of [-1.3, 1.3]) {
        g.add(box(0.5, 1.4, 0.35, MAT.dark, x, 0.7, zb(1.75)));
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshStandardMaterial({ color: 0x37a0ff, emissive: 0x37a0ff, emissiveIntensity: 0.3 }));
        s.position.set(x, 1.1, zb(1.75) - sgn * 0.18); s.rotation.y = sgn > 0 ? Math.PI : 0; g.add(s); E.chg.push(s);
      }
      const l = label('분리형 충전', 'lbl tiny'); l.position.set(0, 1.9, zb(1.75)); g.add(l);
    }
    if (id === 'C10') {
      g.add(box(1.4, 0.9, 0.8, MAT.dark, 0, 0.45, zb(1.9)));
      for (let k = 0; k < 4; k++) g.add(box(0.28, 0.12, 0.2, MAT.orange, -0.45 + k * 0.3, 0.96, zb(1.9)));   // 힌지·스트라이커 부품
      E.pick = [new THREE.Vector3(0, 1.1, zb(1.9))];
      const l = label('확장 (A-1-2 연계) · 도어 전용', 'lbl tiny ext'); l.position.set(0, 2.6, zb(1.9)); g.add(l);
    }
  }

  // 뒤쪽 벽 DT 관제 디스플레이
  buildDisplay() {
    const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 500;
    this.dispCtx = cv.getContext('2d');
    this.dispTex = new THREE.CanvasTexture(cv); this.dispTex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(19.2, 6), new THREE.MeshBasicMaterial({ map: this.dispTex }));
    m.position.set(0, 3.9, -16.8); this.root.add(m);
    this.root.add(box(19.6, 6.4, 0.2, MAT.black, 0, 3.9, -16.95));
  }
  drawDisplay(sim) {
    const c = this.dispCtx, W = 1600, H = 500, k = sim.kpis();
    c.fillStyle = '#0b1220'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#7ff3ff'; c.font = 'bold 34px sans-serif'; c.fillText('A-1 유연생산 Zone · Cell OCS 디지털트윈', 30, 52);
    c.fillStyle = '#a9b4c0'; c.font = '24px sans-serif'; c.fillText(`${sim.mode.label}  ·  ${sim.snapshot().clock}`, 30, 88);
    const kp = [['양품', k.good, ''], ['UPH', k.uph.toFixed(1), ''], ['OEE', k.oee.toFixed(1), '%'], ['직행률', k.fpy.toFixed(1), '%'], ['연계 성공률', sim.modeKey === 'legacy' ? '—' : k.linkRate.toFixed(1), sim.modeKey === 'legacy' ? '' : '%'], ['WIP', k.wip, '']];
    kp.forEach(([n, v, u], i) => {
      const x = 30 + i * 255;
      c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x, 110, 240, 110);
      c.fillStyle = '#a9b4c0'; c.font = '22px sans-serif'; c.fillText(n, x + 14, 144);
      c.fillStyle = '#ffffff'; c.font = 'bold 46px sans-serif'; c.fillText(`${v}${u}`, x + 14, 200);
    });
    const ids = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C10', 'C08', 'C09'];
    ids.forEach((id, i) => {
      const st = sim.stations[id], x = 30 + (i % 5) * 310, y = 245 + Math.floor(i / 5) * 120;
      const S = CELL_STATES[st.state] ?? CELL_STATES.IDLE;
      c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(x, y, 295, 105);
      c.fillStyle = S.color; c.fillRect(x, y, 8, 105);
      c.fillStyle = '#fff'; c.font = 'bold 26px sans-serif'; c.fillText(`${id} ${CELLS[id].label}`, x + 20, y + 34);
      c.fillStyle = S.color; c.font = '22px sans-serif'; c.fillText(S.label, x + 20, y + 66);
      c.fillStyle = '#a9b4c0'; c.font = '20px sans-serif'; c.fillText((st.cur?.label ?? '').slice(0, 14), x + 20, y + 94);
      const job = st.carrier?.job;
      if (job) { c.fillStyle = PRODUCTS[job.product].css; c.fillText(PRODUCTS[job.product].short, x + 215, y + 66); }
    });
    this.dispTex.needsUpdate = true;
  }

  makeSparks() {
    const n = 160, geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd27a, size: 0.06, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.root.add(pts);
    return { pts, n, v: Array.from({ length: n }, () => ({ p: new THREE.Vector3(0, -10, 0), v: new THREE.Vector3(), life: 0 })), i: 0 };
  }
  emitSparks(p, count = 6) {
    const S = this.sparks;
    for (let k = 0; k < count; k++) {
      const s = S.v[S.i++ % S.n];
      s.p.copy(p); s.v.set((Math.random() - 0.5) * 2.4, Math.random() * 2.2, (Math.random() - 0.5) * 2.4); s.life = 0.35 + Math.random() * 0.3;
    }
  }
  updateSparks(dt) {
    const S = this.sparks, arr = S.pts.geometry.attributes.position.array;
    S.v.forEach((s, i) => {
      if (s.life > 0) { s.life -= dt; s.v.y -= 9 * dt; s.p.addScaledVector(s.v, dt); if (s.p.y < 0.02) { s.p.y = 0.02; s.v.y *= -0.3; } }
      else s.p.y = -10;
      arr[i * 3] = s.p.x; arr[i * 3 + 1] = s.p.y; arr[i * 3 + 2] = s.p.z;
    });
    S.pts.geometry.attributes.position.needsUpdate = true;
  }

  // ── 매 프레임 ──
  reset() {
    for (const [, m] of this.carriers) this.root.remove(m);
    this.carriers.clear(); this.parts.clear();
  }
  carrierMesh(c) {
    let m = this.carriers.get(c.id);
    if (!m) {
      m = c.kind === 'amr' ? amrMesh(c.id) : cartMesh(c.id);
      m.traverse((o) => { if (o.isMesh) { o.userData.pick = 'amr'; o.userData.id = c.id; this.pickables.push(o); } });
      m.userData.lab.element.style.pointerEvents = 'auto';
      m.userData.lab.element.addEventListener('click', () => this.onPick?.({ kind: 'amr', id: c.id }));
      this.root.add(m); this.carriers.set(c.id, m);
    }
    return m;
  }
  update(sim, dt, rdt) {
    this.t += rdt;
    const flash = Math.sin(this.t * 8) > 0;
    // 이동체 + 작업물
    const seen = new Set();
    for (const c of sim.carriers) {
      const m = this.carrierMesh(c); seen.add(c.id);
      m.position.set(c.x, 0, c.z); m.rotation.y = c.yaw;
      const u = m.userData;
      if (u.led) {
        const col = sim.estop ? 0xff2d55 : c.state === 'charge' ? 0x3ddc84 : c.blockedT > 2 || c.waitT > 0 && c.speed === 0 && c.pts ? 0xf5b82e : c.job ? 0x37a0ff : 0x9aa7b5;
        u.led.material.color.setHex(col); u.led.material.emissive.setHex(col);
        u.bat.scale.x = Math.max(0.02, c.battery / 100); u.bat.position.x = -0.4 * (1 - c.battery / 100);
        u.bat.material.color.setHex(c.battery < 30 ? 0xff5a5a : c.battery < 55 ? 0xf5b82e : 0x3ddc84);
      }
      u.lab.element.textContent = c.job ? `${c.id} · ${PRODUCTS[c.job.product].short}` : c.id;
      u.lab.element.classList.toggle('sel', this.selected === c.id);
      // 작업물
      let part = this.parts.get(c.id);
      if (c.job) {
        if (!part || part.userData.jobId !== c.job.id) {
          if (part) m.remove(part);
          part = partMesh(c.job.product); part.userData.jobId = c.job.id;
          part.position.y = c.kind === 'amr' ? 0.92 : 0.6;
          m.add(part); this.parts.set(c.id, part);
        }
        markProgress(part, c.job);
        part.visible = !c.hidePart;
      } else if (part) { m.remove(part); this.parts.delete(c.id); }
    }
    // 셀
    for (const [id, cell] of Object.entries(this.cells)) {
      const st = sim.stations[id];
      const state = sim.estop ? 'SAFE_STOP' : st.state;
      const S = CELL_STATES[state] ?? CELL_STATES.IDLE;
      const L = cell.sl.userData;
      L.g.material.emissiveIntensity = ['RUN', 'DONE', 'READY'].includes(state) ? 1.6 : 0.05;
      L.y.material.emissiveIntensity = ['HOLD', 'RECOVER', 'CHANGE'].includes(state) ? (flash ? 1.8 : 0.4) : 0.05;
      L.r.material.emissiveIntensity = ['DOWN', 'SAFE_STOP'].includes(state) ? (flash ? 2 : 0.3) : 0.05;
      const job = st.carrier?.job;
      cell.labelEl.innerHTML = `<b>${cell.def.no}</b> ${cell.def.label} <i style="color:${S.color}">${S.label}</i>${job && st.plan ? `<small>${PRODUCTS[job.product].short} · ${st.cur?.label ?? ''}</small>` : ''}`;
      cell.labelEl.classList.toggle('sel', this.selected === id);
      this.animateCell(sim, id, cell, st, rdt, dt);
    }
    // 레거시·자동화 현장 인원 표시 (C07 재작업은 사람 / 피지컬AI는 협동로봇)
    const C07 = this.cells.C07.extra;
    C07.worker.visible = sim.modeKey !== 'dark'; C07.cobot.g.visible = sim.modeKey === 'dark';
    this.updateSparks(rdt);
    if ((this.dispT = (this.dispT ?? 0) + rdt) > 0.5) { this.dispT = 0; this.drawDisplay(sim); }
  }

  // 셀별 작업 동작 (로봇 목표점 · 설비)
  animateCell(sim, id, cell, st, rdt, dt) {
    const g = cell.g, E = cell.extra, top = cell.def.row === 'top';
    const c = st.carrier, job = c?.job;
    const run = !!st.plan && !sim.estop && !sim.paused;
    const ph = st.phase, prog = st.phaseDur > 0 ? Math.min(1, st.phaseT / st.phaseDur) : 0;
    const dockZ = (top ? LAY.dockTopZ : LAY.dockBotZ);
    const partY = c?.kind === 'cart' ? 0.65 : 1.0;
    const world = (lx, y, lz) => new THREE.Vector3(cell.def.x + lx, y, cell.def.z + lz);
    const onPart = (u, v, h = 0.08) => {   // 판넬 위 점 (u: −1~1 길이, v: −1~1 폭)
      const P = job ? PRODUCTS[job.product] : PRODUCTS.HOOD;
      const cx = c ? c.x : cell.def.x, cz = c ? c.z : dockZ;
      return new THREE.Vector3(cx + u * P.size[0] / 2 * 0.9, partY + h + (family(job?.product ?? 'HOOD') === 'HOOD' ? 0.09 * (1 - u * u) : 0), cz + v * P.size[2] / 2 * 0.85);
    };
    const home = (rb) => { const p = rb.g.getWorldPosition(new THREE.Vector3()); const sgn = top ? 1 : -1; return new THREE.Vector3(p.x, 1.6, p.z + sgn * 0.9); };
    const speedK = Math.max(1, Math.min(6, sim.speedMul ?? 1));
    if (c) c.hidePart = false;
    const tPh = st.phaseT ?? 0;
    for (const [i, rb] of cell.robots.entries()) {
      if (rb === E.cobot && sim.modeKey !== 'dark') continue;
      let goal = home(rb);
      if (run && ph === 'work' && job) {
        const cyc = (k) => (tPh / k) % 1;
        if (id === 'C01') {
          // 부품 랙에서 INR·OTR·SUB 부품을 집어 지그 위에 놓는다
          const s = cyc(9), n = Math.floor(tPh / 9), lp = E.pick[n % 2], src = world(lp.x, lp.y, lp.z), dst = onPart((n % 3) - 1, 0, 0.06);
          goal = s < 0.4 ? home(rb).lerp(src, s / 0.4) : s < 0.5 ? src : s < 0.9 ? src.clone().lerp(dst, (s - 0.5) / 0.4) : dst;
          E.scanner.material.emissiveIntensity = 0.3 + (Math.sin(this.t * 10) > 0 ? 1 : 0);
        } else if (id === 'C02') {
          const s = cyc(7);
          goal = s < 0.5 ? onPart(-0.8 + 1.6 * (s / 0.5), Math.sin(s * 12) * 0.5, 0.35) : onPart(0.6 - 1.2 * (s - 0.5) / 0.5, 0, 0.06);
        } else if (id === 'C03') {
          const s = cyc(2.6), k = Math.floor(tPh / 2.6) % 7, side = i === 0 ? -1 : 1;
          const u = side * (0.12 + 0.12 * k), v = (k % 2 ? 1 : -1) * 0.92;
          goal = onPart(u, v, s < 0.35 ? 0.25 : 0.02);
          if (s > 0.4 && s < 0.7 && !sim.paused) this.emitSparks(onPart(u, v, 0.02), Math.ceil(3 * Math.min(2, rdt * 60)));
        } else if (id === 'C04') {
          const a = (tPh / 16) * Math.PI * 2;
          goal = onPart(Math.cos(a) * 0.97, Math.sin(a) * 0.97, 0.04);
        } else if (id === 'C05') {
          const s = Math.min(1, tPh / Math.max(1, st.phaseDur));
          const lastWork = st.cur?.last;
          // 앞 작업: 판넬을 프레스로 옮김 / 뒤 작업: 프레스에서 AMR로 돌려놓음
          const press = world(0, 1.25, (top ? -1 : 1) * 1.75).add(new THREE.Vector3(0, 0, 0));
          goal = !lastWork ? (s < 0.5 ? onPart(0, 0, 0.06).lerp(press, s * 2) : press) : (s < 0.5 ? press : press.clone().lerp(onPart(0, 0, 0.06), (s - 0.5) * 2));
          E.platen.position.y = !lastWork && s > 0.55 ? 2.2 - 1.0 * Math.sin(Math.min(1, (s - 0.55) / 0.45) * Math.PI) : 2.2;
          if (c) c.hidePart = !lastWork ? s > 0.5 : s < 0.5;
        } else if (id === 'C10') {
          const s = cyc(8);
          const src = world(E.pick[0].x, E.pick[0].y, E.pick[0].z);
          goal = i === 0 ? (s < 0.5 ? home(rb).lerp(src, s * 2) : src.clone().lerp(onPart(-0.6, 0.6, 0.05), (s - 0.5) * 2))
            : onPart(0.3 + 0.2 * Math.floor(tPh / 3 % 3), -0.5 + 0.5 * Math.floor(tPh / 9 % 3), (tPh % 3) < 1 ? 0.25 : 0.03);
        } else if (rb === E.cobot) {
          goal = onPart(Math.sin(tPh * 0.7) * 0.6, Math.cos(tPh * 0.5) * 0.6, 0.04);
        }
      } else if (run && ph === 'recover' && job) {
        goal = onPart(Math.sin(this.t * 2) * 0.3, 0.3, 0.3);   // 재측정·보정 동작
      } else if (run && (ph === 'change' || ph === 'dress')) {
        const p = rb.g.getWorldPosition(new THREE.Vector3());
        goal = ph === 'dress' && E.dresser ? world(E.dresser.x + (i ? 0.25 : -0.25), E.dresser.y, E.dresser.z) : new THREE.Vector3(p.x + (i ? 1 : -1) * 1.3, 1.0, p.z - (top ? 0.6 : -0.6));
      } else if (run && ph === 'handoff' && job) {
        goal = onPart(0, 0, 0.6);
      }
      rb.setGoal(goal);
      rb.update(rdt, ph === 'down' || sim.estop ? 0 : speedK);
    }
    if (id === 'C06') {
      const s = run && ph === 'work' ? (tPh / Math.max(1, st.phaseDur)) : 0.5;
      E.gantry.position.x = -1.5 + 3.0 * ((s * 2) % 1);
      E.beam.visible = run && ph === 'work';
    }
    if (id === 'C08') {
      const n = sim.stations.C08.done;
      E.fifo.forEach((stack, r) => stack.forEach((p, k) => { p.visible = k < ((Math.floor(n / 2) + (r ? 0 : n % 2)) % 9); }));
      E.lift.visible = run && ph === 'work';
      if (run && ph === 'work' && c) { c.hidePart = st.cur?.last; E.lift.position.y = 0.95 + 0.6 * prog; }
    }
    if (id === 'C07') {
      const n = sim.k.scrap;
      E.isoStack.forEach((p, k) => { p.visible = k < Math.min(6, n); });
      if (E.worker.visible) E.worker.rotation.z = run && ph === 'work' ? Math.sin(this.t * 3) * 0.05 : 0;
    }
    if (id === 'C09') {
      E.chg.forEach((s, k) => { const o = sim.L.slots.C09[k].occupant; s.material.emissiveIntensity = o?.state === 'charge' ? 0.6 + 0.6 * Math.abs(Math.sin(this.t * 3)) : 0.15; });
    }
  }
}
