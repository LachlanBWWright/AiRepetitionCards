"""Learner-side JSON function adapter; the parent compares the result."""
import json
import runpy
import sys

arguments = json.loads(sys.stdin.read())
solution = runpy.run_path(sys.argv[1])
print(json.dumps(solution["solve"](*arguments), allow_nan=False))
