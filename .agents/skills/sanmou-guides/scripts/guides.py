#!/usr/bin/env python3
"""Query guide links and refresh the first-sheet index from a KDocs XLSX export."""

import argparse
import hashlib
import json
import posixpath
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[2]
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
URL = re.compile(r"https?://[^\s<>\"'，。；、）】]+")
HYPERLINK = re.compile(r'(?:_xlfn\.)?HYPERLINK\(\s*"((?:[^"]|"")*)"\s*[,;]\s*"((?:[^"]|"")*)"', re.I)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_database(args, mappings):
    path = Path(args.database).expanduser() if args.database else REPO / mappings["database_path"]
    return read_json(path)


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def norm(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold()


def coordinates(address):
    match = re.fullmatch(r"\$?([A-Z]+)\$?(\d+)", address.upper())
    if not match:
        raise ValueError(f"无效单元格地址：{address}")
    col = 0
    for char in match[1]:
        col = col * 26 + ord(char) - 64
    return int(match[2]), col


def rectangle(address):
    parts = address.split(":")
    return (*coordinates(parts[0]), *coordinates(parts[-1]))


def clean_url(value):
    value = value.strip().rstrip('"\'，。；、）】')
    parsed = urlsplit(value)
    return value if parsed.scheme in ("http", "https") and parsed.netloc else None


def first_sheet(path):
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = workbook.find("s:sheets/s:sheet", NS)
        if sheet is None:
            raise ValueError("Excel 没有工作表")
        relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = next(item.attrib["Target"] for item in relations if item.attrib["Id"] == sheet.attrib[RID])
        sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(item.itertext()) if not item.findall(".//s:t", NS) else
                      "".join(t.text or "" for t in item.findall(".//s:t", NS))
                      for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        tree = ET.fromstring(archive.read(sheet_path))
        cells = {}
        for cell in tree.findall("s:sheetData/s:row/s:c", NS):
            address = cell.attrib["r"]
            raw = cell.findtext("s:v", "", NS)
            formula = cell.findtext("s:f", "", NS)
            kind = cell.attrib.get("t")
            if kind == "s":
                value = shared[int(raw)] if raw else ""
            elif kind == "inlineStr":
                value = "".join(t.text or "" for t in cell.findall("s:is//s:t", NS))
            else:
                value = raw
            match = HYPERLINK.search(formula)
            links = URL.findall(value)
            if match:
                links.append(match[1].replace('""', '"'))
                value = match[2].replace('""', '"')
            if value or links:
                cells[address] = {"text": value, "links": links}
        rel_path = posixpath.join(posixpath.dirname(sheet_path), "_rels", posixpath.basename(sheet_path) + ".rels")
        rels = {}
        if rel_path in archive.namelist():
            rels = {item.attrib["Id"]: item.attrib["Target"]
                    for item in ET.fromstring(archive.read(rel_path))
                    if item.attrib.get("TargetMode") == "External"}
        for link in tree.findall("s:hyperlinks/s:hyperlink", NS):
            target = rels.get(link.attrib.get(RID))
            if not target:
                continue
            start = link.attrib["ref"].split(":")[0]
            cell = cells.setdefault(start, {"text": link.attrib.get("display", ""), "links": []})
            cell["links"].append(target)
        for cell in cells.values():
            cell["links"] = sorted({url for item in cell["links"] if (url := clean_url(item))})
        merges = [item.attrib["ref"] for item in tree.findall("s:mergeCells/s:mergeCell", NS)]
        return sheet.attrib["name"], cells, merges


def vocabulary(database, mappings):
    terms = {}
    for kind, source in (("heroes", "heroes"), ("skills", "skills")):
        for name in database[source]:
            terms[norm(name)] = {kind: [name]}
    for kind, field in (("heroes", "hero_aliases"), ("skills", "skill_aliases")):
        for alias, canonical in mappings[field].items():
            if canonical not in database[kind]:
                raise ValueError(f"别名 {alias} 指向数据库不存在的名称：{canonical}")
            terms[norm(alias)] = {kind: [canonical]}
    for name, team in mappings["teams"].items():
        for hero in team["heroes"]:
            if hero not in database["heroes"]:
                raise ValueError(f"阵容 {name} 包含未知武将：{hero}")
        for alias in [name, *team["aliases"]]:
            terms[norm(alias)] = {"teams": [name], "heroes": team["heroes"]}
    for term in mappings["pending_terms"]:
        terms[norm(term)] = {"pending": [term]}
    return terms


def identify(text, terms):
    text = norm(text)
    occupied = set()
    found = {key: set() for key in ("heroes", "skills", "teams", "pending")}
    for term in sorted(terms, key=lambda item: (-len(item), item)):
        for match in re.finditer(re.escape(term), text):
            positions = set(range(match.start(), match.end()))
            if occupied & positions:
                continue
            occupied.update(positions)
            for kind, names in terms[term].items():
                found[kind].update(names)
    return {key: sorted(values) for key, values in found.items()}


def entry_tags(title, section, terms):
    tags = identify(title + "\n" + section, terms)
    if not any(tags.values()):
        subject = re.split(r"[—–]|--", title, maxsplit=1)[0].strip()
        if "队伍" in section:
            tags["pending"] = [re.sub(r"队伍.*$", "", section).strip()]
        elif any(word in title for word in ("问鼎攻略", "一图流", "影本分析")) and subject != title:
            tags["pending"] = [subject]
    return tags


def reindex_catalog(catalog, database, mappings):
    terms = vocabulary(database, mappings)
    entries = []
    for entry in catalog["entries"]:
        collected = {key: set() for key in ("heroes", "skills", "teams", "pending")}
        for occurrence in entry["occurrences"]:
            for key, values in entry_tags(occurrence["title"], occurrence["section"], terms).items():
                collected[key].update(values)
        entries.append({**entry, **{key: sorted(values) for key, values in collected.items()}})
    return {**catalog, "entries": entries,
            "entities": {"heroes": list(database["heroes"]), "skills": list(database["skills"])}}


def build_catalog(path, database, mappings):
    sheet, cells, merges = first_sheet(path)
    if norm(sheet) != "目录":
        raise ValueError(f"第一张工作表是 {sheet!r}，预期为“目录”；请核实导出文件")
    terms = vocabulary(database, mappings)
    headers = []
    for merged in merges:
        r1, c1, _, c2 = rectangle(merged)
        value = cells.get(merged.split(":")[0], {})
        if c2 - c1 >= 2 and value.get("text") and not value.get("links"):
            headers.append((r1, c1, c2, value["text"]))
    entries = {}
    for address, cell in cells.items():
        if not cell["links"]:
            continue
        row, col = coordinates(address)
        candidates = [item for item in headers if item[0] < row and item[1] < col <= item[2]]
        section = max(candidates, key=lambda item: item[0])[3] if candidates else ""
        title = re.sub(r"\s+", " ", URL.sub("", cell["text"])).strip(' \n—-"')
        if not title:
            title = section or f"目录 {address}"
        tags = entry_tags(title, section, terms)
        for url in cell["links"]:
            entry = entries.setdefault(url, {"id": hashlib.sha256(url.encode()).hexdigest()[:16],
                                            "title": title, "url": url,
                                            "heroes": [], "skills": [], "teams": [], "pending": [],
                                            "occurrences": []})
            entry["occurrences"].append({"cell": address, "title": title, "section": section})
            for kind, values in tags.items():
                entry[kind] = sorted(set(entry[kind]) | set(values))
    if not entries:
        raise ValueError("第一张表没有可用攻略链接；未写入索引")
    return {"schema_version": 1, "source_url": mappings["source_url"], "sheet": sheet,
            "source_file": Path(path).name,
            "source_sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            "entities": {"heroes": list(database["heroes"]), "skills": list(database["skills"])},
            "entries": sorted(entries.values(), key=lambda item: item["url"])}


def difference(previous, current):
    before = {item["url"]: item for item in previous.get("entries", [])}
    after = {item["url"]: item for item in current["entries"]}
    fields = ("title", "heroes", "skills", "teams", "pending")
    added = [after[url] for url in sorted(after.keys() - before.keys())]
    removed = [before[url] for url in sorted(before.keys() - after.keys())]
    changed = [{"url": url, "before": {key: before[url][key] for key in fields},
                "after": {key: after[url][key] for key in fields}}
               for url in sorted(before.keys() & after.keys())
               if any(before[url][key] != after[url][key] for key in fields)
               or sorted(o["title"] for o in before[url]["occurrences"]) !=
                  sorted(o["title"] for o in after[url]["occurrences"])]
    pending = {}
    for entry in current["entries"]:
        for term in entry["pending"]:
            pending.setdefault(term, {"candidates": [], "links": []})["links"].append(entry["url"])
    return {"added": added, "removed": removed, "changed": changed, "pending": pending}


def update(args, mappings):
    path = Path(args.xlsx).expanduser().resolve()
    database = load_database(args, mappings)
    current = build_catalog(path, database, mappings)
    store_catalog(current, args, mappings)


def reindex(args, mappings):
    database = load_database(args, mappings)
    catalog = read_json(ROOT / "data/catalog.json")
    store_catalog(reindex_catalog(catalog, database, mappings), args, mappings)


def store_catalog(current, args, mappings):
    current["source_file"] = Path(current["source_file"]).name
    catalog_path = ROOT / "data/catalog.json"
    previous = read_json(catalog_path) if catalog_path.exists() else {}
    report = difference(previous, current)
    for term, detail in report["pending"].items():
        detail["candidates"] = mappings["pending_terms"].get(term, [])
    report.update({"source_file": current["source_file"], "source_sha256": current["source_sha256"],
                   "sheet": current["sheet"], "total": len(current["entries"]), "applied": False})
    large_drop = previous and len(current["entries"]) < len(previous["entries"]) * 0.7
    if large_drop and args.apply and not args.accept_removals:
        raise ValueError("链接总数减少超过 30%；请核实目录后再加 --accept-removals")
    if args.apply:
        current["indexed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        report["applied"] = True
        save_json(catalog_path, current)
        save_json(ROOT / "data/last-update.json", report)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f'{"已更新" if args.apply else "预览"}：{current["sheet"]}，{report["total"]} 个链接；'
              f'新增 {len(report["added"])}，移除 {len(report["removed"])}，改动 {len(report["changed"])}。')
        for label, key in (("新增", "added"), ("移除", "removed")):
            for item in report[key]:
                print(f'{label}：{item["title"]} {item["url"]}')
        for item in report["changed"]:
            print(f'改动：{item["after"]["title"]} {item["url"]}')
        for term, detail in report["pending"].items():
            print(f'待确认：{term} → {" / ".join(detail["candidates"]) or "未识别名称"}（{len(detail["links"])} 个链接）')
        if large_drop:
            print("注意：链接总数减少超过 30%，请核实源文件。")


def query(args, mappings):
    catalog = read_json(ROOT / "data/catalog.json")
    terms = vocabulary(catalog["entities"], mappings)
    tags = identify(args.text, terms)
    query_text = norm(args.text)
    pending = [term for term in tags["pending"] if norm(term) == query_text]
    if pending:
        choices = {term: mappings["pending_terms"][term] for term in pending}
        if args.json:
            print(json.dumps({"query": args.text, "needs_clarification": choices, "results": []}, ensure_ascii=False))
        else:
            print("请确认：" + "；".join(f'{term} 指 {" / ".join(names)}？' for term, names in choices.items()))
        return
    matches = []
    has_entities = any(tags[key] for key in ("heroes", "skills", "teams"))
    for entry in catalog["entries"]:
        title_match = query_text in norm(" ".join(o["title"] for o in entry["occurrences"]))
        entity_match = all(set(tags[key]).issubset(entry[key]) for key in ("heroes", "skills", "teams"))
        if (has_entities and not entity_match) or (not has_entities and not title_match):
            continue
        score = (20 if title_match else 0) + (10 if set(tags["teams"]) & set(entry["teams"]) else 0)
        score += 5 if "问鼎攻略" in entry["title"] else 0
        score += 3 if "一图流" in entry["title"] else 0
        if has_entities and entity_match:
            score += 10
        matches.append((score, entry))
    matches.sort(key=lambda pair: (-pair[0], pair[1]["title"], pair[1]["url"]))
    results = [item for _, item in matches[:args.limit]] if args.limit else [item for _, item in matches]
    if args.json:
        print(json.dumps({"query": args.text, "source_url": catalog["source_url"],
                          "indexed_at": catalog.get("indexed_at"), "total": len(matches),
                          "results": results}, ensure_ascii=False, indent=2))
    elif results:
        for item in results:
            print(f'- [{item["title"]}]({item["url"]})')
        if len(results) < len(matches):
            print(f"显示 {len(results)}/{len(matches)} 条。")
    else:
        print(f"目录暂未收录“{args.text}”的攻略链接。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    search = commands.add_parser("query")
    search.add_argument("text")
    search.add_argument("--limit", type=int, default=0, help="0 表示全部")
    search.add_argument("--json", action="store_true")
    refresh = commands.add_parser("update")
    refresh.add_argument("xlsx")
    refresh.add_argument("--database")
    refresh.add_argument("--apply", action="store_true")
    refresh.add_argument("--accept-removals", action="store_true")
    refresh.add_argument("--json", action="store_true")
    rebuild = commands.add_parser("reindex", help="从现有目录重新应用映射，无需 Excel")
    rebuild.add_argument("--database")
    rebuild.add_argument("--apply", action="store_true")
    rebuild.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if getattr(args, "limit", 0) < 0 or (args.command == "query" and not args.text.strip()):
        parser.error("查询不能为空，limit 不能为负数")
    try:
        mappings = read_json(ROOT / "data/mappings.json")
        {"query": query, "update": update, "reindex": reindex}[args.command](args, mappings)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError, StopIteration) as error:
        parser.exit(1, f"错误：{error}\n")


if __name__ == "__main__":
    main()
