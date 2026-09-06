#!/usr/bin/env python3
"""Validate semantic building styles against locked pack and local mappings."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "data" / "semantic_building_styles.json"
DEFAULT_UIDS = ROOT / "data" / "building_pack_uids.json"
DEFAULT_UID_MAP = ROOT / "data" / "building_uid_map.json"
MIN_STATE = 0
MAX_STATE = 63


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate_vector(
    value: object,
    path: str,
    errors: list[str],
    *,
    axes: tuple[str, ...],
    positive: bool = False,
) -> None:
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object")
        return
    for axis in axes:
        coordinate = value.get(axis)
        if not _is_number(coordinate):
            errors.append(f"{path}.{axis} must be a number")
        elif positive and coordinate <= 0:
            errors.append(f"{path}.{axis} must be greater than zero")


def _locked_locals(
    uid_doc: dict[str, Any], uid_map: dict[str, Any], errors: list[str]
) -> dict[str, set[int]]:
    if uid_doc.get("locked") is not True:
        errors.append("building_pack_uids.json must declare locked=true")

    mapping = uid_doc.get("mapping")
    if not isinstance(mapping, dict) or not mapping:
        errors.append("building_pack_uids.json mapping must be a non-empty object")
        return {}

    locked_packs: set[str] = set()
    for uid, pack in mapping.items():
        try:
            parsed_uid = int(uid)
        except (TypeError, ValueError):
            errors.append(f"locked UID {uid!r} is not an integer")
            continue
        if parsed_uid <= 0 or not isinstance(pack, str) or not pack:
            errors.append(f"locked UID {uid!r} has an invalid pack")
            continue
        if pack in locked_packs:
            errors.append(f"locked pack {pack!r} is mapped by more than one UID")
        locked_packs.add(pack)

    result: dict[str, set[int]] = {}
    packs = uid_map.get("packs")
    if not isinstance(packs, list):
        errors.append("building_uid_map.json packs must be an array")
        return result
    for pack_row in packs:
        if not isinstance(pack_row, dict):
            continue
        pack = pack_row.get("pack")
        local_map = pack_row.get("mapping")
        if not isinstance(pack, str) or not isinstance(local_map, dict):
            continue
        locals_for_pack: set[int] = set()
        for local in local_map:
            try:
                locals_for_pack.add(int(local))
            except (TypeError, ValueError):
                errors.append(f"building_uid_map pack {pack!r} has invalid local {local!r}")
        result[pack] = locals_for_pack

    for pack in sorted(locked_packs):
        if pack not in result:
            errors.append(f"locked pack {pack!r} is missing from building_uid_map.json")
    return {pack: result[pack] for pack in locked_packs if pack in result}


def _validate_candidate(
    candidate: object,
    path: str,
    locals_by_pack: dict[str, set[int]],
    errors: list[str],
) -> None:
    if not isinstance(candidate, dict):
        errors.append(f"{path} must be an object")
        return
    pack = candidate.get("pack")
    local = candidate.get("local")
    states = candidate.get("states")

    if not isinstance(pack, str) or pack not in locals_by_pack:
        errors.append(f"{path}.pack {pack!r} is not in the locked UID mapping")
    if not isinstance(local, int) or isinstance(local, bool):
        errors.append(f"{path}.local must be an integer")
    elif isinstance(pack, str) and pack in locals_by_pack and local not in locals_by_pack[pack]:
        errors.append(f"{path} references missing local {pack}:{local}")

    if not isinstance(states, list) or not states:
        errors.append(f"{path}.states must be a non-empty array")
        return
    seen: set[int] = set()
    for index, state in enumerate(states):
        if not isinstance(state, int) or isinstance(state, bool):
            errors.append(f"{path}.states[{index}] must be an integer")
        elif not MIN_STATE <= state <= MAX_STATE:
            errors.append(
                f"{path}.states[{index}] must be between {MIN_STATE} and {MAX_STATE}"
            )
        elif state in seen:
            errors.append(f"{path}.states contains duplicate state {state}")
        else:
            seen.add(state)


def _validate_roles(
    roles: object,
    path: str,
    locals_by_pack: dict[str, set[int]],
    errors: list[str],
) -> set[str]:
    if not isinstance(roles, dict) or not roles:
        errors.append(f"{path} must be a non-empty object")
        return set()

    role_names = set(roles)
    fallbacks: dict[str, str] = {}
    for role_name, role in roles.items():
        role_path = f"{path}.{role_name}"
        if not isinstance(role_name, str) or not role_name:
            errors.append(f"{path} role names must be non-empty strings")
            continue
        if not isinstance(role, dict):
            errors.append(f"{role_path} must be an object")
            continue
        if not isinstance(role.get("label"), str) or not role["label"].strip():
            errors.append(f"{role_path}.label must be a non-empty string")
        optional = role.get("optional")
        if not isinstance(optional, bool):
            errors.append(f"{role_path}.optional must be a boolean")
        if "fallback" not in role:
            errors.append(f"{role_path}.fallback must be explicit")
            fallback = None
        else:
            fallback = role["fallback"]
            if fallback is not None and not isinstance(fallback, str):
                errors.append(f"{role_path}.fallback must be a role name or null")
            elif isinstance(fallback, str):
                if fallback not in role_names:
                    errors.append(f"{role_path}.fallback references unknown role {fallback!r}")
                elif fallback == role_name:
                    errors.append(f"{role_path}.fallback cannot reference itself")
                else:
                    fallbacks[role_name] = fallback

        candidates = role.get("candidates")
        if not isinstance(candidates, list):
            errors.append(f"{role_path}.candidates must be an array")
            continue
        if not candidates and optional is False:
            errors.append(f"{role_path} is required and must have candidates")
        for index, candidate in enumerate(candidates):
            _validate_candidate(
                candidate,
                f"{role_path}.candidates[{index}]",
                locals_by_pack,
                errors,
            )

    for role_name in fallbacks:
        visited: set[str] = set()
        current = role_name
        while current in fallbacks:
            if current in visited:
                errors.append(f"{path}.{role_name}.fallback forms a cycle")
                break
            visited.add(current)
            current = fallbacks[current]
    return role_names


def _validate_facade(
    facade: object, path: str, role_names: set[str], errors: list[str]
) -> None:
    if not isinstance(facade, dict):
        errors.append(f"{path} must be an object")
        return
    layers = facade.get("layers")
    if not isinstance(layers, list):
        errors.append(f"{path}.layers must be an array")
        return
    for index, layer in enumerate(layers):
        layer_path = f"{path}.layers[{index}]"
        if not isinstance(layer, dict):
            errors.append(f"{layer_path} must be an object")
            continue
        role = layer.get("role")
        if not isinstance(role, str) or role not in role_names:
            errors.append(f"{layer_path}.role must reference a declared role")
        _validate_vector(layer.get("offset"), f"{layer_path}.offset", errors, axes=("x", "y"))


def validate_document(
    document: object,
    uid_doc: dict[str, Any],
    uid_map: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    locals_by_pack = _locked_locals(uid_doc, uid_map, errors)
    if not isinstance(document, dict):
        return errors + ["document must be an object"]
    if document.get("schema") != 1:
        errors.append("schema must equal 1")
    styles = document.get("styles")
    if not isinstance(styles, dict) or not styles:
        return errors + ["styles must be a non-empty object"]

    for style_name, style in styles.items():
        path = f"styles.{style_name}"
        if not isinstance(style_name, str) or not style_name:
            errors.append("style names must be non-empty strings")
            continue
        if not isinstance(style, dict):
            errors.append(f"{path} must be an object")
            continue
        if not isinstance(style.get("label"), str) or not style["label"].strip():
            errors.append(f"{path}.label must be a non-empty string")
        _validate_vector(
            style.get("spacing"),
            f"{path}.spacing",
            errors,
            axes=("x", "y", "z"),
            positive=True,
        )
        _validate_vector(style.get("offset"), f"{path}.offset", errors, axes=("x", "y"))
        role_names = _validate_roles(
            style.get("roles"), f"{path}.roles", locals_by_pack, errors
        )
        if "facade" in style:
            _validate_facade(style["facade"], f"{path}.facade", role_names, errors)
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--uids", type=Path, default=DEFAULT_UIDS)
    parser.add_argument("--uid-map", type=Path, default=DEFAULT_UID_MAP)
    args = parser.parse_args(argv)

    try:
        document = load_json(args.config)
        uid_doc = load_json(args.uids)
        uid_map = load_json(args.uid_map)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"semantic style validation failed: {exc}")
        return 2

    errors = validate_document(document, uid_doc, uid_map)
    if errors:
        print("semantic style validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"validated {len(document['styles'])} semantic building styles")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
