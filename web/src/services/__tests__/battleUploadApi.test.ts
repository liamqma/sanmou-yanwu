import type { UploadedBattle } from '../../types/battleUpload';
import {
  BattleUploadApiError,
  getPersistentSubmissionId,
  submitBattle,
} from '../battleUploadApi';

const firstUuid = '11111111-1111-4111-8111-111111111111';
const secondUuid = '22222222-2222-4222-8222-222222222222';
const thirdUuid = '33333333-3333-4333-8333-333333333333';
const fourthUuid = '44444444-4444-4444-8444-444444444444';
const battle = (winner: '1' | '2' = '1'): UploadedBattle =>
  ({
    '1': [],
    '2': [],
    winner,
  }) as unknown as UploadedBattle;

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    read: (key: string) => values.get(key) ?? null,
  };
};

const response = (status: number, payload: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }) as Response;

describe('persistent battle submission id', () => {
  test('keeps the raw retry identity in tab-scoped session storage, not local storage', () => {
    sessionStorage.clear();
    localStorage.clear();

    expect(
      getPersistentSubmissionId(
        battle(),
        '仅本标签页',
        16,
        undefined,
        () => firstUuid
      )
    ).toBe(firstUuid);
    expect(sessionStorage.getItem('battleUploadSubmission')).not.toBeNull();
    expect(localStorage.getItem('battleUploadSubmission')).toBeNull();

    sessionStorage.clear();
  });

  test('reuses an id for the same season, parsed battle and exact uploader', () => {
    const storage = memoryStorage();
    const createUuid = vi.fn(() => firstUuid);

    expect(
      getPersistentSubmissionId(battle(), '玩家😀', 16, storage, createUuid)
    ).toBe(firstUuid);
    expect(
      getPersistentSubmissionId(battle(), '玩家😀', 16, storage, createUuid)
    ).toBe(firstUuid);
    expect(createUuid).toHaveBeenCalledTimes(1);
  });

  test('changes id when the battle, exact uploader or season changes', () => {
    const storage = memoryStorage();
    const createUuid = vi
      .fn<() => string>()
      .mockReturnValueOnce(firstUuid)
      .mockReturnValueOnce(secondUuid)
      .mockReturnValueOnce(thirdUuid)
      .mockReturnValueOnce(fourthUuid);

    getPersistentSubmissionId(battle(), '玩家', 16, storage, createUuid);
    expect(
      getPersistentSubmissionId(battle('2'), '玩家', 16, storage, createUuid)
    ).toBe(secondUuid);
    expect(
      getPersistentSubmissionId(battle('2'), '玩家 ', 16, storage, createUuid)
    ).toBe(thirdUuid);
    expect(
      getPersistentSubmissionId(battle('2'), '玩家 ', 15, storage, createUuid)
    ).toBe(fourthUuid);
  });

  test('repersists an older in-memory id before a refresh after A → B → A', () => {
    const storage = memoryStorage();
    const createUuid = vi
      .fn<() => string>()
      .mockReturnValueOnce(firstUuid)
      .mockReturnValueOnce(secondUuid);

    expect(
      getPersistentSubmissionId(
        battle(),
        '交替重试-A',
        16,
        storage,
        createUuid
      )
    ).toBe(firstUuid);
    expect(
      getPersistentSubmissionId(
        battle('2'),
        '交替重试-B',
        16,
        storage,
        createUuid
      )
    ).toBe(secondUuid);
    expect(
      getPersistentSubmissionId(
        battle(),
        '交替重试-A',
        16,
        storage,
        createUuid
      )
    ).toBe(firstUuid);

    expect(
      JSON.parse(storage.read('battleUploadSubmission') ?? 'null')
    ).toEqual(
      expect.objectContaining({
        submissionId: firstUuid,
      })
    );
    expect(createUuid).toHaveBeenCalledTimes(2);
  });

  test('reuses the page-session id when localStorage get and set throw', () => {
    const unavailableStorage = {
      getItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError');
      }),
      setItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError');
      }),
    };
    const createUuid = vi.fn(() => secondUuid);

    expect(
      getPersistentSubmissionId(
        battle(),
        '内存回退专用名字',
        16,
        unavailableStorage,
        createUuid
      )
    ).toBe(secondUuid);
    expect(
      getPersistentSubmissionId(
        battle(),
        '内存回退专用名字',
        16,
        unavailableStorage,
        createUuid
      )
    ).toBe(secondUuid);
    expect(createUuid).toHaveBeenCalledTimes(1);
    expect(unavailableStorage.getItem).toHaveBeenCalledTimes(2);
    expect(unavailableStorage.setItem).toHaveBeenCalledTimes(2);
  });

  test('survives a sessionStorage global that throws on access', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'sessionStorage'
    );
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });

    try {
      expect(
        getPersistentSubmissionId(
          battle(),
          '沙箱环境',
          16,
          undefined,
          () => firstUuid
        )
      ).toBe(firstUuid);
      // The bounded page-session map still keeps the retry idempotent.
      expect(
        getPersistentSubmissionId(
          battle(),
          '沙箱环境',
          16,
          undefined,
          () => secondUuid
        )
      ).toBe(firstUuid);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'sessionStorage', original);
      } else {
        delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
      }
      sessionStorage.clear();
    }
  });
});

describe('submitBattle', () => {
  test('posts the exact request and accepts idempotent duplicate success', async () => {
    const request = {
      submission_id: firstUuid,
      uploader_name: '',
      season: 16,
      battle: battle(),
    };
    const fetchImpl = vi.fn(async () =>
      response(200, { ok: true, accepted: 0, duplicates: 1 })
    );

    await expect(submitBattle(request, fetchImpl)).resolves.toEqual({
      ok: true,
      accepted: 0,
      duplicates: 1,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/battles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  });

  test('exposes a bounded server message and code on non-2xx', async () => {
    const fetchImpl = vi.fn(async () =>
      response(400, { ok: false, error: '战报字段无效', code: 'INVALID_BATTLE' })
    );

    const promise = submitBattle(
      {
        submission_id: firstUuid,
        uploader_name: '甲',
        season: 16,
        battle: battle(),
      },
      fetchImpl
    );
    await expect(promise).rejects.toEqual(
      expect.objectContaining({
        name: 'BattleUploadApiError',
        status: 400,
        code: 'INVALID_BATTLE',
        message: '战报字段无效（INVALID_BATTLE）',
      })
    );
    await promise.catch((error) => expect(error).toBeInstanceOf(BattleUploadApiError));
  });

  test('maps a technical non-Chinese server message to a generic Chinese error', async () => {
    const fetchImpl = vi.fn(async () =>
      response(400, {
        ok: false,
        error: 'battle.1[0].name is not in the hero catalog',
      })
    );

    const promise = submitBattle(
      {
        submission_id: firstUuid,
        uploader_name: '甲',
        season: 16,
        battle: battle(),
      },
      fetchImpl
    );
    await expect(promise).rejects.toEqual(
      expect.objectContaining({
        name: 'BattleUploadApiError',
        status: 400,
        message: '提交失败（HTTP 400），请稍后重试。',
      })
    );
    await promise.catch((error) =>
      expect((error as Error).message).not.toContain('hero catalog')
    );
  });

  test('keeps retry semantics visible after a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('secret browser detail');
    });

    await expect(
      submitBattle(
        {
          submission_id: firstUuid,
          uploader_name: '甲',
          season: 16,
          battle: battle(),
        },
        fetchImpl
      )
    ).rejects.toThrow('相同战报会沿用本次提交编号');
  });
});
