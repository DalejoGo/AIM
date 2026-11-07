"""The Pydantic models behind /docs must say what the Zod contract says (contract/*.schema.json is generated
from packages/contracts/src/migrator.ts). Real responses are validated against those files in every test."""

from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic import BaseModel

from py_lab import models

from .conftest import CONTRACT

MODELS: dict[str, type[BaseModel]] = {
    "MigrationColumn": models.MigrationColumn,
    "FieldError": models.FieldError,
    "ProcessedRow": models.ProcessedRow,
    "DuplicateRow": models.DuplicateRow,
    "ChangesByType": models.ChangesByType,
    "MigrationResult": models.MigrationResult,
    "SourceEncoding": models.SourceEncoding,
    "MigrationSource": models.MigrationSource,
    "MigrationTimings": models.MigrationTimings,
    "MigrationEngine": models.MigrationEngine,
    "MigrationMeta": models.MigrationMeta,
    "MigrationResponse": models.MigrationResponse,
    "PyLabLimits": models.PyLabLimits,
    "PyLabHealth": models.PyLabHealth,
    "PyLabError": models.ApiErrorBody,
}


def contract_defs() -> dict[str, Any]:
    defs: dict[str, Any] = {}
    for path in CONTRACT.glob("*.schema.json"):
        defs.update(json.loads(path.read_text(encoding="utf-8"))["$defs"])
    return defs


def test_every_contract_object_has_a_model() -> None:
    objects = {name for name, schema in contract_defs().items() if schema.get("type") == "object"}
    assert objects == set(MODELS)


@pytest.mark.parametrize("name", sorted(MODELS))
def test_model_fields_match_the_contract(name: str) -> None:
    contract = contract_defs()[name]
    schema = MODELS[name].model_json_schema()
    assert set(schema["properties"]) == set(contract["properties"])
    # Pydantic lists a nullable field with no default as required, as Zod does.
    assert set(schema.get("required", [])) == set(contract.get("required", []))
    assert schema.get("additionalProperties") is False
