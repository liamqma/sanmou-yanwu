"""把一个训练好的阵容模型导出成网站用的文件，并生成网站实现的对拍夹具。

运行：uv run --group neural python -m data.export_lineup_model
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import random

import numpy as np
import torch

from . import lineup_net as L

FORMAT = 9      # 遥测 model_version 的第一段；旧的线性模型用到 8
STRENGTH_WEIGHT, PRIOR_WEIGHT, REFERENCES = 3.0, 0.5, 128      # 与 lineup_net 命令行的默认值相同
UNKNOWN_HEROES, UNKNOWN_SKILLS = ["未知武将甲", "未知武将乙"], ["未知战法甲", "未知战法乙"]


def load_scorer(checkpoint):
    scorer, references = L.Ensemble([checkpoint], STRENGTH_WEIGHT, PRIOR_WEIGHT, REFERENCES).parts[0]
    scorer.guide = L.Guide(scorer)
    return scorer, references


def export(checkpoint, scorer, references):
    """返回（权重二进制, 说明 JSON）。两个网络各自用不到的头不导出。"""
    saved = torch.load(checkpoint, weights_only=False)
    tensors, chunks, offset = {}, [], 0
    for net, unused in (("model", ("strength.", "matchup.")), ("judge", ("hero_bias", "skill_bias"))):
        for name, value in saved[net].items():
            if not name.startswith(unused):
                array = value.numpy().astype("<f4")
                tensors[f"{net}.{name}"] = [offset, *array.shape]
                chunks.append(array.tobytes())
                offset += array.size
    binary = b"".join(chunks)
    h, s = scorer.vocab.encode(references)
    meta = {
        "battles": sum(n for _, n in saved["teams"]) // 2,
        "width": saved["settings"]["width"], "layers": saved["settings"]["layers"], "heads": 4,
        "prior_weight": PRIOR_WEIGHT, "strength_weight": STRENGTH_WEIGHT,
        "heroes": scorer.vocab.heroes, "skills": scorer.vocab.skills,
        "hero_prior": [float(f"{x:.9g}") for x in scorer.hero_prior.tolist()],
        "skill_prior": [float(f"{x:.9g}") for x in scorer.skill_prior.tolist()],
        "references": np.concatenate([h, s.reshape(-1, 6)], 1).tolist(),
        "tensors": tensors,
    }
    digest = hashlib.sha256(
        binary + json.dumps(meta, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    return binary, {"version": f"{FORMAT}:{digest}", **meta}


def fixtures(scorer, references, version):
    """参考实现在一批卡池上的结果。搜索次数比网站用的少，只为对拍跑得快。"""
    rng = random.Random(0)
    heroes, skills = scorer.vocab.heroes[2:], scorer.vocab.skills[2:]

    def number(x):
        return round(float(x), 6)

    def pool(teams, n_heroes, n_skills, unknown=0):
        """从几支常见队伍凑一个卡池，不够的随机补，可以再掺几张模型没见过的卡。"""
        picked = rng.sample(references, teams)
        h = list(dict.fromkeys(x for t in picked for x, _ in t))
        s = list(dict.fromkeys(x for t in picked for _, pair in t for x in pair))
        h += rng.sample([x for x in heroes if x not in h], max(0, n_heroes - len(h)))
        s += rng.sample([x for x in skills if x not in s], max(0, n_skills - len(s)))
        h, s = h[:n_heroes - unknown] + UNKNOWN_HEROES[:unknown], s[:n_skills - unknown] + UNKNOWN_SKILLS[:unknown]
        rng.shuffle(h)
        rng.shuffle(s)
        return h, s

    def others(own, names, count):
        return rng.sample([x for x in names if x not in own], count)

    def lineup(found):
        return [[[hero, list(pair)] for hero, pair in team] for team in found]

    teams = list(rng.sample(references, 40))
    for _ in range(80):
        h, s = rng.sample(heroes + UNKNOWN_HEROES, 3), rng.sample(skills + UNKNOWN_SKILLS, 6)
        for i in rng.sample(range(3), rng.choice([0, 0, 1, 2])):
            h[i] = L.EMPTY
        for i in rng.sample(range(6), rng.choice([0, 0, 1, 3, 6])):
            s[i] = L.EMPTY
        teams.append(L.canon(h, s))
    out = {"version": version, "teams": [
        {"team": lineup([team])[0], "score": number(value),
         "strength": number(scorer.win_probability([team] * len(references), references).mean())}
        for team, value in zip(teams, scorer(teams))]}

    out["lineups"] = []
    for size in [(4, 8, 0), (2, 5, 0), (7, 11, 0), (7, 14, 1), (10, 20, 0), (11, 22, 2), (15, 25, 0)]:
        h, s = pool(3, *size)
        value, found = L.best_lineup(h, s, scorer, None, 4, carried=True)
        out["lineups"].append({"heroes": h, "skills": s, "restarts": 4, "score": number(value),
                               "lineup": lineup(found)})

    out["fills"] = []
    for size in [(7, 14, 0), (11, 22, 0), (12, 24, 1)]:
        h, s = pool(3, *size)
        _, _, (state_h, state_s) = L.search(h, s, scorer, None, 2)
        layout_h, layout_s = state_h[:9], state_s[:18]
        for p in rng.sample(range(9), 4):      # 拿掉四名武将和他们的战法，再拿掉另外几个战法
            layout_h[p] = layout_s[2 * p] = layout_s[2 * p + 1] = L.EMPTY
        for p in rng.sample(range(18), 3):
            layout_s[p] = L.EMPTY
        value, _, (state_h, state_s) = L.fill(layout_h, layout_s, h, s, scorer)
        out["fills"].append({"layout_heroes": layout_h, "layout_skills": layout_s, "heroes": h,
                             "skills": s, "score": number(value), "state_heroes": state_h,
                             "state_skills": state_s})

    out["picks"] = []
    for n_heroes, n_skills, kind, per_set, unknown in [
            (4, 8, "hero", 3, 0), (7, 8, "skill", 3, 0), (7, 14, "hero", 3, 1), (10, 17, "skill", 3, 1),
            (11, 22, "hero", 2, 0), (13, 22, "skill", 3, 0)]:
        h, s = pool(3, n_heroes, n_skills, unknown)
        extra = others(h if kind == "hero" else s, heroes if kind == "hero" else skills, 3 * per_set)
        options = [extra[i:i + per_set] for i in range(0, len(extra), per_set)]
        cache = {}
        first = L.pick(h, s, options, kind, scorer, None, 3, cache)
        deep = L.deepen(first, h, s, options, kind, scorer, None, 1, cache)
        out["picks"].append({"heroes": h, "skills": s, "options": options, "kind": kind,
                             "restarts": 3, "deepen": 1,
                             "scores": [number(v) for v, _ in first],
                             "deepened": [number(v) for v, _ in deep]})

    out["supports"] = []
    for n_heroes, n_skills, kind, count in [(10, 20, "hero", 1), (11, 20, "skill", 2), (11, 21, "skill", 1)]:
        h, s = pool(3, n_heroes, n_skills)
        candidates = others(h if kind == "hero" else s, heroes if kind == "hero" else skills, 16)
        base, single, pairs = L.support(h, s, kind, count, scorer, None, 3, shortlist=5, deep=2,
                                        candidates=candidates)
        out["supports"].append({
            "heroes": h, "skills": s, "kind": kind, "count": count, "candidates": candidates,
            "restarts": 3, "shortlist": 5, "deep": 2, "base": number(base),
            "single": [[list(cards), number(value)] for cards, value, _ in single],
            "pairs": [[list(cards), number(value)] for cards, value, _ in pairs]})
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path,
                        help="默认取 .cache/lineup-net/final 里的第一个模型")
    parser.add_argument("--output", type=Path, default=Path("web/public/game-data"))
    parser.add_argument("--fixtures", type=Path,
                        default=Path("web/src/services/__tests__/fixtures/lineupParity.json"))
    args = parser.parse_args()
    torch.set_num_threads(1)
    checkpoint = args.checkpoint or min(Path(".cache/lineup-net/final").glob("model-seed*-fraction1.0.pt"))
    scorer, references = load_scorer(checkpoint)
    binary, meta = export(checkpoint, scorer, references)
    (args.output / "lineup_model.bin").write_bytes(binary)
    (args.output / "lineup_model.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "\n")
    args.fixtures.write_text(json.dumps(fixtures(scorer, references, meta["version"]),
                                        ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Exported {checkpoint} as {meta['version']}: {len(binary)} bytes")


if __name__ == "__main__":
    main()
