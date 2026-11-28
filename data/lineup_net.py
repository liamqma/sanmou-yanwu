"""卡池组三队：只用武将/战法 ID 的神经网络打分器。

运行：uv run --group neural python -m data.lineup_net --help
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from datetime import datetime
import hashlib
from itertools import combinations
import json
import math
import os
from pathlib import Path
import random

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F


@dataclass(frozen=True)
class Roster:
    """一名玩家在一场比赛里上阵的九名武将和十八个战法。"""
    heroes: tuple[str, ...]
    skills: tuple[str, ...]
    teams: tuple[int, ...]
    owners: tuple[int, ...]

    def fingerprint(self):
        # 忽略队序和列表顺序。
        return json.dumps(sorted(
            sorted((hero, sorted(s for s, o in zip(self.skills, self.owners) if o == i))
                   for i, hero in enumerate(self.heroes) if self.teams[i] == team)
            for team in sorted(set(self.teams))), ensure_ascii=False)


@dataclass(frozen=True)
class Game:
    series_id: str
    game_id: str
    rosters: tuple[Roster, Roster]
    winner: int
    team_winners: tuple[int, ...] | None = None

# 队伍：((武将, (战法, 战法)), ...)，三名武将按名字排序；自带战法由武将决定，不单独建模。


def team_of(side):
    if len(side) != 3 or any(len(h["skills"]) != 3 for h in side):
        return None
    team = tuple(sorted((h["name"], tuple(sorted(h["skills"][1:]))) for h in side))
    if len({h for h, _ in team}) != 3 or len({s for _, pair in team for s in pair}) != 6:
        return None
    return team


def roster_teams(roster):
    teams = []
    for t in sorted(set(roster.teams)):
        teams.append(tuple(sorted(
            (hero, tuple(sorted(s for s, o in zip(roster.skills, roster.owners) if o == i)))
            for i, hero in enumerate(roster.heroes) if roster.teams[i] == t)))
    return tuple(teams)


PLAYERS = {}    # (系列, 比赛) -> 两名玩家的 ID，顺序与 Game.rosters 相同


def load_games(directory):
    """带比赛关联的战报按（系列, 比赛）合成完整的三队对局。"""
    groups = defaultdict(list)
    for path in sorted(Path(directory).glob("*.json")):
        raw = json.loads(path.read_text())
        if "match" in raw:
            match = raw["match"]
            groups[match["seriesId"], match["gameId"]].append(raw)
            PLAYERS[match["seriesId"], match["gameId"]] = sorted(
                p["id"] for p in match["players"].values())
    games, incomplete = [], 0
    for (series_id, game_id), rows in sorted(groups.items()):
        numbers = [row["match"]["team"] for row in rows]
        if len(set(numbers)) != len(numbers):
            raise ValueError(f"Duplicate team reports: {series_id}/{game_id}")
        if set(numbers) != {1, 2, 3}:
            incomplete += 1
            continue
        players = sorted(p["id"] for p in rows[0]["match"]["players"].values())
        if len(set(players)) != 2:
            raise ValueError(f"Expected two players: {game_id}")
        sides = [defaultdict(list), defaultdict(list)]
        wins, team_winners = [0, 0], []
        for team, row in enumerate(sorted(rows, key=lambda r: r["match"]["team"])):
            mapping = row["match"]["players"]
            if sorted(p["id"] for p in mapping.values()) != players:
                raise ValueError(f"Players changed inside game: {game_id}")
            if row["winner"] not in ("1", "2"):
                raise ValueError(f"Missing decisive result: {game_id}")
            winner = players.index(mapping[row["winner"]]["id"])
            wins[winner] += 1
            team_winners.append(winner)
            for side_key in ("1", "2"):
                side = sides[players.index(mapping[side_key]["id"])]
                if len(row[side_key]) != 3:
                    raise ValueError(f"Expected three heroes per team: {game_id}")
                for hero in row[side_key]:
                    if len(hero["skills"]) != 3:
                        raise ValueError(f"Incomplete skill slots: {game_id}")
                    owner = len(side["heroes"])
                    side["heroes"].append(hero["name"])
                    side["teams"].append(team)
                    side["skills"].extend(hero["skills"][1:])
                    side["owners"].extend([owner, owner])
        rosters = tuple(Roster(**{key: tuple(values) for key, values in side.items()})
                        for side in sides)
        for roster in rosters:
            if len(set(roster.heroes)) != 9 or len(set(roster.skills)) != 18:
                raise ValueError(f"Repeated/missing deployed resources: {game_id}")
        games.append(Game(series_id, game_id, rosters, int(wins[1] > wins[0]),
                          tuple(team_winners)))
    if not games:
        raise ValueError("No complete three-team games found")
    return games, {"complete_games": len(games), "incomplete_games_skipped": incomplete,
                   "series": len({game.series_id for game in games}),
                   "distinct_deployed_rosters": len({r.fingerprint() for g in games
                                                    for r in g.rosters})}


def split_series(games, seed, fraction=0.2):
    """按系列划分：同一系列、或阵容相同的比赛留在同一侧。"""
    if not 0 < fraction < 1:
        raise ValueError("Validation fraction must be between zero and one")
    parent = list(range(len(games)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    seen = {}
    for i, game in enumerate(games):
        for key in [("series", game.series_id)] + [
                ("roster", roster.fingerprint()) for roster in game.rosters]:
            if key in seen:
                parent[root(i)] = root(seen[key])
            seen[key] = i
    groups = defaultdict(list)
    for i, game in enumerate(games):
        groups[root(i)].append(game)
    if len(groups) < 2:
        raise ValueError("Not enough independent groups for validation")
    stable_groups = [sorted(group, key=lambda game: (game.series_id, game.game_id))
                     for group in groups.values()]
    ordered = sorted(stable_groups, key=lambda group: hashlib.sha256(
        f"{seed}:".encode() + "\n".join(sorted(
            f"{g.series_id}/{g.game_id}" for g in group)).encode()).hexdigest())
    train, validation, validation_groups = [], [], 0
    target = len(games) * fraction
    for group in ordered:
        if abs(len(validation) + len(group) - target) < abs(len(validation) - target):
            validation.extend(group)
            validation_groups += 1
        else:
            train.extend(group)
    if not train or not validation:
        raise ValueError("Unable to make a non-empty grouped validation split")
    return train, validation, {"train_games": len(train), "validation_games": len(validation),
                               "train_groups": len(groups) - validation_groups,
                               "validation_groups": validation_groups}


def canonical(roster):
    """三队按内容排序，同一套阵容换队序后得到同一个 roster_teams。"""
    order = sorted(zip(roster_teams(roster), sorted(set(roster.teams))))
    rank = {old: new for new, (_, old) in enumerate(order)}
    return replace(roster, teams=tuple(rank[t] for t in roster.teams))


def split_games(games, seed, fraction=0.2, mode=None):
    """留出验证玩家的全部阵容，训练一侧只剩其他玩家的阵容。

    mode（或环境变量 LINEUP_SPLIT）：time:日期 留出该日期起的比赛；legacy 为旧的按系列划分。
    """
    mode = mode or os.environ.get("LINEUP_SPLIT", "player")
    if mode == "legacy":
        return split_series(games, seed, fraction)
    train, val, cutoff = [], [], None
    if mode.startswith("time:"):
        cutoff = datetime.fromisoformat(mode[5:]).timestamp()
        for game in games:
            if int(game.game_id) >= cutoff:
                val.append(replace(game, rosters=tuple(map(canonical, game.rosters))))
            else:
                train.append(game)
        players = {p for g in val for p in PLAYERS[g.series_id, g.game_id]}
    elif mode == "player":
        _, picked, _ = split_series(games, seed, fraction)
        players = {p for g in picked for p in PLAYERS[g.series_id, g.game_id]}
        for game in games:
            owners = PLAYERS[game.series_id, game.game_id]
            mine = tuple(canonical(r) for p, r in zip(owners, game.rosters) if p in players)
            rest = tuple(r for p, r in zip(owners, game.rosters) if p not in players)
            if mine:
                val.append(replace(game, rosters=mine))
            if rest:
                train.append(replace(game, rosters=rest))
    else:
        raise ValueError(f"Unknown LINEUP_SPLIT: {mode}")
    if not train or not val:
        raise ValueError("Unable to make a non-empty validation split")
    return train, val, {"split": mode, "train_games": len(train), "validation_games": len(val),
                        "validation_players": len(players), "cutoff": cutoff}


def battle_time(raw):
    if "match" in raw and str(raw["match"]["gameId"]).isdigit():
        return int(raw["match"]["gameId"])
    if raw.get("uploaded_at"):
        return datetime.fromisoformat(raw["uploaded_at"].replace("Z", "+00:00")).timestamp()
    return None


def load_battles(directories, external_rows=()):
    """全部单场战报（含带比赛关联的），按（对阵, 胜方）去重。"""
    battles, seen = [], set()

    def rows():
        for directory in directories:
            for path in sorted(Path(directory).glob("*.json")):
                yield json.loads(path.read_text())
        yield from external_rows

    for raw in rows():
        if raw.get("winner") not in ("1", "2"):
            continue
        a, b = team_of(raw["1"]), team_of(raw["2"])
        if a is None or b is None or a == b:
            continue
        winner = int(raw["winner"]) - 1
        key = (frozenset((a, b)), (a, b)[winner])
        if key in seen:
            continue
        seen.add(key)
        # 第四项：（赛季, 是否来自分组比赛, 时间戳或 None）。
        battles.append((a, b, winner, (raw.get("season"), "match" in raw, battle_time(raw))))
    return battles


def load_external(args):
    from .catalog import load_catalog
    from .yanwu_corpus import load_manifest, load_normalized_corpus, normalized_cache_path
    manifest = load_manifest(args.yanwu_manifest)
    return load_normalized_corpus(
        normalized_cache_path(manifest, args.yanwu_cache_dir), manifest,
        catalog_version=load_catalog(str(args.database))["catalog_version"])["reports"]


MASK = 1
EMPTY = ""      # 卡池不满时的空位：对模型来说就是一张被遮住、还不知道的卡
MEMO_ROWS = 100_000     # 打分器最多留这么多前缀行，超过就清空重来
FORWARD_ROWS = 2048     # 一次前向的行数上限


class Vocab:
    def __init__(self, teams):
        self.heroes = ["<UNK>", "<MASK>", *sorted({h for t in teams for h, _ in t})]
        self.skills = ["<UNK>", "<MASK>", *sorted({s for t in teams for _, pair in t for s in pair})]
        self.h = {n: i for i, n in enumerate(self.heroes)}
        self.s = {n: i for i, n in enumerate(self.skills)}
        self.h[EMPTY] = self.s[EMPTY] = MASK

    def encode(self, teams):
        h = np.array([[self.h.get(x, 0) for x, _ in t] for t in teams], dtype=np.int64)
        s = np.array([[[self.s.get(x, 0) for x in pair] for _, pair in t] for t in teams],
                     dtype=np.int64)
        return h.reshape(-1, 3), s.reshape(-1, 3, 2)


class TeamNet(nn.Module):
    def __init__(self, heroes, skills, width=64, layers=2, dropout=0.1):
        super().__init__()
        self.hero = nn.Embedding(heroes, width)
        self.skill = nn.Embedding(skills, width)
        self.slot = nn.Embedding(3, width)
        self.carrier = nn.Linear(width, width, bias=False)
        self.cls = nn.Parameter(torch.zeros(width))
        self.drop = nn.Dropout(dropout)
        self.encoder = nn.TransformerEncoder(
            nn.TransformerEncoderLayer(width, 4, width * 2, dropout, batch_first=True,
                                       norm_first=True),
            num_layers=layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(width)
        self.hero_bias = nn.Parameter(torch.zeros(heroes))
        self.skill_bias = nn.Parameter(torch.zeros(skills))
        self.strength = nn.Sequential(nn.Linear(width, width), nn.GELU(), nn.Linear(width, 1))
        self.matchup = nn.Sequential(nn.Linear(width * 3, width), nn.GELU(), nn.Linear(width, 1))

    def states(self, h, s):
        slot = self.slot.weight
        hero = self.hero(h)
        # 战法 token 带上携带者的信息；除此之外没有任何人工特征。
        skill = self.skill(s) + self.carrier(hero).unsqueeze(2) + slot[None, :, None]
        x = torch.cat([self.cls.expand(len(h), 1, -1), hero + slot, skill.flatten(1, 2)], 1)
        return self.norm(self.encoder(self.drop(x)))

    def encode(self, h, s):
        return self.states(h, s)[:, 0]

    def predict(self, h, s):
        """被遮住的位置上，对全部武将/战法的 logits（输出层与嵌入共享权重）。"""
        x = self.states(h, s)
        heroes = x[:, 1:4] @ self.hero.weight.T + self.hero_bias
        skills = x[:, 4:] @ self.skill.weight.T + self.skill_bias
        return heroes, skills.unflatten(1, (3, 2))

    def win_logit(self, za, zb):
        def one(x, y):
            return self.matchup(torch.cat([x, y, x * y], -1)).squeeze(-1)
        return (self.strength(za) - self.strength(zb)).squeeze(-1) + (one(za, zb) - one(zb, za)) / 2

    def versus(self, zb):
        """对一组固定的对手，返回 za (n, w) -> win_logit (n, 对手数) 的函数；只与对手有关的部分提前算好。"""
        first, act, last = self.matchup
        wx, wy, wxy = first.weight.split(first.out_features, 1)
        pair = (wxy[None] * zb[:, None]).flatten(0, 1)
        as_x, as_y = zb @ wx.T + first.bias, zb @ wy.T + first.bias
        base = self.strength(zb).squeeze(-1)

        def logit(za):
            cross = (za @ pair.T).unflatten(1, (len(zb), -1))
            ab = last(act((za @ wx.T)[:, None] + as_y + cross)).squeeze(-1)
            ba = last(act(as_x + (za @ wy.T)[:, None] + cross)).squeeze(-1)
            return self.strength(za) - base + (ab - ba) / 2
        return logit


def tensors(*arrays):
    return [torch.from_numpy(a) for a in arrays]


def shuffle_slots(h, s, rng):
    """队内顺序没有含义：随机换位，战法跟着武将走。"""
    order = np.argsort(rng.random(h.shape), axis=1)
    h = np.take_along_axis(h, order, 1)
    s = np.take_along_axis(s, order[:, :, None], 1)
    flip = rng.random(s.shape[:2]) < 0.5
    return h, np.where(flip[:, :, None], s[:, :, ::-1], s)


def reveal_orders(count, rng=None):
    """先按某个顺序揭开三名武将，再揭开六个战法；第一种顺序固定，其余随机。"""
    orders = [np.arange(9)]
    for _ in range(count - 1):
        orders.append(np.concatenate([rng.permutation(3), 3 + rng.permutation(6)]))
    return orders


def sample_masks(n, rng):
    """一半随机遮任意几张，一半遮住某个揭开顺序的后半段（与打分时的输入一致）。"""
    rank = np.argsort(rng.random((n, 9)), axis=1)
    structured = rng.random(n) < 0.5
    hero_first = np.concatenate([np.argsort(rng.random((n, 3)), 1),
                                 3 + np.argsort(rng.random((n, 6)), 1)], 1)
    order = np.where(structured[:, None], hero_first, rank)
    visible = rng.integers(0, 9, n)
    mask = np.zeros((n, 9), bool)
    np.put_along_axis(mask, order, np.arange(9)[None] >= visible[:, None], 1)
    return mask[:, :3], mask[:, 3:].reshape(n, 3, 2)


def joint_log_likelihood(model, h, s, orders):
    """log P(队伍)：按顺序逐张揭开，每张卡在“只看到已揭开的卡”时的 log 概率之和。
    空位始终遮着，也不计分。"""
    th, ts = tensors(h, s)
    present = torch.from_numpy(np.concatenate([h, s.reshape(len(h), 6)], 1) != MASK)
    total = torch.zeros(len(h))
    for order in orders:
        for step, position in enumerate(order):
            if not present[:, position].any():
                continue
            mask = np.zeros(9, bool)
            mask[order[step:]] = True
            mh, ms = mask[:3], mask[3:].reshape(3, 2)
            heroes, skills = model.predict(*tensors(np.where(mh, MASK, h), np.where(ms, MASK, s)))
            if position < 3:
                value = heroes[:, position].log_softmax(-1).gather(
                    -1, th[:, position, None]).squeeze(-1)
            else:
                i, a = divmod(position - 3, 2)
                value = skills[:, i, a].log_softmax(-1).gather(-1, ts[:, i, a, None]).squeeze(-1)
            total += value * present[:, position]
    return total / len(orders)


def single_moves():
    """满编名单上 search() 的全部单步动作，写成位置置换：(198, 9) 武将位、(198, 18) 战法位。"""
    h0, s0, out = np.arange(9), np.arange(18), []
    for p in range(9):
        for q in range(p + 1, 9):
            if p // 3 != q // 3:
                h, s = h0.copy(), s0.copy()
                h[[p, q]] = q, p
                s[[2 * p, 2 * p + 1, 2 * q, 2 * q + 1]] = 2 * q, 2 * q + 1, 2 * p, 2 * p + 1
                out += [(h, s0), (h, s)]      # 只换武将（战法留在原位）；连同战法一起换
    for p in range(18):
        for q in range(p + 1, 18):
            if p // 2 != q // 2:
                s = s0.copy()
                s[[p, q]] = q, p
                out.append((h0, s))
    return np.array([h for h, _ in out]), np.array([s for _, s in out])


def team_log_likelihood(model, h, s, chunk=2048):
    """可导的 log P(队伍)，数值上等于 joint_log_likelihood 的固定顺序（搜索打分用的那一种）：
    第 k 步只看到前 k 张卡，空位一直遮着也不计分。多支队伍共有的（输入, 位置, 目标）只前向一次。"""
    out = []
    for start in range(0, len(h), chunk):
        cards = np.concatenate([h[start:start + chunk], s[start:start + chunk].reshape(-1, 6)], 1)
        rows = np.concatenate([
            np.where(np.arange(9) >= np.arange(9)[:, None], MASK, cards[:, None]),
            np.broadcast_to(np.arange(9)[:, None], (len(cards), 9, 1)), cards[:, :, None]], 2)
        present = torch.from_numpy(cards != MASK)
        rows, inverse = np.unique(rows[cards != MASK], axis=0, return_inverse=True)
        step, target = tensors(rows[:, 9], rows[:, 10])
        x = model.states(*tensors(rows[:, :3], rows[:, 3:9].reshape(-1, 3, 2)))
        x, hero = x[torch.arange(len(rows)), 1 + step], step < 3
        value = torch.zeros(len(rows))
        value[hero] = -F.cross_entropy(x[hero] @ model.hero.weight.T + model.hero_bias,
                                       target[hero], reduction="none")
        value[~hero] = -F.cross_entropy(x[~hero] @ model.skill.weight.T + model.skill_bias,
                                        target[~hero], reduction="none")
        total = torch.zeros(present.shape)
        total[present] = value[torch.from_numpy(inverse.reshape(-1))]
        out.append(total.sum(1))
    return torch.cat(out)


def lineup_log_likelihood(model, h, s):
    """若干摆法（h (..., 9)、s (..., 18)，每三名武将一队）的三队 log P 之和；相同的队伍只算一次。
    同时返回每个摆法排序后的三个队伍编号：编号相同就是同一个摆法（整队换位也算相同）。"""
    th, ts = h.reshape(-1, 3), np.sort(s.reshape(-1, 3, 2), 2)
    # 与 canon() 同序：按（武将, 战法对）排。词表按名字排序、空位的 id 最小，所以比 id 就是比名字。
    order = np.lexsort((ts[:, :, 1], ts[:, :, 0], th), 1)
    rows = np.concatenate([np.take_along_axis(th, order, 1),
                           np.take_along_axis(ts, order[:, :, None], 1).reshape(-1, 6)], 1)
    teams, inverse = np.unique(rows, axis=0, return_inverse=True)
    value = team_log_likelihood(model, teams[:, :3], teams[:, 3:].reshape(-1, 3, 2))
    inverse = inverse.reshape(*h.shape[:-1], 3)
    return value[torch.from_numpy(inverse)].sum(-1), np.sort(inverse, -1)


class LineupRanker:
    """分组排序损失：同一名玩家的 27 张卡，他实际的摆法要比邻近摆法得分高（对候选做 softmax）。
    分数就是搜索比较的三队 log P 之和。卡相同时出场率先验是常数，不必加；强度项来自另一份
    权重（胜负头），加进来会让胜负头去学“玩家怎么摆”而不是“谁赢”，所以也不加。"""

    def __init__(self, rosters, vocab, dev, args, seed):
        h, s = vocab.encode([t for r in rosters for t in r])
        self.cards = [h.reshape(-1, 9), s.reshape(-1, 18)]
        assert min(x.min() for x in self.cards) > MASK
        self.fit, self.dev = np.flatnonzero(~dev), np.flatnonzero(dev)
        self.moves = single_moves()
        self.logq = np.zeros((len(rosters), len(self.moves[0])))      # 单步邻居的抽样权重（对数）
        self.args, self.rng = args, np.random.default_rng([seed, 1])

    def loss(self, model):
        a, n = self.args, min(self.args.group_rosters, len(self.fit))
        pick = self.rng.choice(self.fit, size=n, replace=False)
        # 每份名单随机藏掉一部分卡，当作还没拿到的空位（选卡阶段就是这种局面）：
        # 同一份名单每次比的东西都不一样，模型没法靠背下整支队伍过关。
        rate = self.rng.uniform(0, a.group_hide, (n, 1))
        cards = [np.where(self.rng.random((n, x.shape[1])) < rate, MASK, x[pick])
                 for x in self.cards]
        # 按权重不放回地抽 K 个单步邻居（Gumbel top-k）；空位换空位的不抽。
        idle = np.logical_and(*((x[:, m] == x[:, None]).all(2) for x, m in zip(cards, self.moves)))
        weight = np.where(idle, -np.inf, self.logq[pick]) + self.rng.gumbel(size=idle.shape)
        move = np.argsort(-weight, 1)[:, :a.group_negatives]
        value, ids = lineup_log_likelihood(model, *(
            np.concatenate([x[:, None], np.take_along_axis(x[:, None], m[move], 2)], 1)
            for x, m in zip(cards, self.moves)))
        same = torch.from_numpy((ids == ids[:, :1]).all(-1))      # 与真实摆法相同（含整队换位）的不算负例
        same[:, 0] = False
        return F.cross_entropy(value.masked_fill(same, float("-inf")) / a.group_temperature,
                               torch.zeros(n, dtype=torch.long))

    @torch.inference_mode()
    def mine(self, model):
        """无梯度地给每份名单的全部单步邻居打分，更新抽样权重：一半按当前模型的偏好
        （它越觉得好的错误摆法越常被抽到），一半均匀。
        返回拟合名单、验证名单上“真实摆法对全部单步邻居”的损失。"""
        value, _ = lineup_log_likelihood(model, *(
            np.concatenate([x[:, None], x[:, m]], 1) for x, m in zip(self.cards, self.moves)))
        value = value / self.args.group_temperature
        self.logq = torch.log(0.5 * value[:, 1:].softmax(1) + 0.5 / self.logq.shape[1]).numpy()
        loss = -value.log_softmax(1)[:, 0].numpy()
        return float(loss[self.fit].mean()), float(loss[self.dev].mean()) if len(self.dev) else 0.0


def train(teams_count, battles, args, seed, log=print, rosters=()):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    teams = sorted(teams_count)
    vocab = Vocab(teams)
    th, ts = vocab.encode(teams)
    weight = np.array([1 + math.log2(teams_count[t]) for t in teams])
    # 赛季衰减：每早一个赛季，抽样权重乘一次 season_decay（1 表示不衰减）。
    decay = getattr(args, "season_decay", 1.0)
    season = {}
    for a, b, _, (s, *_) in battles:
        for t in (a, b):
            season[t] = max(season.get(t, 0), s or 0)
    latest = max(season.values(), default=0)
    weight = weight * np.array([decay ** (latest - season[t]) for t in teams])
    battle_weight = np.array([decay ** (latest - (s or 0)) for _, _, _, (s, *_) in battles])
    order = rng.permutation(len(teams))
    dev, fit = order[:len(teams) // 10], order[len(teams) // 10:]
    index = {t: i for i, t in enumerate(teams)}
    ba = np.array([index[a] for a, _, _, _ in battles])
    bb = np.array([index[b] for _, b, _, _ in battles])
    by = np.array([float(w == 0) for _, _, w, _ in battles], dtype=np.float32)
    dev_set = set(dev.tolist())
    b_dev = np.array([a in dev_set or b in dev_set for a, b in zip(ba, bb)])
    b_fit = np.flatnonzero(~b_dev)
    ranker, history = None, []
    if len(rosters) and args.group_weight > 0:
        # 含验证队伍的名单不进排序损失（否则 dev_fill 不再是留出指标），只用来监控。
        roster_dev = np.array([any(index[t] in dev_set for t in r) for r in rosters])
        if not roster_dev.all():
            ranker = LineupRanker(rosters, vocab, roster_dev, args, seed)

    model = TeamNet(len(vocab.heroes), len(vocab.skills), args.width, args.layers, args.dropout)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate,
                                  weight_decay=args.weight_decay)
    batches = math.ceil(len(fit) / args.batch_size)
    schedule = torch.optim.lr_scheduler.OneCycleLR(optimizer, args.learning_rate,
                                                   total_steps=args.epochs * batches)

    def dev_loss():
        model.eval()
        with torch.inference_mode():
            fill = -joint_log_likelihood(model, th[dev], ts[dev], reveal_orders(1)).mean().item()
            win = 0.0
            if b_dev.any():
                za = model.encode(*tensors(th[ba[b_dev]], ts[ba[b_dev]]))
                zb = model.encode(*tensors(th[bb[b_dev]], ts[bb[b_dev]]))
                win = F.binary_cross_entropy_with_logits(
                    model.win_logit(za, zb), torch.from_numpy(by[b_dev])).item()
        return fill, win

    def hide_unknown(h, s):
        # 少量卡换成 <UNK>，让没见过的卡有一个中性表示。
        return (np.where(rng.random(h.shape) < args.unknown_rate, 0, h),
                np.where(rng.random(s.shape) < args.unknown_rate, 0, s))

    # 搭配和胜负两个目标过拟合的时间点不同，各自保留验证最优的权重。
    def partly_hidden(h, s):
        # 一半的样本遮掉若干张卡：胜负头学会给没配齐的队伍估强度。
        h, s = hide_unknown(h, s)
        mh, ms = sample_masks(len(h), rng)
        use = rng.random(len(h)) < 0.5
        return (np.where(use[:, None] & mh, MASK, h), np.where(use[:, None, None] & ms, MASK, s))

    best = {"fill": (float("inf"), None, 0), "win": (float("inf"), None, 0)}
    fit_p = weight[fit] / weight[fit].sum()
    for epoch in range(1, args.epochs + 1):
        model.train()
        group_total, ranking = 0.0, ranker and epoch > args.group_start * args.epochs
        for _ in range(batches):
            pick = rng.choice(fit, size=args.batch_size, p=fit_p)
            h, s = shuffle_slots(th[pick], ts[pick], rng)
            mh, ms = sample_masks(len(h), rng)
            uh, us = hide_unknown(h, s)
            heroes, skills = model.predict(*tensors(np.where(mh, MASK, uh), np.where(ms, MASK, us)))
            tmh, tms, yh, ys = tensors(mh, ms, h, s)
            # 每个样本按被遮张数取平均，各种遮挡数量权重相同。
            share = torch.from_numpy(1 / (mh.sum(1) + ms.sum((1, 2)))).float()
            loss = ((F.cross_entropy(heroes[tmh], yh[tmh], reduction="none")
                     * share[:, None].expand(-1, 3)[tmh]).sum()
                    + (F.cross_entropy(skills[tms], ys[tms], reduction="none")
                       * share[:, None, None].expand(-1, 3, 2)[tms]).sum()) / len(h)
            if len(b_fit) and args.win_weight > 0:
                sample = (rng.choice(b_fit, size=args.batch_size) if decay == 1 else
                          rng.choice(b_fit, size=args.batch_size,
                                     p=battle_weight[b_fit] / battle_weight[b_fit].sum()))
                flip = rng.random(args.batch_size) < 0.5
                left = np.where(flip, bb[sample], ba[sample])
                right = np.where(flip, ba[sample], bb[sample])
                target = np.where(flip, 1 - by[sample], by[sample]).astype(np.float32)
                za = model.encode(*tensors(*partly_hidden(*shuffle_slots(th[left], ts[left], rng))))
                zb = model.encode(*tensors(*partly_hidden(*shuffle_slots(th[right], ts[right], rng))))
                loss = loss + args.win_weight * F.binary_cross_entropy_with_logits(
                    model.win_logit(za, zb), torch.from_numpy(target))
            if ranking:
                group = ranker.loss(model)
                loss = loss + args.group_weight * group
                group_total += group.item()
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
        fill, win = dev_loss()
        line = f"epoch={epoch:02d} dev_fill={fill:.4f} dev_win={win:.4f}"
        if ranker:
            line += f" group={group_total / batches:.4f}" if ranking else ""
            if args.group_mine and (epoch % args.group_mine == 0 or epoch == args.epochs):
                history.append([epoch, *ranker.mine(model)])
                line += " group_all=%.4f dev_group=%.4f" % tuple(history[-1][1:])
        log(line)
        for key, value in (("fill", fill), ("win", win)):
            if value < best[key][0]:
                best[key] = (value, {k: v.clone() for k, v in model.state_dict().items()}, epoch)
    model.load_state_dict(best["fill"][1])
    model.eval()
    judge = TeamNet(len(vocab.heroes), len(vocab.skills), args.width, args.layers, args.dropout)
    judge.load_state_dict(best["win"][1])
    judge.eval()
    info = {"fill_epoch": best["fill"][2], "win_epoch": best["win"][2],
            "dev_fill": best["fill"][0], "dev_win": best["win"][0]}
    if ranker:      # history：[轮次, 拟合名单, 验证名单] 上真实摆法对全部单步邻居的损失
        info["group"] = {"rosters": len(ranker.fit), "dev_rosters": len(ranker.dev),
                         "history": history}
    return model, judge, vocab, info


class NeuralScorer:
    """队伍分 = log P(队伍) − prior_weight × Σ log(各卡出场率)
    + strength_weight × 对参考对手平均胜率的 logit。"""
    guide = None      # 设成 Guide 后，search 走快速搜索

    def __init__(self, model, vocab, teams_count, judge=None, references=(), strength_weight=0.0,
                 prior_weight=1.0):
        self.model, self.vocab, self.strength_weight = model, vocab, strength_weight
        self.judge = judge or model
        self.prior_weight = prior_weight
        self.out_weight = torch.cat([model.hero.weight, model.skill.weight]).detach()
        self.out_bias = torch.cat([model.hero_bias, model.skill_bias]).detach()
        # 前缀行（已揭开的卡 + 步骤）-> table 里的行号；每行是该位置的隐藏向量和归一化常数。
        self.memo, self.used = {}, 0
        self.table = torch.empty(0, self.out_weight.shape[1] + 1)
        hero, skill = np.ones(len(vocab.heroes)), np.ones(len(vocab.skills))
        for team, n in teams_count.items():
            w = 1 + math.log2(n)
            for name, pair in team:
                hero[vocab.h[name]] += w
                for x in pair:
                    skill[vocab.s[x]] += w
        self.hero_prior = torch.from_numpy(np.log(hero / hero.sum())).float()
        self.skill_prior = torch.from_numpy(np.log(skill / skill.sum())).float()
        self.hero_prior[MASK] = self.skill_prior[MASK] = 0
        self.versus = None
        if references and strength_weight:
            with torch.inference_mode():
                self.versus = self.judge.versus(
                    self.judge.encode(*tensors(*vocab.encode(list(references)))))

    def log_likelihood(self, h, s):
        """log P(队伍)：按固定顺序逐张揭开，每张卡在“只看到前面的卡”时的 log 概率之和，
        空位始终遮着也不计分。相同的（已揭开的卡, 步骤）只前向一次；最后一步之外的留给后面的调用。"""
        cards, step, heroes = np.concatenate([h, s.reshape(-1, 6)], 1), np.arange(9), len(self.vocab.heroes)
        rows = np.concatenate([np.where(step >= step[:, None], MASK, cards[:, None]),
                               np.broadcast_to(step[:, None], (len(cards), 9, 1))], 2)
        team, at = np.nonzero(cards != MASK)
        rows, inverse = np.unique(rows[team, at], axis=0, return_inverse=True)
        if self.used > MEMO_ROWS:
            self.memo, self.used = {}, 0
        keys = [row.tobytes() for row in rows.astype(np.int16)]
        index = np.array([self.memo.get(key, -1) for key in keys], dtype=np.int64)
        state = torch.empty(len(rows), self.table.shape[1])
        new = np.flatnonzero(index < 0)
        state[torch.from_numpy(index >= 0)] = self.table[torch.from_numpy(index[index >= 0])]
        for part in (new[i:i + FORWARD_ROWS] for i in range(0, len(new), FORWARD_ROWS)):
            x = self.model.states(*tensors(rows[part, :3], rows[part, 3:9].reshape(-1, 3, 2)))
            x = x[torch.arange(len(part)), torch.from_numpy(1 + rows[part, 9])]
            logits = x @ self.out_weight.T + self.out_bias
            norm = torch.where(torch.from_numpy(rows[part, 9] < 3),
                               logits[:, :heroes].logsumexp(1), logits[:, heroes:].logsumexp(1))
            state[torch.from_numpy(part)] = torch.cat([x, norm[:, None]], 1)
        keep = new[rows[new, 9] < 8]
        if self.used + len(keep) > len(self.table):
            self.table = torch.cat([self.table, torch.empty(max(len(self.table), len(keep), 4096),
                                                            self.table.shape[1])])
        self.table[self.used:self.used + len(keep)] = state[torch.from_numpy(keep)]
        self.memo.update(zip((keys[i] for i in keep), range(self.used, self.used + len(keep))))
        self.used += len(keep)
        state = state[torch.from_numpy(inverse.reshape(-1))]
        target = torch.from_numpy(cards[team, at] + (at >= 3) * heroes)
        value = (state[:, :-1] * self.out_weight[target]).sum(1) + self.out_bias[target] - state[:, -1]
        return torch.zeros(len(cards)).index_add_(0, torch.from_numpy(team), value)

    @torch.inference_mode()
    def __call__(self, teams):
        out = []
        for start in range(0, len(teams), 4096):
            h, s = self.vocab.encode(teams[start:start + 4096])
            th, ts = tensors(h, s)
            prior = self.hero_prior[th].sum(1) + self.skill_prior[ts].sum((1, 2))
            value = self.log_likelihood(h, s) - self.prior_weight * prior
            if self.versus is not None:
                chance = torch.sigmoid(self.versus(self.judge.encode(th, ts))).mean(1)
                value = value + self.strength_weight * torch.logit(chance.clamp(1e-4, 1 - 1e-4))
            out.append(value.numpy())
        return np.concatenate(out) if out else np.zeros(0)

    @torch.inference_mode()
    def win_probability(self, a, b):
        za = self.judge.encode(*tensors(*self.vocab.encode(a)))
        zb = self.judge.encode(*tensors(*self.vocab.encode(b)))
        return torch.sigmoid(self.judge.win_logit(za, zb)).numpy()


class CountScorer:
    """对照组：只数共现次数（武将-武将、武将-所带战法、同队战法-战法）的 PMI 之和。"""
    guide = None

    def __init__(self, teams_count, smoothing=2.0):
        self.a = smoothing
        self.single, self.pair = Counter(), Counter()
        self.total = 0.0
        for team, n in teams_count.items():
            w = 1 + math.log2(n)
            self.total += w
            for token in self.tokens(team):
                self.single[token] += w
            for key in self.pairs(team):
                self.pair[key] += w

    @staticmethod
    def tokens(team):
        return [("H", h) for h, _ in team if h] + [("S", s) for _, pair in team for s in pair if s]

    @staticmethod
    def pairs(team):
        heroes = [h for h, _ in team if h]
        skills = [s for _, pair in team for s in pair if s]
        out = [("HH", *sorted((x, y))) for i, x in enumerate(heroes) for y in heroes[i + 1:]]
        out += [("HS", h, s) for h, pair in team for s in pair if h and s]
        out += [("SS", *sorted((x, y))) for i, x in enumerate(skills) for y in skills[i + 1:]]
        return out

    def __call__(self, teams):
        out = np.zeros(len(teams))
        for n, team in enumerate(teams):
            for key in self.pairs(team):
                kind = key[0]
                x, y = (kind[0], key[1]), (kind[1], key[2])
                expected = self.single[x] * self.single[y] / self.total
                out[n] += math.log((self.pair[key] + self.a) / (expected + self.a))
        return out


class Guide:
    """快速搜索用的估计，全部来自模型自己的条件分布（不含强度项）：
    gains 估每个单步动作的收益，starts 直接给出不靠随机的起点。"""
    top, patience = 8, 32      # 每步先给估计最好的 top 个动作精确打分；看完 patience 个都没有提升就停
    pairs = [(p, q) for p in range(3, 9) for q in range(p + 1, 9) if (p - 3) // 2 != (q - 3) // 2]

    def __init__(self, scorer):
        self.scorer, self.cache, self.groups = scorer, {}, {}
        self.prior = scorer.prior_weight * torch.cat([scorer.hero_prior, scorer.skill_prior]).numpy()
        # 每支队伍前向 24 行：遮一个位置（9 行）、遮同队两名武将各一个战法（12 行）、遮一名武将和他的两个战法（3 行）。
        self.masks = np.zeros((24, 9), bool)
        self.masks[np.arange(9), np.arange(9)] = True
        for n, (p, q) in enumerate(self.pairs):
            self.masks[9 + n, [p, q]] = True
        for n in range(3):
            self.masks[21 + n, [n, 3 + 2 * n, 4 + 2 * n]] = True

    @torch.inference_mode()
    def tables(self, heroes, skills):
        """一支队伍（3 名武将、6 个战法，按摆法里的位置）各位置换成每张卡的 log 概率；
        卡的编号是武将在前、战法在后的合并编号。one：只遮这一位；two[p, q]：p、q 同遮时 p 位的；
        block：这一位所在的“武将 + 两个战法”整块遮住时的。"""
        key = (tuple(heroes), tuple(skills))
        if key not in self.cache:
            if len(self.cache) > 512:
                self.cache.clear()
            vocab = self.scorer.vocab
            cards = np.array([vocab.h.get(x, 0) for x in heroes] + [vocab.s.get(x, 0) for x in skills])
            rows = np.where(self.masks, MASK, cards)
            hero, skill = self.scorer.model.predict(*tensors(rows[:, :3], rows[:, 3:].reshape(-1, 3, 2)))
            hero, skill = hero.log_softmax(-1), skill.flatten(1, 2).log_softmax(-1)
            hero[:, :, MASK] = skill[:, :, MASK] = 0      # 空位不计分
            logp = torch.cat([F.pad(hero, (0, skill.shape[-1])), F.pad(skill, (hero.shape[-1], 0))], 1).numpy()
            two, slot = np.zeros((9, 9, logp.shape[-1]), np.float32), np.arange(9)
            for n, (p, q) in enumerate(self.pairs):
                two[p, q], two[q, p] = logp[9 + n, p], logp[9 + n, q]
            self.cache[key] = {"one": logp[slot, slot], "two": two,
                               "block": logp[21 + np.where(slot < 3, slot, (slot - 3) // 2), slot]}
        return self.cache[key]

    def gains(self, h, s, options):
        vocab, prior = self.scorer.vocab, self.prior
        ids = [vocab.h.get(x, 0) for x in h] + [len(vocab.heroes) + vocab.s.get(x, 0) for x in s]
        t = [self.tables(h[3 * n:3 * n + 3], s[6 * n:6 * n + 6]) for n in range(3)]

        def gain(table, x, y):      # x、y：(队, 队内位置, 卡)。两位互换；y 在替补席时队为 None
            (tx, sx, cx), (ty, sy, cy) = x, y
            if ty is None:
                return t[tx][table][sx, cy] - t[tx][table][sx, cx] - prior[cy] + prior[cx]
            if table == "two":
                return (t[tx][table][sx, sy, cy] - t[tx][table][sx, sy, cx]
                        + t[tx][table][sy, sx, cx] - t[tx][table][sy, sx, cy])
            return (t[tx][table][sx, cy] - t[tx][table][sx, cx]
                    + t[ty][table][sy, cx] - t[ty][table][sy, cy])

        def hero(p):
            return (p // 3 if p < 9 else None, p % 3, ids[p])

        def skill(p):
            return (p // 6 if p < 18 else None, 3 + p % 6, ids[len(h) + p])

        out = []
        for kind, p, q, block in options:
            if kind == "S":
                out.append(gain("two" if q < 18 and p // 6 == q // 6 else "one", skill(p), skill(q)))
            elif block:
                out.append(gain("block", hero(p), hero(q)) + sum(
                    gain("block", skill(2 * p + k), skill(2 * q + k)) for k in range(2)))
            else:
                out.append(gain("one", hero(p), hero(q)))
        return np.array(out)

    @torch.inference_mode()
    def starts(self, heroes, skills, scorer, count, carried=False):
        """只看武将给每个三人组打分（战法全遮住），枚举三队互不重叠的分法，取最好的 count 个；
        每个分法再按“只看武将时各位置对每个战法的偏好”贪心发战法。武将不足九名时队里留空位；
        carried 时战法只发给有武将的位置。"""
        pool = sorted(x for x in heroes if x != EMPTY)
        cards = [x for x in skills if x != EMPTY]
        vocab, field = self.scorer.vocab, min(len(pool), 9)
        groups = [(*g, *[EMPTY] * (3 - n)) for n in range(max(0, field - 6), 4) for g in combinations(pool, n)]
        new = [g for g in groups if (scorer, g) not in self.groups]
        self.groups.update(zip(((scorer, g) for g in new),
                               scorer([tuple(sorted((x, (EMPTY, EMPTY)) for x in g)) for g in new])))
        score = np.array([self.groups[scorer, g] for g in groups])
        keep = np.argsort(-score, kind="stable")[:150]
        groups, score = [groups[n] for n in keep], score[keep]
        bit = {x: 1 << n for n, x in enumerate(pool)}
        mask = np.array([sum(bit[x] for x in g if x != EMPTY) for g in groups])
        i, j = np.nonzero(np.triu((mask[:, None] & mask) == 0, 1))
        both = (mask[i] | mask[j])[:, None]
        free = (both & mask == 0) & (np.arange(len(groups)) > j[:, None])
        if len(pool) < 9:      # 武将全部上阵
            free &= both | mask == sum(bit.values())
        total = np.where(free, (score[i] + score[j])[:, None] + score, -np.inf).ravel()
        count = min(count, int(free.sum()))
        best = np.argpartition(-total, count - 1)[:count] if count > 0 else []
        ids = np.array([vocab.s.get(x, 0) for x in cards], dtype=np.int64)
        out = []
        for n in sorted(best, key=lambda n: (-total[n], n)):
            pair, k = divmod(int(n), len(groups))
            h = [x for t in (i[pair], j[pair], k) for x in groups[t]]
            _, wish = self.scorer.model.predict(torch.tensor([vocab.h.get(x, 0) for x in h]).view(3, 3),
                                                torch.full((3, 3, 2), MASK))
            wish = wish.log_softmax(-1).view(18, -1).numpy()[:, ids] - self.prior[len(vocab.heroes) + ids]
            s, used = [EMPTY] * 18, set()
            for m in np.argsort(-wish, axis=None, kind="stable"):
                slot, card = divmod(int(m), len(cards))
                if s[slot] == EMPTY and card not in used and not (carried and h[slot // 2] == EMPTY):
                    s[slot] = cards[card]
                    used.add(card)
            out.append((h + [x for x in pool if x not in h],
                        s + [x for m, x in enumerate(cards) if m not in used]))
        return out


def canon(heroes, skills):
    return tuple(sorted((heroes[i], tuple(sorted(skills[2 * i:2 * i + 2]))) for i in range(3)))


def lineup_teams(heroes, skills):
    return tuple(canon(heroes[3 * t:3 * t + 3], skills[6 * t:6 * t + 6]) for t in range(3))


def moves(h, s, fixed=((), ())):
    """全部单步动作 (类型, p, q, 是否带着战法)：两名武将换位、两个战法换位；q 可以在替补席。
    fixed 是（武将位, 战法位）两个集合，这些位置上的卡不动。"""
    fixed_h, fixed_s = fixed
    for p in range(9):
        for q in range(p + 1, len(h)):
            if (q < 9 and p // 3 == q // 3) or h[p] == h[q] or p in fixed_h or q in fixed_h:
                continue
            yield "H", p, q, False
            # 武将连同两个战法一起换队
            if q < 9 and not any(x in fixed_s for x in (2 * p, 2 * p + 1, 2 * q, 2 * q + 1)):
                yield "H", p, q, True
    for p in range(18):
        for q in range(p + 1, len(s)):
            if (q < 18 and p // 2 == q // 2) or s[p] == s[q] or p in fixed_s or q in fixed_s:
                continue
            yield "S", p, q, False


def orphans(move, h, s):
    """这一步会不会让战法落在没有武将的位置上。"""
    kind, p, q, block = move
    if kind == "S":
        return (h[p // 2] == EMPTY and s[q] != EMPTY) or (q < 18 and h[q // 2] == EMPTY and s[p] != EMPTY)
    if block or q >= 9:
        return False
    return any(h[b] == EMPTY and s[2 * a + k] != EMPTY for a, b in ((p, q), (q, p)) for k in range(2))


def carried_only(h, s):
    """没有武将的位置上的战法挪到替补席。"""
    s = list(s)
    for p in range(18):
        if h[p // 2] == EMPTY and s[p] != EMPTY:
            s.append(s[p])
            s[p] = EMPTY
    return list(h), s


def apply(move, h, s):
    kind, p, q, block = move
    h, s = list(h), list(s)
    if kind == "S":
        s[p], s[q] = s[q], s[p]
    else:
        h[p], h[q] = h[q], h[p]
        if block:
            s[2 * p:2 * p + 2], s[2 * q:2 * q + 2] = s[2 * q:2 * q + 2], s[2 * p:2 * p + 2]
    return h, s


def search(pool_heroes, pool_skills, scorer, rng, restarts=8, cache=None, starts=(), fixed=None,
           carried=False):
    """爬山搜索：九个武将位、十八个战法位，其余在替补席；卡不够时用空位补齐。
    每步取最优邻居。返回（分数, 三队, 摆法），摆法可以作为下一次搜索的起点。
    打分器带 guide 时是快速搜索：随机起点换成 guide 给的起点（不用随机数，起点不够就少搜几次），
    每步只对估计最好的几个动作精确打分。
    fixed（见 moves）不为空时只从 starts 出发，固定位置上的卡不动。
    carried 时战法必须有武将带着：武将不够时多出来的战法留在替补席，不放进没有武将的位置。"""
    cache = {} if cache is None else cache
    heroes = list(pool_heroes) + [EMPTY] * max(0, 9 - len(pool_heroes))
    skills = list(pool_skills) + [EMPTY] * max(0, 18 - len(pool_skills))
    guide = scorer.guide

    def values(states):
        keys = [lineup_teams(h, s) for h, s in states]
        missing = list({t for key in keys for t in key if t not in cache})
        if missing:
            cache.update(zip(missing, scorer(missing).tolist()))
        return [sum(cache[t] for t in key) for key in keys]

    initial = [(list(h), list(s)) for h, s in starts]
    if guide and fixed is None:
        if restarts:
            initial += guide.starts(heroes, skills, scorer, restarts, carried)
        if not initial:
            initial.append(carried_only(heroes, skills) if carried else (heroes, skills))
    elif fixed is None:
        for _ in range(restarts + len(starts) - len(initial)):
            initial.append(([heroes[i] for i in rng.permutation(len(heroes))],
                            [skills[i] for i in rng.permutation(len(skills))]))
    best = None
    for h, s in initial:
        value = values([(h, s)])[0]
        while True:
            options = [m for m in moves(h, s, fixed or ((), ())) if not (carried and orphans(m, h, s))]
            order, size = np.arange(len(options)), max(len(options), 1)
            if guide and options:
                order, size = np.argsort(-guide.gains(h, s, options), kind="stable")[:guide.patience], guide.top
            for start in range(0, len(order), size):
                states = [apply(options[n], h, s) for n in order[start:start + size]]
                scores = values(states)
                top = int(np.argmax(scores))
                if scores[top] > value + 1e-9:
                    break
            else:
                break
            (h, s), value = states[top], scores[top]
        if best is None or value > best[0]:
            best = (value, lineup_teams(h, s), (h, s))
    return best


def best_lineup(pool_heroes, pool_skills, scorer, rng, restarts=8, cache=None, carried=False):
    value, lineup, _ = search(pool_heroes, pool_skills, scorer, rng, restarts, cache, carried=carried)
    return value, lineup


def fill(layout_heroes, layout_skills, pool_heroes, pool_skills, scorer, cache=None, restarts=4):
    """手动摆好的卡不动，卡池里其余的卡由搜索填进空位，战法只给有武将的位置。
    layout_heroes 九个武将位、layout_skills 十八个战法位，空位写 EMPTY。返回值同 search。
    起点：其余的卡按顺序发进空位（卡够就不留空位），每个起点把发牌顺序轮转一位。"""
    fixed = ({p for p in range(9) if layout_heroes[p] != EMPTY},
             {p for p in range(18) if layout_skills[p] != EMPTY})
    spare = [[x for x in pool if x not in layout]
             for pool, layout in ((pool_heroes, layout_heroes), (pool_skills, layout_skills))]
    starts = []
    for r in range(restarts):
        h, s = (x[r % len(x):] + x[:r % len(x)] if x else x for x in spare)
        starts.append(add_cards(*add_cards(layout_heroes, layout_skills, h, "hero"), s, "skill", True))
    return search([], [], scorer, None, 0, cache, starts, fixed, True)


def add_cards(h, s, cards, kind, carried=False):
    """把新卡放进一个摆法：先填空位，没有空位就先放替补席。carried 时战法只填有武将的空位。"""
    h, s = list(h), list(s)
    items, slots = (h, 9) if kind == "hero" else (s, 18)
    for card in cards:
        free = [p for p in range(slots) if items[p] == EMPTY and not (carried and h[p // 2] == EMPTY)]
        if free:
            items[free[0]] = card
        else:
            items.append(card)
    return h, s


def pick(heroes, skills, options, kind, scorer, rng, restarts=2, cache=None):
    """三选一：每个候选组加进当前卡池后各搜一次最优阵容，分数最高的就是推荐。
    搜索从当前卡池的最优摆法出发，所以推荐是在现有组队的基础上做的。"""
    cache = {} if cache is None else cache
    _, _, (base_h, base_s) = search(heroes, skills, scorer, rng, restarts, cache)
    results = []
    for option in options:
        value, lineup, _ = search([], [], scorer, rng, 0, cache,
                                  [add_cards(base_h, base_s, option, kind)])
        results.append((value, lineup))
    return results


def deepen(results, heroes, skills, options, kind, scorer, rng, restarts, cache):
    """三选一加深：每个候选组的卡池再从随机摆法搜几次，找到更好的阵容就换上。
    只从现有摆法出发的爬山常停在差几分的局部最优，而候选组之间往往也只差几分。"""
    better = []
    for option, found in zip(options, results):
        h, s = ([*heroes, *option], skills) if kind == "hero" else (heroes, [*skills, *option])
        better.append(max(found, search(h, s, scorer, rng, restarts, cache)[:2],
                          key=lambda r: r[0]))
    return better


def known_cards(scorer, kind):
    """打分器认识的全部武将或战法（多个模型取交集），按名字排序。"""
    parts = [part for part, _ in scorer.parts] if hasattr(scorer, "parts") else [scorer]
    names = [set((part.vocab.heroes if kind == "hero" else part.vocab.skills)[2:]) for part in parts]
    return sorted(set.intersection(*names))


def support(heroes, skills, kind, count, scorer, rng, restarts=6, cache=None, shortlist=10, deep=5,
            candidates=None):
    """支援推荐：从卡池以外的全部卡里选 count 张（武将 1 名，战法 1 或 2 个）；
    给了 candidates 就只在这些卡里选。
    做法和三选一相同：先搜当前卡池的最优摆法，每张候选卡加进去后从这个摆法出发各搜一次。
    选两个战法时，取单选的前 shortlist 名两两组合再比。最后前 deep 名各从新起点再搜两次。
    返回（当前卡池的分数, 单选排名, 组合排名）；排名是 [(卡, 分数, 三队)]，从高到低。"""
    cache = {} if cache is None else cache
    own = set(heroes if kind == "hero" else skills)
    base, _, (base_h, base_s) = search(heroes, skills, scorer, rng, restarts, cache)

    def rank(options):
        rows = [[*search([], [], scorer, rng, 0, cache,
                         [add_cards(base_h, base_s, option, kind)])[:2], option] for option in options]
        return sorted(rows, key=lambda row: -row[0])

    def refine(rows):
        for row in rows[:deep]:
            h, s = ([*heroes, *row[2]], skills) if kind == "hero" else (heroes, [*skills, *row[2]])
            row[:2] = max(row[:2], search(h, s, scorer, rng, 2, cache)[:2], key=lambda r: r[0])
        return [(tuple(option), value, lineup)
                for value, lineup, option in sorted(rows, key=lambda row: -row[0])]

    single = rank([[card] for card in (known_cards(scorer, kind) if candidates is None
                                       else sorted(candidates)) if card not in own])
    if count == 1:
        return base, refine(single), []
    pairs = rank([list(pair) for pair in combinations([row[2][0] for row in single[:shortlist]], 2)])
    return base, [(tuple(option), value, lineup) for value, lineup, option in single], refine(pairs)


def pick_cases(rosters, seed, teams_count):
    """用留出玩家的真实阵容出选卡题。正确选项是他自己阵容里的三张卡；
    干扰项要么是别的留出玩家上阵的卡（other），要么按出场率随机抽（random）。"""
    rng = np.random.default_rng(seed)
    flat = [([h for t in r for h, _ in t], [s for t in r for _, pair in t for s in pair])
            for r in rosters]
    if len({(frozenset(h), frozenset(s)) for h, s in flat}) < 2:
        raise ValueError("pick_cases needs at least two different rosters")
    weights = {"hero": Counter(), "skill": Counter()}
    for team, n in teams_count.items():
        for h, pair in team:
            weights["hero"][h] += n
            weights["skill"].update({s: n for s in pair})
    sampler = {}
    for kind, count in weights.items():
        names = sorted(count)
        w = np.array([count[n] for n in names], float)
        sampler[kind] = (names, 0.5 * w / w.sum() + 0.5 / len(names))

    def shuffled(items):
        return [items[i] for i in rng.permutation(len(items))]

    cases = []
    for heroes, skills in flat:
        for kind in ("hero", "skill"):
            own = heroes if kind == "hero" else skills
            for stage, distractor in (("early", "other"), ("late", "other"), ("late", "random")):
                order = shuffled(own)
                truth, rest = order[:3], order[3:]
                if stage == "early":      # 开局规模：4 名武将、8 个战法
                    pool_h = rest[:4] if kind == "hero" else shuffled(heroes)[:4]
                    pool_s = rest[:8] if kind == "skill" else shuffled(skills)[:8]
                else:
                    pool_h = rest if kind == "hero" else list(heroes)
                    pool_s = rest if kind == "skill" else list(skills)
                options = [truth]
                while len(options) < 3:
                    taken = set(own) | {x for o in options for x in o}
                    if distractor == "other":
                        other = flat[rng.integers(len(flat))][0 if kind == "hero" else 1]
                        extra = [x for x in shuffled(other) if x not in taken][:3]
                    else:
                        names, p = sampler[kind]
                        extra = []
                        while len(extra) < 3:
                            x = names[rng.choice(len(names), p=p)]
                            if x not in taken and x not in extra:
                                extra.append(x)
                    if len(extra) == 3:
                        options.append(extra)
                answer = int(rng.integers(3))
                options[0], options[answer] = options[answer], options[0]
                cases.append({"kind": kind, "stage": stage, "distractor": distractor,
                              "heroes": pool_h, "skills": pool_s, "options": options,
                              "answer": answer})
    return cases


def pick_accuracy(cases, picks):
    groups = {}
    for case, choice in zip(cases, picks):
        for key in ("all", f"{case['kind']}/{case['stage']}/{case['distractor']}"):
            groups.setdefault(key, []).append(choice == case["answer"])
    return {key: [round(float(np.mean(hits)), 3), len(hits)] for key, hits in sorted(groups.items())}


def agreement(predicted, truth):
    """和标准答案的重合度。"""
    def team_index(lineup):
        return {h: t for t, team in enumerate(lineup) for h, _ in team}

    def carrier(lineup):
        return {s: h for team in lineup for h, pair in team for s in pair}

    pt, tt, pc, tc = team_index(predicted), team_index(truth), carrier(predicted), carrier(truth)

    def pairs(index):
        return {frozenset((a, b)) for a in index for b in index if a < b and index[a] == index[b]}

    truth_sets = {frozenset(h for h, _ in team) for team in truth}
    return {
        "hero_pairs": len(pairs(pt) & pairs(tt)) / 9,
        "exact_trios": sum(frozenset(h for h, _ in team) in truth_sets for team in predicted),
        "heroes_chosen": len(set(pt) & set(tt)) / 9,
        "skills_chosen": len(set(pc) & set(tc)) / 18,
        "skill_carrier": sum(pc.get(s) == h for s, h in tc.items()) / 18,
        # 战法落在“含原携带者的那一队”里，不要求同一个人带。
        "skill_team": sum(s in pc and h in pt and pt[pc[s]] == pt[h] for s, h in tc.items()) / 18,
    }


def mean_metrics(rows):
    return {k: float(np.mean([r[k] for r in rows])) for k in rows[0]} if rows else {}


def neighbour_ranking(rosters, scorer):
    """真实摆法和它的全部单步邻居比，也就是搜索站在真实摆法上时看到的选择。
    local_best：没有更好的邻居；better：更好的邻居个数；loss：排序损失（softmax）。"""
    cache, rows, moves = {}, [], list(zip(*single_moves()))
    for roster in rosters:
        heroes = [h for team in roster for h, _ in team]
        skills = [s for team in roster for _, pair in team for s in pair]
        keys = [roster] + [lineup_teams([heroes[i] for i in a], [skills[i] for i in b])
                           for a, b in moves]
        missing = list({t for key in keys for t in key if t not in cache})
        cache.update(zip(missing, scorer(missing).tolist()))
        gap = np.array([sum(cache[t] for t in key) for key in keys])
        gap = gap[1:] - gap[0]
        rows.append({"local_best": float(gap.max() <= 1e-9), "better": float((gap > 1e-9).sum()),
                     "loss": float(np.logaddexp.reduce(np.append(gap, 0.0)))})
    return mean_metrics(rows)


USER_POOL = {
    "heroes": ["曹仁", "孙坚2", "于吉", "蒋钦2", "凌统", "马云禄", "诸葛亮", "黄月英", "周瑜2",
               "张宝", "于禁"],
    "skills": ["同舟共济", "步步为营", "十面埋伏", "如有神助", "上智为间", "出其不意", "天下骁锐",
               "久砺成锋", "披坚执锐", "瞋目横矛", "虎步连环", "锐不可当", "惩前毖后", "洗筋伐髓",
               "青囊急救", "知人善任", "筹策夺锋", "胜敌益强", "恩威并行", "疾行侧击", "铸甲销戈",
               "上兵伐谋", "文治武功"],
    "lineup": [
        [["曹仁", ["同舟共济", "步步为营"]], ["孙坚2", ["十面埋伏", "如有神助"]],
         ["于吉", ["上智为间", "出其不意"]]],
        [["蒋钦2", ["天下骁锐", "久砺成锋"]], ["凌统", ["披坚执锐", "瞋目横矛"]],
         ["马云禄", ["虎步连环", "锐不可当"]]],
        [["诸葛亮", ["惩前毖后", "洗筋伐髓"]], ["黄月英", ["青囊急救", "知人善任"]],
         ["周瑜2", ["筹策夺锋", "胜敌益强"]]],
    ],
}


def as_lineup(raw):
    return tuple(tuple(sorted((h, tuple(sorted(pair))) for h, pair in team)) for team in raw)


def describe(lineup):
    return [" / ".join(f"{h}({'+'.join(pair)})" for h, pair in team) for team in lineup]


def save_model(path, model, judge, vocab, counts, args):
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model": model.state_dict(), "judge": judge.state_dict(),
                "heroes": vocab.heroes, "skills": vocab.skills,
                "teams": [[list(map(list, t)), n] for t, n in counts.items()],
                "settings": {"width": args.width, "layers": args.layers,
                             "dropout": args.dropout}}, path)


def train_final(args, battles, games, log=print):
    """用全部战报训练并保存，供 --pool / --pick 使用；不留验证集。"""
    counts = Counter(t for a, b, _, _ in battles for t in (a, b))
    rosters = []
    if args.group_weight > 0:
        rosters = sorted({tuple(sorted(roster_teams(r))) for g in games for r in g.rosters})
        rosters = [r for r in rosters if all(t in counts for t in r)]
    for seed in args.seeds:
        model, judge, vocab, _ = train(counts, battles, args, seed, log, rosters)
        save_model(args.models / f"model-seed{seed}-fraction1.0.pt", model, judge, vocab, counts, args)
        log(f"Saved {args.models}/model-seed{seed}-fraction1.0.pt")


def experiment(args, seed, battles, games, fraction=1.0, log=print):
    train_games, val_games, split = split_games(games, seed, args.validation_fraction,
                                                getattr(args, "split", None))
    val_rosters = {roster_teams(r) for g in val_games for r in g.rosters}
    held = {t for r in val_rosters for t in r}
    cutoff = split.get("cutoff")
    if cutoff:      # 按时间划分：训练用这之前的全部战报，之后又出现的队伍照常保留
        fit_battles = [b for b in battles if not (b[3][2] and b[3][2] >= cutoff)]
        val_battles = [b for b in battles if b[3][2] and b[3][2] >= cutoff]
    else:
        fit_battles = [b for b in battles if b[0] not in held and b[1] not in held]
        val_battles = [b for b in battles if b[0] in held and b[1] in held]
    if args.train_sources != "all":      # 只用分组比赛的战报，或只用单场战报
        fit_battles = [b for b in fit_battles if b[3][1] == (args.train_sources == "grouped")]
    if fraction < 1:
        keep = random.Random(seed).sample(range(len(fit_battles)), int(len(fit_battles) * fraction))
        fit_battles = [fit_battles[i] for i in sorted(keep)]
    counts = Counter(t for a, b, _, _ in fit_battles for t in (a, b))
    log(json.dumps({"seed": seed, "fraction": fraction, "fit_battles": len(fit_battles),
                    "fit_teams": len(counts), "val_rosters": len(val_rosters),
                    "val_battles": len(val_battles)}))
    rosters = []
    if args.group_weight > 0 and not args.load_models:
        rosters = sorted({tuple(sorted(roster_teams(r))) for g in train_games for r in g.rosters})
        rosters = [r for r in rosters if all(t in counts for t in r)]
        # 防泄漏：留出玩家的名单、含留出队伍或训练集之外队伍的名单，都不能进入训练。
        # 按时间划分时名单只来自截止日之前的比赛，不再按队伍排除。
        assert all(t in counts for r in rosters for t in r)
        if not cutoff:
            assert not any(t in held for r in rosters for t in r)
            assert not {frozenset(r) for r in rosters} & {frozenset(r) for r in val_rosters}
    if args.load_models:      # 只评估已保存的模型（例如基线），不训练
        saved = torch.load(args.load_models / f"model-seed{seed}-fraction{fraction}.pt",
                           weights_only=False)
        assert counts == Counter({tuple((h, tuple(pair)) for h, pair in team): n
                                  for team, n in saved["teams"]})      # 必须是同一份切分训练出来的
        vocab, nets = Vocab(sorted(counts)), []
        for key in ("model", "judge"):
            nets.append(TeamNet(len(vocab.heroes), len(vocab.skills), **saved["settings"]).eval())
            nets[-1].load_state_dict(saved[key])
        (model, judge), info = nets, {}
    else:
        model, judge, vocab, info = train(counts, fit_battles, args, seed, log, rosters)
    references = [t for t, _ in counts.most_common(args.references)]
    if args.save_models and not args.load_models:
        save_model(args.output.parent / f"model-seed{seed}-fraction{fraction}.pt",
                   model, judge, vocab, counts, args)
    neural = NeuralScorer(model, vocab, counts, judge, prior_weight=args.prior_weight)
    result = {"seed": seed, "fraction": fraction, **info,
              "fit_battles": len(fit_battles), "val_rosters": len(val_rosters),
              "val_battles": len(val_battles)}
    if val_battles:
        a, b = [x[0] for x in val_battles], [x[1] for x in val_battles]
        y = np.array([float(x[2] == 0) for x in val_battles])
        p = neural.win_probability(a, b).clip(1e-6, 1 - 1e-6)
        result["win"] = {"accuracy": float(((p >= 0.5) == (y == 1)).mean()),
                         "log_loss": float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())}
        log(json.dumps({"win": result["win"]}))
    result["neighbours"] = neighbour_ranking(sorted(val_rosters), neural)
    log(json.dumps({"neighbours": result["neighbours"]}))
    truth = as_lineup(USER_POOL["lineup"])
    scorers = {"neural": neural, "count": CountScorer(counts),
               "neural+strength": NeuralScorer(model, vocab, counts, judge, references,
                                               args.strength_weight, args.prior_weight)}
    if args.fast:
        for name in ("neural", "neural+strength"):
            scorers[name].guide = Guide(scorers[name])
    for name, scorer in scorers.items():
        rng = np.random.default_rng(seed)
        result[name] = {}
        if name != "neural+strength":     # 资源固定时强度项不影响摆法，省掉这一遍。
            rows = []
            for roster in sorted(val_rosters):
                heroes = [h for team in roster for h, _ in team]
                skills = [s for team in roster for _, pair in team for s in pair]
                _, lineup = best_lineup(heroes, skills, scorer, rng, args.restarts)
                rows.append(agreement(lineup, roster))
            result[name]["reconstruction"] = mean_metrics(rows)
        value, lineup = best_lineup(USER_POOL["heroes"], USER_POOL["skills"], scorer, rng,
                                    args.restarts * 3)
        result[name]["user"] = {
            **agreement(lineup, truth), "lineup": describe(lineup), "value": value,
            "truth_value": float(sum(scorer(list(truth)))),
            "truth_team_values": [float(x) for x in scorer(list(truth))]}
        log(json.dumps({name: result[name]}, ensure_ascii=False))
    if args.pick_rosters:
        cases = pick_cases(sorted(val_rosters)[:args.pick_rosters], seed, counts)
        result["pick"] = {"cases": cases}
        for name in ("count", "neural+strength"):
            rng = np.random.default_rng(seed)
            # 加深搜索另用一个随机源，不加深的结果不受影响。
            again, deep = np.random.default_rng(seed + 1), name != "count" and args.pick_restarts
            picks = {name: [], name + "+search": []}
            for c in cases:
                task, cache = (c["heroes"], c["skills"], c["options"], c["kind"], scorers[name]), {}
                found = pick(*task, rng, cache=cache)
                picks[name].append(int(np.argmax([v for v, _ in found])))
                if deep:
                    found = deepen(found, *task, again, deep, cache)
                    picks[name + "+search"].append(int(np.argmax([v for v, _ in found])))
            for key, chosen in picks.items():
                if chosen:
                    result["pick"][key] = chosen
                    log(json.dumps({"pick": key, **pick_accuracy(cases, chosen)}))
    rng = np.random.default_rng(seed)
    rows = []
    for roster in sorted(val_rosters):
        heroes = [h for team in roster for h, _ in team]
        skills = [s for team in roster for _, pair in team for s in pair]
        h, s = rng.permutation(9), rng.permutation(18)
        rows.append(agreement(lineup_teams([heroes[i] for i in h], [skills[i] for i in s]), roster))
    result["random"] = {"reconstruction": mean_metrics(rows)}
    return result


class Ensemble:
    """多个已保存模型的平均分。"""
    guide = None

    def __init__(self, paths, strength_weight, prior_weight, references):
        self.parts = []
        for path in paths:
            saved = torch.load(path, weights_only=False)
            counts = Counter({tuple((h, tuple(pair)) for h, pair in team): n
                              for team, n in saved["teams"]})
            vocab = Vocab(sorted(counts))
            nets = []
            for key in ("model", "judge"):
                net = TeamNet(len(vocab.heroes), len(vocab.skills), **saved["settings"])
                net.load_state_dict(saved[key])
                nets.append(net.eval())
            top = [t for t, _ in counts.most_common(references)]
            self.parts.append((NeuralScorer(nets[0], vocab, counts, nets[1], top, strength_weight,
                                            prior_weight), top))

    def __call__(self, teams):
        return np.mean([scorer(teams) for scorer, _ in self.parts], 0)

    def strength(self, team):
        """对各模型训练集中最常见的队伍的平均胜率。"""
        return float(np.mean([scorer.win_probability([team] * len(top), top).mean()
                              for scorer, top in self.parts]))


def load_pool(path, args):
    raw = json.loads(path.read_text())
    state = raw.get("gameState", raw)
    heroes = list(dict.fromkeys(state.get("heroes") or [
        *state.get("current_heroes", []), *filter(None, [state.get("support_hero")])]))
    skills = list(dict.fromkeys(state.get("skills") or [
        *state.get("current_skills", []), *state.get("support_skills", [])]))
    paths = sorted(args.models.glob("model-seed*-fraction1.0.pt"))[:args.ensemble]
    if not paths:
        raise SystemExit("No saved models; train with --save-models first")
    scorer = Ensemble(paths, args.strength_weight, args.prior_weight, args.references)
    if getattr(args, "fast", False):
        scorer.guide = Guide(scorer.parts[0][0])
    return raw, state, heroes, skills, scorer


def recommend_pick(args):
    raw, _, heroes, skills, scorer = load_pool(args.pick, args)
    options = raw["offered_sets"]
    known_heroes = {h for part, _ in scorer.parts for h in part.vocab.h}
    kind = raw.get("round_type") or ("hero" if options[0][0] in known_heroes else "skill")
    rng, cache = np.random.default_rng(args.seeds[0]), {}
    results = pick(heroes, skills, options, kind, scorer, rng, args.restarts, cache)
    if args.pick_restarts:
        results = deepen(results, heroes, skills, options, kind, scorer, rng, args.pick_restarts,
                         cache)
    best = int(np.argmax([value for value, _ in results]))
    print(json.dumps({
        "round_type": kind, "recommended_set_index": best, "recommended_set": options[best],
        "options": [{"set": option, "score_vs_best": round(value - results[best][0], 2)}
                    for option, (value, _) in zip(options, results)],
        "lineup_after_pick": describe(results[best][1]),
    }, ensure_ascii=False, indent=2))


def recommend_support(args):
    """支援推荐。卡池里已经选了支援卡时先拿掉再重选：选武将时不带支援战法，选战法时带着支援武将。"""
    _, state, heroes, skills, scorer = load_pool(args.support, args)
    hero, chosen = state.get("support_hero"), list(state.get("support_skills", []))
    base_heroes = [h for h in heroes if h != hero]
    base_skills = [s for s in skills if s not in chosen]
    rng, out = np.random.default_rng(args.seeds[0]), {"models": len(scorer.parts)}
    for kind in [args.support_kind] if args.support_kind else ["hero", "skill"]:
        pool = base_heroes + ([hero] if hero and kind == "skill" else [])
        base, single, pairs = support(pool, base_skills, kind, 1 if kind == "hero" else 2, scorer, rng,
                                      args.restarts)
        final, picked = pairs or single, [hero] if kind == "hero" else chosen
        out[kind] = {
            "recommended": list(final[0][0]),
            "ranking": [{"cards": list(cards), "gain": round(value - base, 2)}
                        for cards, value, _ in final[:10]],
            "lineup": describe(final[0][2]),
        }
        if pairs:
            out[kind]["single_ranking"] = [{"card": cards[0], "gain": round(value - base, 2)}
                                           for cards, value, _ in single[:10]]
        if all(picked):
            order = [cards[0] for cards, _, _ in single]
            out[kind]["current_choice"] = {
                "cards": picked, "candidates": len(single),
                "single_rank": [order.index(x) + 1 if x in order else None for x in picked]}
            if pairs and len(picked) == 2:
                both = [set(cards) for cards, _, _ in pairs]
                out[kind]["current_choice"]["pair_rank"] = (
                    both.index(set(picked)) + 1 if set(picked) in both else None)
    print(json.dumps(out, ensure_ascii=False, indent=2))


def recommend(args):
    _, state, heroes, skills, scorer = load_pool(args.pool, args)
    _, lineup = best_lineup(heroes, skills, scorer, np.random.default_rng(args.seeds[0]),
                            args.restarts * 3)
    used_heroes = {h for team in lineup for h, _ in team}
    used_skills = {s for team in lineup for _, pair in team for s in pair}
    result = {"models": len(scorer.parts),
              "teams": [{"members": describe([team])[0], "strength": round(scorer.strength(team), 3)}
                        for team in lineup],
              "unused_heroes": [h for h in heroes if h not in used_heroes],
              "unused_skills": [s for s in skills if s not in used_skills]}
    if "lineup" in state:
        truth = as_lineup(state["lineup"])
        result["agreement"] = agreement(lineup, truth)
        result["given_lineup_strength"] = [round(scorer.strength(team), 3) for team in truth]
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pool", type=Path, help="只出阵容：卡池 JSON（gameState 或 heroes/skills）")
    parser.add_argument("--pick", type=Path,
                        help="三选一：卡池 JSON 再加 offered_sets（三组武将或三组战法）")
    parser.add_argument("--support", type=Path,
                        help="支援推荐：卡池 JSON；从全部武将里选 1 名、全部战法里选 2 个")
    parser.add_argument("--support-kind", choices=["hero", "skill"], help="只选武将或只选战法；默认都选")
    parser.add_argument("--models", type=Path, default=Path(".cache/lineup-net/final"))
    parser.add_argument("--final", action="store_true",
                        help="用全部战报训练并把模型存到 --models，不做验证")
    parser.add_argument("--split", help="验证划分：player（默认，按玩家留出）、"
                                        "time:日期（留出该日期起的比赛）、legacy（旧的按系列）")
    parser.add_argument("--ensemble", type=int, default=4, help="最多用几个已保存的模型")
    parser.add_argument("--battles", type=Path, default=Path("data/battles"))
    parser.add_argument("--uploads", type=Path, default=Path("data/web-upload"))
    parser.add_argument("--database", type=Path, default=Path("web/public/game-data/database.json"))
    parser.add_argument("--yanwu-manifest", type=Path, default=Path("data/external/yanwu-release.json"))
    parser.add_argument("--yanwu-cache-dir", type=Path, default=Path(".cache/yanwu"))
    parser.add_argument("--output", type=Path, default=Path(".cache/lineup-net/results.json"))
    parser.add_argument("--seeds", type=int, nargs="+", default=[42])
    parser.add_argument("--fractions", type=float, nargs="+", default=[1.0])
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--epochs", type=int, default=150)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--width", type=int, default=96)
    parser.add_argument("--layers", type=int, default=2)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--learning-rate", type=float, default=2e-3)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--unknown-rate", type=float, default=0.03)
    parser.add_argument("--win-weight", type=float, default=0.5)
    parser.add_argument("--strength-weight", type=float, default=3.0)
    parser.add_argument("--prior-weight", type=float, default=0.5)
    parser.add_argument("--train-sources", choices=["all", "grouped", "single"], default="all")
    parser.add_argument("--season-decay", type=float, default=1.0)
    parser.add_argument("--group-weight", type=float, default=0.0,
                        help="分组排序损失的权重（试验值 0.03）；0 = 关闭")
    parser.add_argument("--group-rosters", type=int, default=4, help="每个 batch 抽几份名单")
    parser.add_argument("--group-negatives", type=int, default=8, help="每份名单的负例摆法数")
    parser.add_argument("--group-temperature", type=float, default=1.0)
    parser.add_argument("--group-hide", type=float, default=0.7,
                        help="每份名单随机藏掉 0~这个比例的卡再比（部分卡池上的排序）；0 = 只比满编")
    parser.add_argument("--group-start", type=float, default=0.33,
                        help="前多少比例的轮次不加排序损失（先让搭配模型成形）")
    parser.add_argument("--group-mine", type=int, default=5,
                        help="每隔几轮给全部单步邻居打分、更新难例抽样；0 = 不挖，均匀抽")
    parser.add_argument("--load-models", type=Path,
                        help="只评估：从该目录读 model-seed*-fraction*.pt，不训练")
    parser.add_argument("--save-models", action="store_true")
    parser.add_argument("--pick-rosters", type=int, default=0,
                        help="用前 N 名留出玩家的阵容出三选一题并评估")
    parser.add_argument("--fast", action="store_true",
                        help="快速搜索：起点由模型直接给出，每步只精确打分估计最好的几个动作")
    parser.add_argument("--pick-restarts", type=int, default=2,
                        help="三选一时每个候选组额外从随机摆法搜几次；0 为不加深")
    parser.add_argument("--references", type=int, default=128)
    parser.add_argument("--restarts", type=int, default=6)
    parser.add_argument("--threads", type=int, help="默认：快速搜索 1，其余 4")
    args = parser.parse_args()
    torch.set_num_threads(args.threads or (1 if args.fast else 4))
    if args.pick:
        return recommend_pick(args)
    if args.support:
        return recommend_support(args)
    if args.pool:
        return recommend(args)
    battles = load_battles([args.battles, args.uploads], load_external(args))
    games, corpus = load_games(args.battles)
    if args.final:
        return train_final(args, battles, games, log=lambda m: print(m, flush=True))
    print(json.dumps({"battles": len(battles), **corpus}), flush=True)
    results = [experiment(args, seed, battles, games, fraction,
                          log=lambda m: print(m, flush=True))
               for fraction in args.fractions for seed in args.seeds]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved {args.output}", flush=True)


if __name__ == "__main__":
    main()
