import Cookies from 'js-cookie';

export const UPLOADER_NAME_COOKIE = 'battleUploaderName';
export const MAX_UPLOADER_NAME_CODE_POINTS = 80;

interface CookieStore {
  get(name: string): string | undefined;
  set(
    name: string,
    value: string,
    options: {
      expires: number;
      path: string;
      sameSite: 'Lax';
    }
  ): unknown;
}

export type UploaderNameValidation =
  | { valid: true; value: string }
  | { valid: false; error: string };

/**
 * Match the daily importer: blank/whitespace names and strings containing only
 * emoji joiners are anonymous; every nonblank name remains byte-for-byte exact.
 */
export function isNamedUploaderName(
  value: string | null | undefined
): value is string {
  if (value === null || value === undefined) return false;
  return value.replaceAll('\u200d', '').trim().length > 0;
}

/** Keep exact printable Unicode; never trim or normalize a contributor name. */
export function validateUploaderName(value: string): UploaderNameValidation {
  if ([...value].length > MAX_UPLOADER_NAME_CODE_POINTS) {
    return {
      valid: false,
      error: `名字最多 ${MAX_UPLOADER_NAME_CODE_POINTS} 个字符（留空也可以）。`,
    };
  }
  for (const character of value) {
    const allowedEmojiJoiner = character === '\u200d';
    if (
      /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(character) ||
      (!allowedEmojiJoiner && /\p{Cf}/u.test(character))
    ) {
      return {
        valid: false,
        error: '名字不能包含控制字符、隐藏格式字符或换行。',
      };
    }
  }
  return { valid: true, value };
}

export function loadUploaderName(cookieStore: CookieStore = Cookies): string {
  return cookieStore.get(UPLOADER_NAME_COOKIE) ?? '';
}

/** Saving an explicit empty string is intentional: it clears the next prefill. */
export function saveUploaderName(
  value: string,
  cookieStore: CookieStore = Cookies
): void {
  cookieStore.set(UPLOADER_NAME_COOKIE, value, {
    expires: 365,
    path: '/',
    sameSite: 'Lax',
  });
}
