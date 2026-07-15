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

export async function contentHash(bpmnXml, questions) {
  const body = JSON.stringify({
    bpmn_xml: bpmnXml,
    questions: questions.map(q => ({
      id: q.id, text: q.text, element_ids: [...q.element_ids],
      status: q.status, answer: q.answer,
    })),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return `sha256:${[...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}
