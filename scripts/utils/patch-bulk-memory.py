#!/usr/bin/env python3
"""Replace memory.copy/memory.fill with inline loop functions in a WAT file."""

import re
import subprocess
import sys

WAT_PATH = '/tmp/compute_registry.wat'
PATCHED_WAT = '/tmp/compute_registry_patched.wat'
OUTPUT_WASM = '/tmp/compute_registry_patched.wasm'

with open(WAT_PATH, 'r') as f:
    wat = f.read()

# Find where to insert the helper functions - before the first (func ...)
first_func = wat.find('  (func ')
if first_func == -1:
    print("No (func) found")
    sys.exit(1)

# Use inline type declaration to avoid shifting type indices
memcpy_func = """  (func $memcpy (param $dest i32) (param $src i32) (param $len i32)
    (block $done
      (loop $loop
        (local.get $len)
        (i32.eqz)
        (br_if $done)
        (local.get $dest)
        (local.get $src)
        (i32.load8_u)
        (i32.store8)
        (local.get $dest)
        (i32.const 1)
        (i32.add)
        (local.set $dest)
        (local.get $src)
        (i32.const 1)
        (i32.add)
        (local.set $src)
        (local.get $len)
        (i32.const 1)
        (i32.sub)
        (local.set $len)
        (br $loop)
      )
    )
  )
  (func $memset (param $dest i32) (param $val i32) (param $len i32)
    (block $done
      (loop $loop
        (local.get $len)
        (i32.eqz)
        (br_if $done)
        (local.get $dest)
        (local.get $val)
        (i32.store8)
        (local.get $dest)
        (i32.const 1)
        (i32.add)
        (local.set $dest)
        (local.get $len)
        (i32.const 1)
        (i32.sub)
        (local.set $len)
        (br $loop)
      )
    )
  )
"""

wat = wat[:first_func] + memcpy_func + wat[first_func:]

# Replace memory.copy and memory.fill with calls
# Must match at word boundaries to avoid partial matches
wat = re.sub(r'(?<![\w.])memory\.copy(?![\w])', 'call $memcpy', wat)
wat = re.sub(r'(?<![\w.])memory\.fill(?![\w])', 'call $memset', wat)

with open(PATCHED_WAT, 'w') as f:
    f.write(wat)

print(f"Patched WAT written to {PATCHED_WAT}")
print(f"Replaced {len(re.findall(r'call \\$memcpy', wat))} memory.copy")
print(f"Replaced {len(re.findall(r'call \\$memset', wat))} memory.fill")

# Convert back to WASM
result = subprocess.run(
    ['wat2wasm', PATCHED_WAT, '-o', OUTPUT_WASM],
    capture_output=True, text=True
)
if result.returncode != 0:
    print("wat2wasm failed:")
    print(result.stderr)
    sys.exit(1)

print(f"WASM written to {OUTPUT_WASM}")

# Verify no bulk memory ops remain
with open(OUTPUT_WASM, 'rb') as f:
    wasm = f.read()

for i in range(len(wasm)):
    if wasm[i] == 0xFC and i+1 < len(wasm):
        sub = wasm[i+1]
        if sub in (0x0A, 0x0B, 0x08, 0x09):
            print(f"WARNING: bulk memory op remaining at offset {i:#x}: sub={sub:#x}")
            sys.exit(1)

print("Verified: no bulk memory ops remain!")
