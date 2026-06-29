#!/usr/bin/env python3
import re
import subprocess
import sys

WAT_PATH = '/tmp/compute_registry.wat'
PATCHED_WAT = '/tmp/compute_registry_patched.wat'
OUTPUT_WASM = '/tmp/compute_registry_patched.wasm'

with open(WAT_PATH, 'r') as f:
    wat = f.read()

mc_count = len(re.findall(r'(?<![\w.])memory\.copy(?![\w])', wat))
mf_count = len(re.findall(r'(?<![\w.])memory\.fill(?![\w])', wat))
print(f'Found {mc_count} memory.copy, {mf_count} memory.fill')

if mc_count == 0 and mf_count == 0:
    print('No bulk memory ops to patch.')
    subprocess.run(['cp', WAT_PATH, PATCHED_WAT])
    subprocess.run(['wat2wasm', PATCHED_WAT, '-o', OUTPUT_WASM])
    sys.exit(0)

wat = re.sub(r'(?<![\w.])memory\.copy(?![\w])', lambda m: 'call $memmove', wat)
wat = re.sub(r'(?<![\w.])memory\.fill(?![\w])', lambda m: 'call $memset', wat)

helper_funcs = """
  (func $memmove (param $dest i32) (param $src i32) (param $len i32)
    (if (i32.lt_u (local.get $dest) (local.get $src))
      (then
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
      (else
        (block $done
          (loop $loop
            (local.get $len)
            (i32.eqz)
            (br_if $done)
            (local.get $len)
            (i32.const 1)
            (i32.sub)
            (local.set $len)
            (local.get $dest)
            (local.get $len)
            (i32.add)
            (local.get $src)
            (local.get $len)
            (i32.add)
            (i32.load8_u)
            (i32.store8)
            (br $loop)
          )
        )
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

last_paren = wat.rfind(')')
if last_paren == -1:
    print("No closing paren found")
    sys.exit(1)

wat = wat[:last_paren] + helper_funcs + wat[last_paren:]

with open(PATCHED_WAT, 'w') as f:
    f.write(wat)

print(f'Patched WAT written to {PATCHED_WAT}')
mc_after = len(re.findall(r'(?<![\w.])memory\.copy(?![\w])', wat))
mf_after = len(re.findall(r'(?<![\w.])memory\.fill(?![\w])', wat))
print(f'Remaining: {mc_after} memory.copy, {mf_after} memory.fill')

result = subprocess.run(
    ['wat2wasm', PATCHED_WAT, '-o', OUTPUT_WASM],
    capture_output=True, text=True
)
if result.returncode != 0:
    print("wat2wasm failed:")
    print(result.stderr)
    sys.exit(1)

print(f"WASM written to {OUTPUT_WASM}")

with open(OUTPUT_WASM, 'rb') as f:
    wasm = f.read()

for i in range(len(wasm)):
    if wasm[i] == 0xFC and i+1 < len(wasm):
        sub = wasm[i+1]
        if sub in (0x0A, 0x0B, 0x08, 0x09):
            print(f"WARNING: bulk memory op remaining at offset {i:#x}: sub={sub:#x}")
            sys.exit(1)

print("Verified: no bulk memory ops remain!")
