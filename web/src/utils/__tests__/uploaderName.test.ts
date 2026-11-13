import {
  isNamedUploaderName,
  validateUploaderName,
} from '../uploaderName';

describe('uploader name', () => {
  test('preserves exact printable Unicode without trimming or normalization', () => {
    const name = '  貂蝉⚔️玩家😀  ';
    expect(validateUploaderName(name)).toEqual({ valid: true, value: name });
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
