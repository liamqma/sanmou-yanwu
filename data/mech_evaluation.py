"""Strict, evaluation-only contract for reviewed MECH relationships.

The general catalog lifecycle deliberately permits structurally valid unresolved
items so human review can proceed incrementally. Model evaluation is stricter:
it reuses the canonical validator and refuses to train unless every reviewed
skill entry is complete, fresh, and resolved.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

try:
    import manage_mech_catalog as catalog_manager
except ModuleNotFoundError:  # Support ``import data.mech_evaluation``.
    from . import manage_mech_catalog as catalog_manager


@dataclass(frozen=True)
class MechanicRelationship:
    """One validated relationship attached to a reviewed skill."""

    relation: str
    mechanic: str
    subject: str
    certainty: str


@dataclass(frozen=True)
class MechanicsContract:
    """Validated MECH input kept separate from runtime HC/B relationships."""

    skill_relationships: Mapping[str, tuple[MechanicRelationship, ...]]
    mechanic_ids: frozenset[str]
    catalog_sha256: str


def load_evaluation_mechanics(
    database_path: str | Path = catalog_manager.DEFAULT_DATABASE,
    catalog_path: str | Path = catalog_manager.DEFAULT_CATALOG,
) -> MechanicsContract:
    """Load the reviewed catalog and fail closed on any partial semantic input.

    ``validate_catalog`` owns duplicate-key rejection, schema/shape checks,
    registry and source freshness, exact skill coverage, relationship enums,
    mechanic IDs, evidence, and completion. This adapter adds the evaluation-
    specific zero-unresolved rule instead of duplicating that validator.
    """

    database = catalog_manager.load_database(Path(database_path))
    catalog = catalog_manager.load_catalog(Path(catalog_path))
    unresolved = catalog_manager.validate_catalog(catalog, database)
    if unresolved:
        skill_name, mechanic_name = unresolved[0]
        raise catalog_manager.CatalogError(
            "evaluation MECH catalog must have zero unresolved entries; "
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
    catalog_sha256 = hashlib.sha256(
        catalog_manager.rendered_catalog(catalog)
    ).hexdigest()
    return MechanicsContract(
        skill_relationships=MappingProxyType(relationships),
        mechanic_ids=frozenset(catalog["mechanics"]),
        catalog_sha256=catalog_sha256,
    )
