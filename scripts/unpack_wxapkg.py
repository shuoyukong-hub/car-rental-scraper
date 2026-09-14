#!/usr/bin/env python3
"""Extract a standard WeChat mini-program wxapkg file."""

import argparse
import struct
from pathlib import Path


def read_u32(data: bytes, offset: int) -> tuple[int, int]:
    if offset + 4 > len(data):
        raise ValueError("truncated wxapkg index")
    return struct.unpack_from(">I", data, offset)[0], offset + 4


def unpack(package: Path, output_dir: Path) -> int:
    data = package.read_bytes()
    if len(data) < 18 or data[0] != 0xBE or data[13] != 0xED:
        raise ValueError("unsupported or invalid wxapkg header")

    index_size = struct.unpack_from(">I", data, 5)[0]
    body_size = struct.unpack_from(">I", data, 9)[0]
    if 14 + index_size + body_size != len(data):
        raise ValueError("wxapkg size fields do not match file size")

    file_count, cursor = read_u32(data, 14)
    entries = []
    for _ in range(file_count):
        name_size, cursor = read_u32(data, cursor)
        name_end = cursor + name_size
        if name_end > len(data):
            raise ValueError("truncated wxapkg filename")
        name = data[cursor:name_end].decode("utf-8")
        cursor = name_end
        file_offset, cursor = read_u32(data, cursor)
        file_size, cursor = read_u32(data, cursor)
        entries.append((name, file_offset, file_size))

    output_root = output_dir.resolve()
    for name, file_offset, file_size in entries:
        relative = Path(name.lstrip("/"))
        target = (output_root / relative).resolve()
        if output_root not in target.parents:
            raise ValueError(f"unsafe package path: {name}")
        end = file_offset + file_size
        if end > len(data):
            raise ValueError(f"truncated file payload: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data[file_offset:end])

    return len(entries)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    count = unpack(args.package, args.output_dir)
    print(f"extracted {count} files to {args.output_dir}")


if __name__ == "__main__":
    main()
