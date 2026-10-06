// 데이터 연동 — 기준 시계 · AAS(IDTA Part 1 메타모델 v3.0 JSON) · OPC UA PubSub JSON(Part 14) · 파일 내보내기 · MQTT 발행
// 셀 운영통제 계층 보완안 ④ "에피소드 단위 실증 데이터 환류": 작업 1건 = 에피소드, 공통 ID(order·job·episode·asset·recipe)
import { CELLS, PRODUCTS, ZONE, MODES, CELL_STATES } from './zone.js';
import { fmtClock } from './sim.js';

export const PUBLISHER = 'camtic/MetaFactory/A1-FMS';
const URN = (id) => `urn:camtic:metafactory:A-1:${id}`;
const SEM = {
  nameplate: 'https://admin-shell.io/zvei/nameplate/2/0/Nameplate',
  tech: 'https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2',
  op: 'urn:camtic:fms:submodel:OperationalData:1',
};

export class DataHub {
  constructor() {
    const d = new Date(); d.setHours(8, 0, 0, 0);
    this.t0 = d.getTime();   // 시뮬레이션 0초 = 오늘 08:00 (현지)
    this.msgSeq = 0; this.server = false; this.published = 0; this.lastPub = 0; this.mqtt = null;
  }
  iso(t) { return new Date(this.t0 + t * 1000).toISOString(); }
  async probe() {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const j = await r.json(); this.server = true; this.mqtt = j.mqtt; return j;
    } catch { this.server = false; return null; }
  }
  assets(sim) {
    const out = [];
    for (const [id, st] of Object.entries(sim.stations)) {
      const job = st.carrier?.job;
      out.push({ id, kind: 'cell', name: `${id} ${CELLS[id].label}`, fields: {
        State: ['String', st.state], StateLabel: ['String', CELL_STATES[st.state]?.label ?? st.state], Phase: ['String', st.cur?.label ?? ''],
        JobId: ['String', job?.id ?? ''], Product: ['String', job?.product ?? ''], Recipe: ['String', job ? `${id}-${job.product}-v1` : ''],
        Completed: ['UInt32', st.done], Utilization: ['Double', +((st.busyT * 100) / Math.max(1, sim.t)).toFixed(2), '%'],
        DownTime: ['Double', +st.downT.toFixed(1), 's'], ...(id === 'C03' ? { TipWear: ['Double', +(st.tipWear * 100).toFixed(1), '%'] } : {}),
      } });
      for (const r of st.robots) out.push({ id: r.id, kind: 'robot', name: `${r.id} ${r.label}`, cell: id, fields: { State: ['String', r.state], Cell: ['String', id] } });
    }
    for (const c of sim.carriers) out.push({ id: c.id, kind: c.kind, name: c.id, fields: {
      State: ['String', c.state], JobId: ['String', c.job?.id ?? ''], X: ['Double', +c.x.toFixed(3), 'm'], Z: ['Double', +c.z.toFixed(3), 'm'],
      Speed: ['Double', +c.speed.toFixed(2), 'm/s'], ...(c.kind === 'amr' ? { Battery: ['Double', +c.battery.toFixed(1), '%'] } : {}), Odometer: ['Double', +c.odo.toFixed(1), 'm'],
    } });
    const k = sim.kpis();
    out.push({ id: 'ZONE', kind: 'zone', name: `${ZONE.code} ${ZONE.name}`, fields: {
      Mode: ['String', sim.modeKey], Good: ['UInt32', k.good], UPH: ['Double', +k.uph.toFixed(2)], OEE: ['Double', +k.oee.toFixed(2), '%'],
      FPY: ['Double', +k.fpy.toFixed(2), '%'], LinkSuccess: ['Double', +k.linkRate.toFixed(2), '%'], WIP: ['UInt32', k.wip], Scrap: ['UInt32', k.scrap],
    } });
    return out;
  }
  // OPC UA PubSub JSON NetworkMessage (자산마다 DataSetMessage 1개)
  networkMessages(sim) {
    const ts = this.iso(sim.t);
    return this.assets(sim).map((a, i) => ({
      topic: `opcua/json/data/${PUBLISHER}/${a.id}`,
      payload: JSON.stringify({
        MessageId: `${++this.msgSeq}`, MessageType: 'ua-data', PublisherId: PUBLISHER, WriterGroupName: 'A1-FMS',
        Messages: [{ DataSetWriterId: i + 1, DataSetWriterName: a.id, MessageType: 'ua-keyframe', Timestamp: ts, MetaDataVersion: { MajorVersion: 1, MinorVersion: 0 },
          Payload: Object.fromEntries(Object.entries(a.fields).map(([k, [, v]]) => [k, { Value: v, SourceTimestamp: ts }])) }],
      }),
    }));
  }
  eventMessage(sim, e) {
    return { topic: `opcua/json/data/${PUBLISHER}/Events`, payload: JSON.stringify({
      MessageId: `${++this.msgSeq}`, MessageType: 'ua-data', PublisherId: PUBLISHER,
      Messages: [{ MessageType: 'ua-event', Timestamp: this.iso(e.t), Payload: { EventId: { Value: e.id }, Severity: { Value: { alarm: 800, L2: 600, warn: 500, L1: 400, cmd: 300 }[e.level] ?? 100 }, Level: { Value: e.level }, SourceName: { Value: e.cell ?? 'ZONE' }, Agent: { Value: e.block }, Message: { Value: e.msg }, JobId: { Value: e.job ?? '' } } }],
    }) };
  }
  async publish(sim, events = []) {
    if (!this.server) return 0;
    const msgs = [...this.networkMessages(sim), ...events.map((e) => this.eventMessage(sim, e))];
    try {
      const r = await fetch('/api/mqtt/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs }) });
      const j = await r.json(); this.published += j.published ?? 0; return j.published ?? 0;
    } catch { return 0; }
  }

  // ── AAS 환경 (메타모델 v3.0 JSON) ──
  aasEnvironment(sim) {
    const shells = [], submodels = [];
    const prop = (idShort, valueType, value, unit) => ({ modelType: 'Property', idShort, valueType: `xs:${{ String: 'string', Double: 'double', UInt32: 'unsignedInt' }[valueType] ?? 'string'}`, value: String(value), ...(unit ? { qualifiers: [{ type: 'Unit', valueType: 'xs:string', value: unit }] } : {}) });
    const sm = (aid, idShort, sem, elems) => {
      const id = `${URN(aid)}/sm/${idShort}`;
      submodels.push({ modelType: 'Submodel', id, idShort, semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: sem }] }, submodelElements: elems });
      return { type: 'ModelReference', keys: [{ type: 'Submodel', value: id }] };
    };
    for (const a of this.assets(sim)) {
      const def = CELLS[a.id];
      const tech = a.kind === 'cell' ? [prop('CellNo', 'String', a.id), prop('Step', 'String', String(def.step)), prop('Equipment', 'String', def.equip.join(' · ')), prop('Robots', 'String', def.robots.map((r) => `${r.id}:${r.label}`).join(' · ') || '-'), prop('LegacyOperation', 'String', def.aseq ?? '-')]
        : a.kind === 'amr' ? [prop('Class', 'String', '고하중 전방향 AMR (KMP 1500P급, A-1-3)'), prop('Jig', 'String', '후드·도어 겸용 지그')]
        : a.kind === 'robot' ? [prop('Cell', 'String', a.cell)] : [prop('Code', 'String', ZONE.code), prop('Site', 'String', ZONE.site), prop('Customer', 'String', ZONE.customer)];
      const refs = [
        sm(a.id, 'Nameplate', SEM.nameplate, [prop('ManufacturerName', 'String', 'Jin-FMS 가상 자산'), prop('ManufacturerProductDesignation', 'String', a.name), prop('SerialNumber', 'String', `A1-${a.id}`)]),
        sm(a.id, 'TechnicalData', SEM.tech, tech),
        sm(a.id, 'OperationalData', SEM.op, Object.entries(a.fields).map(([k, [vt, v, u]]) => prop(k, vt, v, u))),
      ];
      shells.push({ modelType: 'AssetAdministrationShell', id: URN(a.id), idShort: a.id.replace(/[^A-Za-z0-9_]/g, '_'), assetInformation: { assetKind: 'Instance', globalAssetId: `${URN(a.id)}:asset` }, submodels: refs });
    }
    return { assetAdministrationShells: shells, submodels, conceptDescriptions: [] };
  }

  // ── 내보내기 ──
  episodesJsonl(sim) {
    return sim.episodes.map((e) => JSON.stringify({ ...e, t0_utc: this.iso(e.t0), t1_utc: e.t1 != null ? this.iso(e.t1) : null, steps: e.steps.map((s) => ({ ...s, t0_utc: this.iso(s.t0), t1_utc: s.t1 != null ? this.iso(s.t1) : null })) })).join('\n');
  }
  eventsCsv(sim) {
    const head = 'utc,sim_s,clock,level,agent,by,cell,job,message';
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [head, ...sim.events.map((e) => [this.iso(e.t), e.t.toFixed(1), fmtClock(e.t), e.level, e.block, q(e.by), e.cell ?? '', e.job ?? '', q(e.msg)].join(','))].join('\n');
  }
  seriesCsv(sim) {
    return ['utc,sim_s,uph,oee,link_success,wip,good', ...sim.series.map((r) => [this.iso(r.t), r.t.toFixed(0), r.uph.toFixed(2), r.oee.toFixed(2), r.link.toFixed(2), r.wip, r.good].join(','))].join('\n');
  }
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const modeName = (k) => MODES[k]?.short ?? k;
export const productName = (p) => PRODUCTS[p]?.short ?? p;
