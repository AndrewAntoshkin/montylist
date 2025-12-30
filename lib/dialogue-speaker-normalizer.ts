import type { ParsedScene } from '@/types';

/**
 * Post-processes Gemini dialogues to be more "montage-sheet like":
 * - Normalizes unknown speakers (НЕИЗВЕСТНАЯ/НЕИЗВЕСТНЫЙ/UNKNOWN) into a role label inferred from description
 * - Keeps speaker formatting as "SPEAKER" or "SPEAKER ZK" on its own line
 *
 * This is intentionally heuristic and language-agnostic-ish:
 * we only replace explicit "unknown" markers and never rewrite known names.
 */
export function normalizeSceneSpeakers(scene: ParsedScene): ParsedScene {
  const dialogues = (scene.dialogues || '').trim();
  if (!dialogues) return scene;

  const role = inferRoleFromDescription(scene.description || '');
  if (!role) return scene;

  const normalizedDialogues = replaceUnknownSpeakersWithRole(dialogues, role);
  if (normalizedDialogues === dialogues) return scene;

  return { ...scene, dialogues: normalizedDialogues };
}

function replaceUnknownSpeakersWithRole(dialogues: string, role: string): string {
  const lines = dialogues.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }

    // Unknown speaker markers we see in model outputs
    // Examples:
    // - НЕИЗВЕСТНАЯ
    // - НЕИЗВЕСТНЫЙ
    // - НЕИЗВЕСТНЫЙ_ГОЛОС
    // - НЕИЗВЕСТНЫЙ ГОЛОС
    // With optional ZK/GZ
    const m = trimmed.match(/^(НЕИЗВЕСТН(?:АЯ|ЫЙ)(?:[_\s]ГОЛОС)?)(?:\s+(ЗК|ГЗ|ГЗК))?$/i);
    if (m) {
      const suffix = m[2] ? ` ${m[2].toUpperCase()}` : '';
      out.push(`${role}${suffix}`);
      continue;
    }

    // English fallback
    const m2 = trimmed.match(/^(UNKNOWN(?:[_\s]VOICE)?)(?:\s+(ZK|GZ))?$/i);
    if (m2) {
      const suffix = m2[2] ? ` ${m2[2].toUpperCase()}` : '';
      out.push(`${role}${suffix}`);
      continue;
    }

    out.push(line);
  }

  return out.join('\n').trim();
}

/**
 * Tries to infer a reasonable role label from the scene description.
 *
 * We only return role labels (not names). If nothing is found, returns null.
 * Note: this is a heuristic; it should work "universally" for many Russian videos,
 * and it's safe because we only apply it to UNKNOWN speakers.
 */
function inferRoleFromDescription(description: string): string | null {
  const text = (description || '').toLowerCase();
  if (!text) return null;

  // Priority matters: prefer specific roles over generic ones.
  const candidates: Array<{ re: RegExp; label: string }> = [
    { re: /\bклиентк[аеиы]\b/i, label: 'КЛИЕНТКА' },
    { re: /\bклиент[ауы]?\b/i, label: 'КЛИЕНТ' },
    { re: /\bофициантк[аеиы]\b/i, label: 'ОФИЦИАНТКА' },
    { re: /\bофициант[ауы]?\b/i, label: 'ОФИЦИАНТ' },
    { re: /\bкосметолог\b/i, label: 'КОСМЕТОЛОГ' },
    { re: /\bврач\b/i, label: 'ВРАЧ' },
    { re: /\bмедсестр[аеиы]\b/i, label: 'МЕДСЕСТРА' },
    { re: /\bполицейск(?:ий|ая|ие)\b/i, label: 'ПОЛИЦЕЙСКИЙ' },
    { re: /\bохранник\b/i, label: 'ОХРАННИК' },
    { re: /\bпродавец\b/i, label: 'ПРОДАВЕЦ' },
    { re: /\bадминистратор\b/i, label: 'АДМИНИСТРАТОР' },
    { re: /\bменеджер\b/i, label: 'МЕНЕДЖЕР' },
    { re: /\bводитель\b/i, label: 'ВОДИТЕЛЬ' },
    { re: /\bкурьер\b/i, label: 'КУРЬЕР' },
    { re: /\bпрохож(?:ий|ая|ие)\b/i, label: 'ПРОХОЖИЙ' },
  ];

  for (const c of candidates) {
    if (c.re.test(text)) return c.label;
  }

  return null;
}



