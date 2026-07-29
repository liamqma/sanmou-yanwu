import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TeamComp } from '../../../types/domain';
import KnownStrongTeams from '../KnownStrongTeams';

const promptMocks = vi.hoisted(() => ({
  selectRelevantTeamComps: vi.fn(),
}));

vi.mock('../../../services/promptGenerator', () => ({
  selectRelevantTeamComps: promptMocks.selectRelevantTeamComps,
  isChampionshipTeam: (comp: { sources: string[] }) =>
    comp.sources.includes('championship'),
  compareKnownTeamStrength: (
    left: { comp: { id: string } },
    right: { comp: { id: string } }
  ) => left.comp.id.localeCompare(right.comp.id),
}));

const championshipTeam: TeamComp = {
  id: 'championship-1',
  ranking: 'S',
  sources: ['championship'],
  section: '夺冠御三家',
  formation: '雁形阵',
  members: [
    {
      hero: '司马懿',
      skillSlots: [['未雨绸缪'], ['潜龙在渊', '避其锐气']],
    },
    {
      hero: '曹操',
      skillSlots: [['披坚执锐'], ['百战不殆']],
    },
    {
      hero: '满宠',
      skillSlots: [['蓄势待发'], ['青囊急救']],
    },
  ],
};

const ordinaryTeam: TeamComp = {
  id: 'strong-1',
  ranking: 'S',
  sources: ['strong'],
  section: '吴国',
  formation: '箕形阵',
  members: [
    {
      hero: '孙权',
      skillSlots: [['指点乾坤'], ['烈火焚营']],
    },
    {
      hero: '陆逊',
      skillSlots: [['风助火势'], ['明其虚实']],
    },
    {
      hero: '陆抗',
      skillSlots: [['折冲御侮'], ['御敌临前']],
    },
  ],
};

const relevant = [
  {
    comp: championshipTeam,
    selectedCount: 1,
    candidateCount: 1,
    selectedSkillCount: 1,
    candidateSkillCount: 1,
  },
  {
    comp: ordinaryTeam,
    selectedCount: 0,
    candidateCount: 1,
    selectedSkillCount: 0,
    candidateSkillCount: 0,
  },
];

