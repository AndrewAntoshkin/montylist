import type { CharacterRegistry } from './character-registry';

/**
 * Safely merges role labels -> real character names using evidence from descriptions.
 *
 * Goal:
 * - If dialogues use a ROLE label as speaker (e.g., "КОСМЕТОЛОГ") but the description
 *   explicitly mentions a known character name (e.g., "Тома ..."), we can replace
 *   the role speaker with the real name.
 *
 * Safety:
 * - Never rewrites already-known names
 * - Only rewrites role-speakers when we have high-confidence evidence:
 *   1) Description contains exactly one known character name (canonical or variant)
 *   2) Role speaker appears as a standalone speaker line
 *   3) Mapping role->name is confirmed at least N times in the sheet (default 2)
 */
export function mergeRoleSpeakersToNames<T extends { id: string; description?: string; dialogues?: string }>(
  entries: T[],
  registry: CharacterRegistry | null,
  options?: { minConfirmations?: number }
): { entries: T[]; replacements: number; mappings: Array<{ role: string; name: string; confirmations: number }> } {
  const minConfirmations = options?.minConfirmations ?? 2;
  if (!entries || entries.length === 0) return { entries, replacements: 0, mappings: [] };
  if (!registry || !registry.characters || registry.characters.length === 0) {
    return { entries, replacements: 0, mappings: [] };
  }

  const known = buildKnownNameMatchers(registry);
  const counts = new Map<string, Map<string, number>>(); // role -> (name -> count)

  // Pass 1: collect evidence
  for (const e of entries) {
    const desc = (e.description || '').trim();
    const dlg = (e.dialogues || '').trim();
    if (!desc || !dlg) continue;

    const role = inferRoleFromText(desc);
    if (!role) continue;

    if (!dialoguesHasSpeaker(dlg, role)) continue;

    const namesMentioned = findKnownNamesInText(desc, known);
    if (namesMentioned.length !== 1) continue;

    const name = namesMentioned[0];
    if (!counts.has(role)) counts.set(role, new Map());
    const m = counts.get(role)!;
    m.set(name, (m.get(name) || 0) + 1);
  }

  // Pick stable mappings
  const roleToName = new Map<string, { name: string; confirmations: number }>();
  for (const [role, perName] of counts.entries()) {
    // Choose the top candidate and ensure it's above threshold and not ambiguous
    const sorted = [...perName.entries()].sort((a, b) => b[1] - a[1]);
    const [topName, topCount] = sorted[0] || [];
    const second = sorted[1];

    if (!topName || topCount < minConfirmations) continue;
    if (second && second[1] >= Math.max(2, Math.floor(topCount * 0.75))) {
      // too ambiguous — skip mapping
      continue;
    }

    roleToName.set(role, { name: topName, confirmations: topCount });
  }

  if (roleToName.size === 0) {
    return { entries, replacements: 0, mappings: [] };
  }

  // Pass 2: apply mappings
  let replacements = 0;
  const updated = entries.map((e) => {
    const dlg = (e.dialogues || '').trim();
    if (!dlg) return e;

    let newDlg = dlg;
    for (const [role, v] of roleToName.entries()) {
      newDlg = replaceSpeakerLine(newDlg, role, v.name);
    }

    if (newDlg !== dlg) {
      replacements++;
      return { ...e, dialogues: newDlg };
    }
    return e;
  });

  const mappings = [...roleToName.entries()].map(([role, v]) => ({
    role,
    name: v.name,
    confirmations: v.confirmations,
  }));

  return { entries: updated, replacements, mappings };
}

type KnownMatchers = Array<{ canonical: string; variants: string[] }>;

function buildKnownNameMatchers(registry: CharacterRegistry): KnownMatchers {
  return registry.characters.map(c => ({
    canonical: c.name.toUpperCase(),
    variants: [c.name, ...(c.variants || [])].map(v => String(v).toUpperCase()),
  }));
}

function findKnownNamesInText(text: string, known: KnownMatchers): string[] {
  const upper = text.toUpperCase();
  const found = new Set<string>();

  for (const k of known) {
    for (const v of k.variants) {
      // Word-boundary-ish match for Cyrillic/Latin
      const re = new RegExp(`(^|[^А-ЯЁA-Z])${escapeRegex(v)}([^А-ЯЁA-Z]|$)`, 'i');
      if (re.test(upper)) {
        found.add(k.canonical);
        break;
      }
    }
  }

  return [...found];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dialoguesHasSpeaker(dialogues: string, speaker: string): boolean {
  const lines = dialogues.split('\n').map(l => l.trim());
  const upper = speaker.toUpperCase();
  return lines.some(l => l === upper || l === `${upper} ЗК` || l === `${upper} ГЗ` || l === `${upper} ГЗК`);
}

function replaceSpeakerLine(dialogues: string, fromSpeaker: string, toSpeaker: string): string {
  const from = fromSpeaker.toUpperCase();
  const to = toSpeaker.toUpperCase();
  const lines = dialogues.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === from) {
      lines[i] = to;
    } else if (t === `${from} ЗК`) {
      lines[i] = `${to} ЗК`;
    } else if (t === `${from} ГЗ`) {
      lines[i] = `${to} ГЗ`;
    } else if (t === `${from} ГЗК`) {
      lines[i] = `${to} ГЗК`;
    }
  }

  return lines.join('\n').trim();
}

// Minimal role inference: universal enough, safe because applied only to ROLE-speakers.
function inferRoleFromText(description: string): string | null {
  const text = (description || '').toLowerCase();
  if (!text) return null;

  const candidates: Array<{ re: RegExp; label: string }> = [
    { re: /\bкосметолог\b/i, label: 'КОСМЕТОЛОГ' },
    { re: /\bклиентк[аеиы]\b/i, label: 'КЛИЕНТКА' },
    { re: /\bклиент[ауы]?\b/i, label: 'КЛИЕНТ' },
    { re: /\bофициантк[аеиы]\b/i, label: 'ОФИЦИАНТКА' },
    { re: /\bофициант[ауы]?\b/i, label: 'ОФИЦИАНТ' },
    { re: /\bполицейск(?:ий|ая|ие)\b/i, label: 'ПОЛИЦЕЙСКИЙ' },
    { re: /\bохранник\b/i, label: 'ОХРАННИК' },
    { re: /\bврач\b/i, label: 'ВРАЧ' },
    { re: /\bпродавец\b/i, label: 'ПРОДАВЕЦ' },
    { re: /\bадминистратор\b/i, label: 'АДМИНИСТРАТОР' },
    { re: /\bводитель\b/i, label: 'ВОДИТЕЛЬ' },
    { re: /\bкурьер\b/i, label: 'КУРЬЕР' },
  ];

  for (const c of candidates) {
    if (c.re.test(text)) return c.label;
  }
  return null;
}



