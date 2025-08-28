// src/lib/extract.js
import OpenAI from 'openai';

const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const openai = HAS_OPENAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const CATEGORY_KEYWORDS = [
  { key: 'Appointment/Promotion', words: ['appoint','names','joins','promot','elevat','takes over','assumes charge','elected','reappointed'] },
  { key: 'Resignation/Retirement', words: ['resign','steps down','retires'] },
  { key: 'Award/Recognition', words: ['award','wins award','bags award','felicitat','honoured','honored'] },
];

function guessCategory(title) {
  const t = title.toLowerCase();
  for (const c of CATEGORY_KEYWORDS) {
    if (c.words.some(w => t.includes(w))) return c.key;
  }
  return 'Other';
}

// Heuristic (no regex) — good enough when LLM is off
function heuristicExtract(title) {
  const t = title.replace('–','-').replace('—','-');
  const lower = t.toLowerCase();

  let person = '';
  let role = '';
  let company = '';

  // Very gentle patterns using split/includes (no regex)
  // "X appoints Y as Z at COMPANY"
  if (lower.includes(' appoints ') && lower.includes(' as ')) {
    const parts = t.split(' appoints ');
    const after = parts[1] || '';
    const yAsZ = after.split(' as ');
    const y = yAsZ[0] || '';
    const zPart = yAsZ[1] || '';
    person = y.trim();
    // try to find trailing " at " or " in "
    const atSplit = zPart.includes(' at ') ? zPart.split(' at ') :
                    zPart.includes(' in ') ? zPart.split(' in ') : [zPart];
    role = (atSplit[0] || '').trim();
    company = (atSplit[1] || '').trim();
  }

  // "Y joins COMPANY as Z"
  if (!person && lower.includes(' joins ') && lower.includes(' as ')) {
    const before = t.split(' joins ')[0] || '';
    const after = t.split(' joins ')[1] || '';
    person = before.trim();
    const asSplit = after.split(' as ');
    company = (asSplit[0] || '').trim();
    role = (asSplit[1] || '').trim();
  }

  // "COMPANY names/appoints Y as Z"
  if (!person && (lower.includes(' names ') || lower.includes(' appoints ')) && lower.includes(' as ')) {
    const verb = lower.includes(' names ') ? ' names ' : ' appoints ';
    const c = t.split(verb)[0] || '';
    const after = t.split(verb)[1] || '';
    const asSplit = after.split(' as ');
    person = (asSplit[0] || '').trim();
    role = (asSplit[1] || '').trim();
    company = c.trim();
  }

  // Trim artifacts
  const cut = (s) => s ? s.split('|')[0].split('-')[0].split(' at ')[0].trim() : '';
  return {
    person_name: cut(person),
    role: cut(role),
    company: cut(company),
    city: '',
    category: guessCategory(t),
  };
}

export async function extractFields({ title }) {
  const base = heuristicExtract(title || '');
  if (!HAS_OPENAI) return { ...base, _llm: false };

  try {
    // Ask for structured JSON
    const sys = 'You extract structured fields about leadership changes from short news headlines. Use only the headline. If not present, leave fields empty.';
    const user = `Headline: ${title}
Return JSON with keys: person_name, role, company, city, category (Appointment/Promotion | Resignation/Retirement | Award/Recognition | Other).`;
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(resp.choices[0].message.content || '{}');
    // Fallback merge
    return {
      person_name: (parsed.person_name || base.person_name || '').trim(),
      role: (parsed.role || base.role || '').trim(),
      company: (parsed.company || base.company || '').trim(),
      city: (parsed.city || base.city || '').trim(),
      category: (parsed.category || base.category || 'Other').trim(),
      _llm: true
    };
  } catch {
    return { ...base, _llm: false };
  }
}
