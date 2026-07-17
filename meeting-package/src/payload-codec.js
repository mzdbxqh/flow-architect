export function decodePayload(encoded) {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * 规范化对象键（排序）
 */
function normalizeKeys(obj) {
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  if (obj === null || typeof obj !== 'object') return obj;
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = normalizeKeys(obj[key]);
  }
  return sorted;
}

/**
 * 计算 V2 业务内容哈希。
 * 覆盖：process_card、activities、diagram、bpmn_xml、questions、provenance、source_summary。
 */
export async function contentHash(bpmnXml, questions, { processCard, activities, diagram, provenance, sourceSummary } = {}) {
  const canonicalQuestions = questions.map(q => ({
    question_id: q.question_id,
    text: q.text,
    target_paths: [...q.target_paths],
    status: q.status,
    answer: q.answer,
  }));

  const business = {
    process_card: normalizeKeys(processCard || null),
    activities: normalizeKeys(activities || []),
    diagram: normalizeKeys(diagram || null),
    bpmn_xml: bpmnXml,
    questions: normalizeKeys(canonicalQuestions),
    provenance: normalizeKeys(provenance || {}),
    source_summary: normalizeKeys(sourceSummary || null),
  };

  const body = JSON.stringify(business);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return `sha256:${[...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}
