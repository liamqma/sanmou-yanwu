"""Strict reviewed mechanics contract for production and evaluation scoring.

The general catalog lifecycle deliberately permits structurally valid unresolved
items so human review can proceed incrementally. Model consumers are stricter:
this module reuses the canonical catalog validator and refuses to train unless
every reviewed skill entry is complete, fresh, and resolved. It also derives the
minimal deterministic contract embedded in the generated browser artifact.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

try:
    import manage_mech_catalog as catalog_manager
except ModuleNotFoundError:  # Support ``import data.mechanics_contract``.
    from . import manage_mech_catalog as catalog_manager

SCORING_RELATIONS = ("provides", "benefits_from", "requires", "consumes")
SCORING_SUBJECTS = ("self", "ally", "enemy", "any", "team", "unknown")
SCORING_RELATION_ORDER = {
    relation: index for index, relation in enumerate(SCORING_RELATIONS)
}
SCORING_SUBJECT_ORDER = {
    subject: index for index, subject in enumerate(SCORING_SUBJECTS)
}
CERTAINTY_MODES = ("explicit_only", "all_reviewed")


@dataclass(frozen=True)
class MechanicRelationship:
    """One validated relationship attached to a reviewed skill."""

    relation: str
    mechanic: str
    subject: str
    certainty: str


@dataclass(frozen=True)
class ScoringMechanicRelationship:
    """Minimal normalized relationship shipped to the browser scorer."""

    relation: str
    mechanic: str
    subject: str

    def as_dict(self) -> dict[str, str]:
        return {
            "relation": self.relation,
            "mechanic": self.mechanic,
            "subject": self.subject,
        }


@dataclass(frozen=True)
class MechanicsScoringContract:
    """Minimal browser-visible mechanics semantics and their content address."""

    certainty_mode: str
    mechanic_names: Mapping[str, str]
    skill_relationships: Mapping[
        str, tuple[ScoringMechanicRelationship, ...]
    ]
    mechanics_version: str

    def semantic_dict(self) -> dict[str, Any]:
        return {
            "certainty_mode": self.certainty_mode,
            "mechanic_names": dict(self.mechanic_names),
            "skills": {
                skill_name: [relationship.as_dict() for relationship in relationships]
                for skill_name, relationships in self.skill_relationships.items()
            },
        }


@dataclass(frozen=True)
class MechanicsContract:
    """Validated reviewed MECH input, separate from runtime HC/B relationships."""

    skill_relationships: Mapping[str, tuple[MechanicRelationship, ...]]
    mechanic_ids: frozenset[str]
    mechanic_names: Mapping[str, str]
    catalog_sha256: str

    def scoring_contract(self, certainty_mode: str) -> MechanicsScoringContract:
        """Return the canonical minimal scoring subset for one certainty mode."""
        if certainty_mode not in CERTAINTY_MODES:
            raise ValueError(f"unsupported MECH certainty mode {certainty_mode!r}")

        def certainty_allowed(certainty: str) -> bool:
            return certainty == "explicit" or (
                certainty_mode == "all_reviewed" and certainty == "inferred"
            )

        skill_relationships: dict[
            str, tuple[ScoringMechanicRelationship, ...]
        ] = {}
        referenced_mechanics: set[str] = set()
        for skill_name, relationships in sorted(self.skill_relationships.items()):
            normalized = tuple(
                sorted(
                    (
                        ScoringMechanicRelationship(
                            relation=relationship.relation,
                            mechanic=relationship.mechanic,
                            subject=relationship.subject,
                        )
                        for relationship in relationships
                        if relationship.relation in SCORING_RELATIONS
                        and certainty_allowed(relationship.certainty)
                    ),
                    key=lambda relationship: (
                        SCORING_RELATION_ORDER[relationship.relation],
                        relationship.mechanic,
                        SCORING_SUBJECT_ORDER[relationship.subject],
                    ),
                )
            )
            if not normalized:
                continue
            skill_relationships[skill_name] = normalized
            referenced_mechanics.update(
                relationship.mechanic for relationship in normalized
            )
        mechanic_names = {
            mechanic_id: self.mechanic_names[mechanic_id]
            for mechanic_id in sorted(referenced_mechanics)
        }
        semantic = {
            "certainty_mode": certainty_mode,
            "mechanic_names": mechanic_names,
            "skills": {
                skill_name: [relationship.as_dict() for relationship in relationships]
                for skill_name, relationships in skill_relationships.items()
            },
        }
        encoded = json.dumps(
            semantic,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return MechanicsScoringContract(
            certainty_mode=certainty_mode,
            mechanic_names=MappingProxyType(mechanic_names),
            skill_relationships=MappingProxyType(skill_relationships),
            mechanics_version=hashlib.sha256(encoded).hexdigest()[:12],
        )


def load_mechanics_contract(
    database_path: str | Path = catalog_manager.DEFAULT_DATABASE,
    catalog_path: str | Path = catalog_manager.DEFAULT_CATALOG,
) -> MechanicsContract:
    """Load reviewed mechanics and fail closed on any partial semantic input.

    ``validate_catalog`` owns duplicate-key rejection, schema/shape checks,
    registry and source freshness, exact skill coverage, relationship enums,
    mechanic IDs, evidence, duplicate identities, and completion. This adapter
    adds the scoring-specific zero-unresolved rule instead of duplicating that
    validator.
    """

    database = catalog_manager.load_database(Path(database_path))
    catalog = catalog_manager.load_catalog(Path(catalog_path))
    unresolved = catalog_manager.validate_catalog(catalog, database)
    if unresolved:
        skill_name, mechanic_name = unresolved[0]
        raise catalog_manager.CatalogError(
            "scoring MECH catalog must have zero unresolved entries; "
            f"first unresolved item is {skill_name!r}/{mechanic_name!r}"
        )

    relationships = {
        skill_name: tuple(
            MechanicRelationship(
                relation=str(item["relation"]),
                mechanic=str(item["mechanic"]),
                subject=str(item["subject"]),
                certainty=str(item["certainty"]),
            )
            for item in entry["relations"]
        )
        for skill_name, entry in sorted(catalog["skills"].items())
    }
    mechanic_names = {
        mechanic_id: str(entry["name"])
        for mechanic_id, entry in sorted(catalog["mechanics"].items())
    }
    catalog_sha256 = hashlib.sha256(
        catalog_manager.rendered_catalog(catalog)
    ).hexdigest()
    return MechanicsContract(
        skill_relationships=MappingProxyType(relationships),
        mechanic_ids=frozenset(catalog["mechanics"]),
        mechanic_names=MappingProxyType(mechanic_names),
        catalog_sha256=catalog_sha256,
    )
