#!/usr/bin/env python3
"""
将 personalities 向量值量化为实际可达的离散值：0, ±0.3, ±0.65, ±1.0
"""
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(BASE, 'data', 'quiz-data.json')

def quantize(v):
    av = abs(v)
    sign = 1 if v >= 0 else -1
    if av >= 0.85:
        return sign * 1.0
    elif av >= 0.45:
        return sign * 0.65
    elif av >= 0.15:
        return sign * 0.3
    else:
        return 0.0

with open(PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

changed = []
for name, vec in data['personalities'].items():
    new_vec = {}
    for d, val in vec.items():
        qv = quantize(val)
        new_vec[d] = qv
        if qv != val:
            changed.append(f"{name}.{d}: {val} -> {qv}")
    data['personalities'][name] = new_vec

with open(PATH, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Quantized {len(changed)} values")
for c in changed:
    print(f"  {c}")
