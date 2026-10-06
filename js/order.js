// 자연어 생산 지시 해석 (규칙 기반) — "후드 100개 생산", "도어 LH 20 RH 30", "후드 60 도어 40", "혼류 2:1"
// 9/21 오후 미팅의 목표 이미지("L타입→R타입 전환, 당일 100개 생산")와 WP8 V12 "100개 생산" 흐름을 유연생산 Zone에 맞춘 것.
import { MIXES } from './zone.js';

const NUM = '(\\d{1,4})\\s*(?:개|대|ea|EA|pcs)?';
export function parseOrder(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { error: '지시문이 비었습니다.' };
  const out = { items: {}, mix: null, label: t.slice(0, 40) };
  // 혼류 비율만 바꾸는 지시
  const mixM = t.match(/(?:혼류|비율)\s*(?:을|를)?\s*(\d)\s*[:：대]\s*(\d)/);
  if (mixM) out.mix = mixM[1] === mixM[2] ? '1:1' : +mixM[1] > +mixM[2] ? '2:1' : null;
  if (/후드만/.test(t)) out.mix = 'hood';
  if (/도어만/.test(t)) out.mix = 'door';
  const add = (p, n) => { if (n > 0) out.items[p] = (out.items[p] ?? 0) + n; };
  let m;
  if ((m = t.match(new RegExp(`후드\\s*${NUM}`)))) add('HOOD', +m[1]);
  const lh = t.match(new RegExp(`(?:LH|좌|왼쪽|L\\s*타입|L형)\\s*(?:도어)?\\s*${NUM}`, 'i'));
  const rh = t.match(new RegExp(`(?:RH|우|오른쪽|R\\s*타입|R형)\\s*(?:도어)?\\s*${NUM}`, 'i'));
  if (lh) add('DOOR_LH', +lh[1]);
  if (rh) add('DOOR_RH', +rh[1]);
  if (!lh && !rh && (m = t.match(new RegExp(`도어\\s*${NUM}`)))) { const n = +m[1]; add('DOOR_LH', Math.ceil(n / 2)); add('DOOR_RH', Math.floor(n / 2)); }
  // "100개 생산"처럼 제품이 없으면 현재 혼류 비율로
  if (!Object.keys(out.items).length) {
    const q = t.match(new RegExp(`${NUM}\\s*(?:생산|만들|투입)?`));
    if (q && +q[1] > 0) { out.qty = Math.min(2000, +q[1]); delete out.items; }
    else if (!out.mix) return { error: '제품과 수량을 찾지 못했습니다. 예: "후드 100개 생산", "도어 LH 20 RH 20", "혼류 2:1"' };
  }
  const total = out.items ? Object.values(out.items).reduce((a, b) => a + b, 0) : out.qty ?? 0;
  if (total > 2000) return { error: '한 번에 2000개까지 지시할 수 있습니다.' };
  if (out.mix && !MIXES[out.mix]) out.mix = null;
  if (out.items && !Object.keys(out.items).length) delete out.items;
  out.total = total;
  return out;
}
