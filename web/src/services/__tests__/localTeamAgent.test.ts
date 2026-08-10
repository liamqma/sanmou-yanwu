import {
  LOCAL_TEAM_AGENT_EXPERIMENT_KEY,
  LocalTeamAgentError,
  createTeamAgentRequest,
  isTeamBuilderLayoutComplete,
  layoutFromTeamAgentTeams,
  parseTeamAgentResult,
  requestLocalTeamRecommendation,
  syncLocalTeamAgentExperiment,
  type TeamAgentTeam,
} from '../localTeamAgent';
import {
  createEmptyTeamBuilderLayout,
} from '../teamBuilderArrangement';

const completeAgentTeams = (): TeamAgentTeam[] =>
  Array.from({ length: 3 }, (_, teamIndex) => ({
    formation: `阵型${teamIndex + 1}`,
    heroes: Array.from({ length: 3 }, (_, slotIndex) => ({
      hero: `武将${teamIndex}-${slotIndex}`,
      row: slotIndex === 0 ? ('前排' as const) : ('后排' as const),
      skills: [
        `战法${teamIndex}-${slotIndex}-0`,
        `战法${teamIndex}-${slotIndex}-1`,
      ] as [string, string],
    })) as TeamAgentTeam['heroes'],
  }));

const validResult = () => ({
  teams: completeAgentTeams(),
  status: 'complete',
  stoppedAt: null,
  attempts: { heroes: 1, formations: 1, skills: 2, review: 1 },
  heroAssignments: [
    {
      teamIndex: 0,
      slotIndex: 1,
      hero: '武将0-1',
      reason: '同阵营并补足谋略输出',
      evidence: ['hero:武将0-1'],
    },
  ],
  formationDecisions: [],
  skillAssignments: [],
  review: {
    status: 'complete',
    verdict: 'sound',
    teams: [
      {
        teamIndex: 0,
        verdict: 'sound',
        strengths: [
          {
            category: 'camp',
            message: '三名武将同阵营',
            evidence: [{ source: 'campBonus', id: 'camp:魏' }],
          },
        ],
        warnings: [],
      },
    ],
    crossTeamWarnings: [],
    deterministicRuleWarnings: [],
    attempts: 1,
    warnings: [],
  },
  warnings: [],
});

describe('local Team Agent experiment', () => {
  beforeEach(() => localStorage.clear());

  test('persists explicit enable and disable query parameters', () => {
    expect(syncLocalTeamAgentExperiment('?local-agent=1', localStorage)).toBe(
      true
    );
    expect(localStorage.getItem(LOCAL_TEAM_AGENT_EXPERIMENT_KEY)).toBe(
      'enabled'
    );
    expect(syncLocalTeamAgentExperiment('', localStorage)).toBe(true);

    expect(syncLocalTeamAgentExperiment('?local-agent=0', localStorage)).toBe(
      false
    );
    expect(localStorage.getItem(LOCAL_TEAM_AGENT_EXPERIMENT_KEY)).toBeNull();
  });

  test('does not enable itself without an explicit or stored flag', () => {
    expect(syncLocalTeamAgentExperiment('', localStorage)).toBe(false);
  });
});

describe('Team Agent request mapping', () => {
  test('sends only unused resources and does not treat visual row defaults as decisions', () => {
    const layout = createEmptyTeamBuilderLayout();
    layout[0].heroes[0].hero = '司马懿';
    layout[0].heroes[0].skills[0] = '未雨绸缪';
    layout[1].formation = '雁形阵';
    layout[1].heroes[0].hero = '曹丕';
    layout[1].heroes[0].row = '后排';

    const request = createTeamAgentRequest({
      layout,
      heroes: ['司马懿', '曹丕', '郝昭'],
      skills: ['未雨绸缪', '奇正相生'],
      season: 8,
    });

    expect(request.availableHeroes).toEqual(['郝昭']);
    expect(request.availableSkills).toEqual(['奇正相生']);
    expect(request.season).toBe(8);
    expect(request.teams[0].formation).toBeNull();
    expect(request.teams[0].heroes[0].row).toBeNull();
    expect(request.teams[0].heroes[1].row).toBeNull();
    expect(request.teams[1].heroes[0].row).toBe('后排');
  });

  test('detects whether all hero, formation, and skill slots are filled', () => {
    const layout = layoutFromTeamAgentTeams(completeAgentTeams());
    expect(isTeamBuilderLayoutComplete(layout)).toBe(true);

    layout[2].heroes[2].skills[1] = null;
    expect(isTeamBuilderLayoutComplete(layout)).toBe(false);
  });

  test('maps nullable Agent fields back to safe editable UI defaults', () => {
    const teams = completeAgentTeams();
    teams[0].formation = null;
    teams[0].heroes[0].row = null;
    teams[0].heroes[0].hero = null;
    teams[0].heroes[0].skills[0] = null;

    const layout = layoutFromTeamAgentTeams(teams);
    expect(layout[0].formation).toBe('');
    expect(layout[0].heroes[0]).toEqual({
      hero: null,
      row: '前排',
      skills: [null, '战法0-0-1'],
    });
  });
});

describe('Team Agent response boundary', () => {
  test('validates a response before exposing it to the page', () => {
    expect(parseTeamAgentResult(validResult())).toMatchObject({
      status: 'complete',
      stoppedAt: null,
      attempts: { heroes: 1, formations: 1, skills: 2, review: 1 },
      review: { status: 'complete', verdict: 'sound' },
    });
  });

  test('rejects malformed response teams', () => {
    const result = validResult();
    result.teams = result.teams.slice(0, 2);
    expect(() => parseTeamAgentResult(result)).toThrow(LocalTeamAgentError);
  });

  test('checks readiness and then posts the recommendation', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validResult()), { status: 200 })
      );
    const input = createTeamAgentRequest({
      layout: layoutFromTeamAgentTeams(completeAgentTeams()),
      heroes: [],
      skills: [],
      season: 8,
    });

    const result = await requestLocalTeamRecommendation(input, { fetchImpl });

    expect(result.status).toBe('complete');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8790/health/ready'
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'http://127.0.0.1:8790/v1/team-recommendations'
    );
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST' });
  });

  test('classifies a network failure as unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      requestLocalTeamRecommendation(
        {
          teams: [],
          availableHeroes: [],
          availableSkills: [],
          season: 8,
        },
        { fetchImpl }
      )
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});
