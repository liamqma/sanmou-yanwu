import {
  isNamedUploaderName,
  loadUploaderName,
  saveUploaderName,
  UPLOADER_NAME_COOKIE,
  validateUploaderName,
} from '../uploaderName';

const cookieStore = () => {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn((name: string) => values.get(name)),
    set: vi.fn((name: string, value: string) => {
      values.set(name, value);
    }),
  };
};

describe('uploader name cookie', () => {
  test('preserves exact printable Unicode without trimming or normalization', () => {
    const store = cookieStore();
    const name = '  貂蝉⚔️玩家😀  ';

    expect(validateUploaderName(name)).toEqual({ valid: true, value: name });
    saveUploaderName(name, store);

    expect(store.set).toHaveBeenCalledWith(UPLOADER_NAME_COOKIE, name, {
      expires: 365,
      path: '/',
      sameSite: 'Lax',
    });
    expect(loadUploaderName(store)).toBe(name);
  });

  test('stores an explicit empty string so it replaces a previous prefill', () => {
    const store = cookieStore();
    store.values.set(UPLOADER_NAME_COOKIE, '旧名字');

    saveUploaderName('', store);

    expect(loadUploaderName(store)).toBe('');
    expect(store.values.has(UPLOADER_NAME_COOKIE)).toBe(true);
  });

  test('counts Unicode code points and allows joined emoji', () => {
    expect(validateUploaderName('😀'.repeat(80))).toEqual({
      valid: true,
      value: '😀'.repeat(80),
    });
    expect(validateUploaderName('👩‍💻')).toEqual({ valid: true, value: '👩‍💻' });
    expect(validateUploaderName('😀'.repeat(81))).toEqual(
      expect.objectContaining({ valid: false })
    );
  });

  test.each(['换\n行', '制表\t符', '隐藏\u200b字符', '\ud800'])(
    'rejects non-printable name %j',
    (name) => {
      expect(validateUploaderName(name)).toEqual(
        expect.objectContaining({ valid: false })
      );
    }
  );

  test('matches the importer distinction between anonymous and named values', () => {
    expect(isNamedUploaderName('')).toBe(false);
    expect(isNamedUploaderName('　 \u200d \u200d')).toBe(false);
    expect(isNamedUploaderName('  玩家  ')).toBe(true);
    expect(isNamedUploaderName('👩‍💻')).toBe(true);
  });
});
