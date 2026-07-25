import {
  parseUploadLeaderboard,
  uploadLeaderboardUrl,
} from '../uploadLeaderboard';

const artifact = () => ({
  schema_version: 1,
  updated_date: '2026-07-24',
  updated_through_id: 42,
  summary: {
    processed_reports: 8,
    accepted_reports: 7,
    rejected_reports: 1,
  },
  contributors: [
    { name: '<img src=x onerror=alert(1)>', accepted_reports: 4 },
    { name: '貂蝉😀', accepted_reports: 3 },
  ],
});

describe('parseUploadLeaderboard', () => {
  test('accepts exact artifact counts and printable names without rewriting them', () => {
    const value = artifact();
    expect(parseUploadLeaderboard(value)).toEqual(value);
  });

  test.each([
    { mutate: (value: ReturnType<typeof artifact>) => { value.updated_date = '2026-02-30'; } },
    { mutate: (value: ReturnType<typeof artifact>) => { value.summary.processed_reports = 9; } },
    { mutate: (value: ReturnType<typeof artifact>) => { value.contributors[1].accepted_reports = 5; } },
    { mutate: (value: ReturnType<typeof artifact>) => { value.contributors[0].name = '   '; } },
  ])('fails closed for a malformed generated artifact', ({ mutate }) => {
    const value = artifact();
    mutate(value);
    expect(parseUploadLeaderboard(value)).toBeNull();
  });

  test('allows the initial artifact to have no processed date or contributors', () => {
    const value = artifact();
    value.updated_date = null as unknown as string;
    value.updated_through_id = 0;
    value.summary = {
      processed_reports: 0,
      accepted_reports: 0,
      rejected_reports: 0,
    };
    value.contributors = [];
    expect(parseUploadLeaderboard(value)).toEqual(value);
  });

  test('allows a nonzero cursor with no valid processed date', () => {
    const value = artifact();
    value.updated_date = null as unknown as string;
    expect(value.updated_through_id).toBeGreaterThan(0);
    expect(parseUploadLeaderboard(value)).toEqual(value);
  });

  test('rejects named contribution counts above total accepted reports', () => {
    const value = artifact();
    value.summary = {
      processed_reports: 7,
      accepted_reports: 6,
      rejected_reports: 1,
    };
    expect(
      value.contributors.reduce(
        (total, contributor) => total + contributor.accepted_reports,
        0
      )
    ).toBe(7);
    expect(parseUploadLeaderboard(value)).toBeNull();
  });

  test('validates tied-name ordering with Python-compatible Unicode code points', () => {
    const value = artifact();
    value.contributors = [
      { name: '\ue000', accepted_reports: 3 },
      { name: '😀', accepted_reports: 3 },
    ];
    expect(parseUploadLeaderboard(value)).toEqual(value);
  });
});

test('upload leaderboard URL uses a daily cache key', () => {
  expect(
    uploadLeaderboardUrl(new Date('2026-07-24T23:59:59Z'))
  ).toBe('/game-data/web_upload_data.json?v=2026-07-24');
});
