export type PlanTextResult = { ok: true; text: string } | { ok: false; error: string };

// C0 and C1 controls except \t \n \r (DEL included).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

// Every plan write goes through here, so a stored plan is always plain text:
// strict UTF-8 (a fatal decode, unlike readFileSync's silent U+FFFD), no control
// characters, no BOM, LF line endings — replace() anchors are written with \n.
export function checkPlanText(input: Buffer | string, { allowEmpty = false }: { allowEmpty?: boolean } = {}): PlanTextResult {
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      return { ok: false, error: 'plan is not valid UTF-8 text — upload a markdown (.md) file' };
    }
  }
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const bad = CONTROL.exec(text);
  if (bad) {
    const code = bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    return { ok: false, error: `plan contains control character U+${code} at offset ${bad.index} — only plain text is accepted` };
  }
  if (!allowEmpty && text.trim() === '') return { ok: false, error: 'plan is empty — refusing to clear the plan' };
  return { ok: true, text };
}
