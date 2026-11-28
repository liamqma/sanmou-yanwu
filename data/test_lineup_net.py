"""Run with `make test-lineup` (needs the `neural` dependency group)."""
from __future__ import annotations

from collections import Counter

import pytest

torch = pytest.importorskip("torch")

from data import lineup_net as L  # noqa: E402

HEROES = [f"将{n}" for n in range(12)]
SKILLS = [f"法{n}" for n in range(24)]


@pytest.fixture(scope="module")
def scorer():
    torch.manual_seed(0)
    teams = Counter(
        L.canon(HEROES[3 * t:3 * t + 3], SKILLS[6 * t:6 * t + 6]) for t in range(4) for _ in range(t + 1))
    vocab = L.Vocab(sorted(teams))
    nets = [L.TeamNet(len(vocab.heroes), len(vocab.skills), width=16, layers=1).eval() for _ in range(2)]
    scorer = L.NeuralScorer(nets[0], vocab, teams, nets[1], list(teams), 3.0, 0.5)
    scorer.guide = L.Guide(scorer)
    return scorer


def test_fast_search_places_every_card_without_random_numbers(scorer):
    for heroes, skills in ((HEROES[:9], SKILLS[:18]), (HEROES[:4], SKILLS[:8]), (HEROES[:2], SKILLS[:3]),
                           ([], []), (HEROES, SKILLS)):
        value, lineup, (h, s) = L.search(heroes, skills, scorer, None, 4)
        assert sorted(x for x in h if x) == sorted(heroes) and sorted(x for x in s if x) == sorted(skills)
        assert len([x for x in h[:9] if x]) == min(len(heroes), 9)
        assert len([x for x in s[:18] if x]) == min(len(skills), 18)
        assert value == pytest.approx(float(sum(scorer(list(lineup)))), abs=1e-4)


def test_carried_search_leaves_no_skill_without_a_hero(scorer):
    for heroes, skills in ((HEROES[:4], SKILLS[:11]), (HEROES[:1], SKILLS[:5]), ([], SKILLS[:3]),
                           (HEROES[:7], SKILLS[:14])):
        _, _, (h, s) = L.search(heroes, skills, scorer, None, 4, carried=True)
        assert all(h[p // 2] for p in range(18) if s[p])
        assert len([x for x in s[:18] if x]) == min(len(skills), 2 * len(heroes))
        assert sorted(x for x in s if x) == sorted(skills)


def test_fill_keeps_placed_cards_and_fills_the_rest(scorer):
    layout_heroes = [HEROES[0], "", HEROES[5], "", "", "", HEROES[7], "", HEROES[2]]
    layout_skills = [SKILLS[3], ""] + [""] * 2 + [SKILLS[9], SKILLS[1]] + [""] * 6 + ["", SKILLS[20]] + [""] * 4
    _, _, (h, s) = L.fill(layout_heroes, layout_skills, HEROES, SKILLS, scorer)
    assert all(h[p] == x for p, x in enumerate(layout_heroes) if x)
    assert all(s[p] == x for p, x in enumerate(layout_skills) if x)
    assert "" not in h[:9] and "" not in s[:18]
    assert sorted(h) == sorted(HEROES) and sorted(s) == sorted(SKILLS)
    # 武将不够时，多出来的战法留在替补席。
    _, _, (h, s) = L.fill(layout_heroes, layout_skills, layout_heroes, SKILLS, scorer)
    assert [x for x in h if x] == [x for x in layout_heroes if x]
    assert all(h[p // 2] for p in range(18) if s[p]) and len([x for x in s[:18] if x]) == 8


def test_support_ranks_only_the_given_candidates(scorer):
    base, single, pairs = L.support(HEROES[:9], SKILLS[:18], "skill", 2, scorer, None, 2, shortlist=3,
                                    deep=1, candidates=SKILLS[16:22])
    assert sorted(cards[0] for cards, _, _ in single) == SKILLS[18:22]
    assert len(pairs) == 3 and all(len(cards) == 2 for cards, _, _ in pairs)
    assert pairs[0][1] >= pairs[-1][1]