const mockDesktopMedia = () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('KnownStrongTeams', () => {
  beforeEach(() => {
    mockDesktopMedia();
    promptMocks.selectRelevantTeamComps.mockReset();
    promptMocks.selectRelevantTeamComps.mockReturnValue(relevant);
  });

  test('hero rounds show formation and hero statuses without skill slots', () => {
    render(
      <MemoryRouter>
        <KnownStrongTeams
          selectedHeroes={['司马懿']}
          candidateHeroes={['曹操', '孙权']}
          selectedSkills={['未雨绸缪']}
          candidateSkills={['潜龙在渊']}
          roundType="hero"
        />
      </MemoryRouter>
    );

    expect(screen.getAllByTestId('known-team-card')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: '本轮阵容方向' })).toBeInTheDocument();
    expect(screen.getByText('推荐 2 组')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看完整阵容库' })).toHaveAttribute(
      'href',
      '/guides/yanwu'
    );
    expect(screen.getByRole('link', { name: '查看完整阵容库' })).toHaveAttribute(
      'target',
      '_blank'
    );
    expect(
      screen.queryByText('从本轮武将中提炼少量可衔接的成型方向。')
    ).not.toBeInTheDocument();
    expect(screen.getByText('夺冠御三家')).toBeInTheDocument();
    expect(screen.getByText('冠军参考')).toBeInTheDocument();
    expect(screen.getByText('阵型 · 雁形阵')).toBeInTheDocument();
    expect(screen.getAllByTestId('team-ranking').map((node) => node.textContent)).toEqual([
      'S',
      'S',
    ]);
    expect(screen.getByLabelText('司马懿：已获得')).toBeInTheDocument();
    expect(screen.getByLabelText('曹操：本轮可获得')).toBeInTheDocument();
    expect(screen.getByLabelText('满宠：尚未获得')).toBeInTheDocument();
    expect(screen.queryByTestId('known-team-skill-slot')).not.toBeInTheDocument();
    expect(screen.queryByText('S+')).not.toBeInTheDocument();
    expect(screen.queryByText(/三谋吕布/)).not.toBeInTheDocument();
  });

  test('skill rounds retain hero status and show two slots with slash alternatives', () => {
    render(
      <MemoryRouter>
        <KnownStrongTeams
          selectedHeroes={['司马懿']}
          selectedSkills={['未雨绸缪']}
          candidateSkills={['潜龙在渊']}
          roundType="skill"
        />
      </MemoryRouter>
    );

    const championshipCard = screen.getAllByTestId('known-team-card')[0];
    expect(within(championshipCard).getByLabelText('司马懿：已获得')).toBeInTheDocument();
    expect(within(championshipCard).getByLabelText('曹操：尚未获得')).toBeInTheDocument();
    expect(
      within(championshipCard).getByLabelText('未雨绸缪：已获得')
    ).toBeInTheDocument();
    expect(
      within(championshipCard).getByLabelText('潜龙在渊：本轮可获得')
    ).toBeInTheDocument();
    expect(
      within(championshipCard).getByLabelText('避其锐气：尚未获得')
    ).toBeInTheDocument();
    expect(within(championshipCard).getAllByText('/', { exact: true })).toHaveLength(1);
    expect(within(championshipCard).getAllByTestId('known-team-skill-slot')).toHaveLength(6);
    expect(within(championshipCard).getAllByTestId('known-team-skill-status')).toHaveLength(7);
  });

  test('passes both hero and skill pools into relevance selection', () => {
    render(
      <MemoryRouter>
        <KnownStrongTeams
          selectedHeroes={['司马懿']}
          candidateHeroes={['曹操']}
          selectedSkills={['未雨绸缪']}
          candidateSkills={['潜龙在渊']}
          roundType="skill"
        />
      </MemoryRouter>
    );

    expect(promptMocks.selectRelevantTeamComps).toHaveBeenCalledWith(
      ['司马懿'],
      ['曹操'],
      {
        includeCandidateOnlyComps: false,
        selectedSkills: ['未雨绸缪'],
        candidateSkills: ['潜龙在渊'],
      }
    );
  });

  test('skill rounds hide the panel when no offered skill fits a recommended slot', () => {
    promptMocks.selectRelevantTeamComps.mockReturnValue(
      relevant.map((entry) => ({ ...entry, candidateSkillCount: 0 }))
    );

    const { container } = render(
      <MemoryRouter>
        <KnownStrongTeams
          selectedHeroes={['司马懿']}
          selectedSkills={['未雨绸缪']}
          candidateSkills={['不存在的战法']}
          roundType="skill"
        />
      </MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });

  test('limits hero rounds to six directions and skill rounds to four', () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      comp: {
        ...ordinaryTeam,
        id: `strong-${index}`,
        members: ordinaryTeam.members.map((member, memberIndex) => ({
          ...member,
          hero: memberIndex === 0 ? `候选武将${index}` : member.hero,
        })) as TeamComp['members'],
      },
      selectedCount: 1,
      candidateCount: 1,
      selectedSkillCount: 0,
      candidateSkillCount: 1,
    }));
    promptMocks.selectRelevantTeamComps.mockReturnValue(entries);

    const { unmount } = render(
      <MemoryRouter>
        <KnownStrongTeams
          selectedHeroes={['陆逊']}
          candidateHeroes={entries.map((_, index) => `候选武将${index}`)}
          roundType="hero"
        />
      </MemoryRouter>
    );
    expect(screen.getAllByTestId('known-team-card')).toHaveLength(6);
    unmount();

    render(
      <MemoryRouter>
        <KnownStrongTeams
          selectedHeroes={['陆逊']}
          candidateSkills={['指点乾坤']}
          roundType="skill"
        />
      </MemoryRouter>
    );
    expect(screen.getAllByTestId('known-team-card')).toHaveLength(4);
  });
});
