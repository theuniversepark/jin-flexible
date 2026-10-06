// 브라우저용 실행: npm start → http://localhost:8770
// 정밀조립 Zone(jin-3d, MQTT 1883)과 함께 켤 수 있게 기본 MQTT 포트는 1884
process.env.MQTT_PORT ||= '1884';
const { startServer } = await import('./server/app-server.mjs');
const { mqttStatus } = await import('./server/mqtt-gateway.mjs');
const { port } = await startServer({ port: Number(process.env.PORT) || 8770, host: process.env.HOST || '127.0.0.1' });
console.log(`Jin-FMS (A-1 유연생산 Zone) → http://localhost:${port}`);
const mq = mqttStatus();
console.log(mq.listening ? `MQTT 브로커 → mqtt://${mq.host}:${mq.port} (OPC UA PubSub JSON: opcua/json/#)` : `MQTT 브로커 시작 실패: ${mq.error}`);
