#!/usr/bin/env python3
"""Rewrites packages/domain/openapi.json for swift-openapi-generator (P6-A2, D-P6-7).

Two things the generator does not handle the way zod writes them:

1. It skips any `anyOf`/`oneOf` that contains a `{"type": "null"}` schema, and with it the
   whole property (duration_ms, folder_id, a document version's body ...). Here
   `anyOf: [X, null]` becomes `X` and the property leaves `required`, so the generated field
   is optional and a JSON null decodes as nil.
2. A `oneOf` with a discriminator whose branches are inline objects (SourceRef,
   NativeTokenRequest) becomes an enum without cases: nothing decodes or encodes. Here each
   branch moves to its own component (`SourceRef` + `pdf_page` -> `SourceRefPdfPage`) and the
   discriminator gets a mapping.
3. String enums become Swift enums that throw on a value they do not know, while every enum
   of packages/domain is open (a new value is not a breaking change). Here `enum` is removed
   from string schemas (a `const` stays), so the generated field is a String and LecternKit's
   models map it with an `unknown` case.

Nothing else changes. Usage: openapi-for-swift.py <in> <out>
"""
import json
import sys


def is_null(schema):
    return isinstance(schema, dict) and schema.get("type") == "null" and len(schema) == 1


def unwrap(schema):
    """Returns (schema, nullable) with a null branch removed from anyOf/oneOf."""
    for key in ("anyOf", "oneOf"):
        branches = schema.get(key)
        if isinstance(branches, list) and any(is_null(b) for b in branches):
            rest = [b for b in branches if not is_null(b)]
            outer = {k: v for k, v in schema.items() if k != key}
            if len(rest) == 1:
                only = rest[0]
                # A bare reference: its description is not worth an allOf wrapper type.
                return (dict(only) if "$ref" in only else {**only, **outer}), True
            return {**outer, key: rest}, True
    return schema, False


def walk(node):
    if isinstance(node, list):
        return [walk(n) for n in node]
    if not isinstance(node, dict):
        return node
    node = {k: walk(v) for k, v in node.items()}
    if node.get("type") == "string" and isinstance(node.get("enum"), list):
        del node["enum"]
    props = node.get("properties")
    if isinstance(props, dict):
        nullable = []
        for name, prop in list(props.items()):
            if isinstance(prop, dict):
                new, was_null = unwrap(prop)
                props[name] = new
                if was_null:
                    nullable.append(name)
        if nullable and isinstance(node.get("required"), list):
            node["required"] = [r for r in node["required"] if r not in nullable]
            if not node["required"]:
                del node["required"]
    for key in ("items", "additionalProperties"):
        if isinstance(node.get(key), dict):
            node[key], _ = unwrap(node[key])
    return node


def pascal(value):
    return "".join(part[:1].upper() + part[1:] for part in str(value).replace("-", "_").split("_") if part)


def hoist_inline_unions(schemas):
    """Gives each inline branch of a discriminated oneOf its own component and a mapping."""
    for name in list(schemas):
        schema = schemas[name]
        union = schema.get("oneOf") if isinstance(schema, dict) else None
        disc = schema.get("discriminator", {}).get("propertyName") if isinstance(schema, dict) else None
        if not isinstance(union, list) or not disc:
            continue
        mapping = dict(schema["discriminator"].get("mapping", {}))
        branches = []
        for branch in union:
            if "$ref" in branch:
                branches.append(branch)
                continue
            value = branch.get("properties", {}).get(disc, {}).get("const")
            if value is None:
                raise SystemExit(f"openapi-for-swift: {name} has an inline branch without a const {disc}")
            target = f"{name}{pascal(value)}"
            if target in schemas:
                raise SystemExit(f"openapi-for-swift: {target} already exists")
            schemas[target] = branch
            ref = f"#/components/schemas/{target}"
            branches.append({"$ref": ref})
            mapping[str(value)] = ref
        schema["oneOf"] = branches
        schema["discriminator"] = {**schema["discriminator"], "mapping": mapping}


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        doc = json.load(f)
    doc = walk(doc)
    hoist_inline_unions(doc["components"]["schemas"])
    out = json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=False) + "\n"
    try:
        with open(dst, encoding="utf-8") as f:
            if f.read() == out:
                return
    except FileNotFoundError:
        pass
    with open(dst, "w", encoding="utf-8") as f:
        f.write(out)


if __name__ == "__main__":
    main()
