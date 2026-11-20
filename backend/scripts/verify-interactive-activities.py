#!/usr/bin/env python3
"""Isolated local HTTP acceptance for interactive execution and activity persistence."""
import copy
import importlib.util
from pathlib import Path
import sys
from verify_deck_sharing_http import CheckFailure, checked, require

spec = importlib.util.spec_from_file_location("study_fixture", Path(__file__).with_name("verify-study-sync.py"))
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)

LUA = """return {
init=function(c,seed) return {count=c.start} end,
view=function(s) return {text=tostring(s.count),buttons={{id='add',label='Add'}}} end,
update=function(s,e) return {count=s.count+1} end,
assess=function(s) return {complete=s.count==3,score=s.count==3 and 1 or 0,feedback='Count to three.'} end
}"""

def run(fixture):
    token, other = fixture.actor("interactive"), fixture.actor("other")
    request = dict(script=LUA, configuration={"start": 2}, seed=1, operation="init")
    checked("Reject anonymous Lua execution", fixture.api("/api/v1/activities/lua", "POST", request), (401,))
    first = checked("Execute isolated Lua initialization", fixture.api("/api/v1/activities/lua", "POST", request, token), (200,))
    require(first.get("value") == {"count": 2}, "Lua initialization result mismatch.")
    request.update(operation="update", state=first["value"], event={"id": "add"})
    next_state = checked("Execute bounded Lua interaction", fixture.api("/api/v1/activities/lua", "POST", request, token), (200,))
    request.update(operation="assess", state=next_state["value"])
    result = checked("Execute isolated Lua assessment", fixture.api("/api/v1/activities/lua", "POST", request, token), (200,))
    require(result.get("value", {}).get("complete") is True, "Lua result did not complete.")
    invalid = dict(request, script="while true do end")
    checked("Bound infinite Lua script", fixture.api("/api/v1/activities/lua", "POST", invalid, token), (422,))
    checked("Reject unsupported Lua operation", fixture.api("/api/v1/activities/lua", "POST", dict(request, operation="filesystem"), token), (400,))
    source = study.area(study.identifier())
    study.push(fixture, token, [study.entry(source)])
    activity = {"id": study.identifier(), "areaId": source["id"], "title": "Sum values", "pluginId": "recall.coding", "pluginVersion": 1, "revision": 1,
        "objectiveIds": ["sum"], "fallback": "Sum an array.", "payload": {"prompts": ["Implement solve(values)."], "rubric": "Sum values.", "reference": "Use a fold.", "language": "javascript",
        "tests": [{"input": [[1, 2, 3]], "expected": 6}, {"input": [[]], "expected": 0}], "exampleTests": [{"input": [[1, 2, 3]], "expected": 6}]}}
    path = "/api/v1/activities"
    snapshot = checked("Read empty activity library", fixture.api(path, token=token), (200,))
    library = snapshot["library"]
    library["activities"] = [activity]
    saved = checked("Save isolated coding activity", fixture.api(path, "POST", {"revision": snapshot["revision"], "library": library}, token), (200,))
    response = {"answers": ["function solve(values) { return 6; }"], "selectedOptionIds": [], "selfScore": 0.5, "assistance": "none"}
    for mode, expected_total in [("run", 1), ("submit", 2)]:
        executed = checked("Execute coding " + mode, fixture.api(path + "/execute", "POST", {"activity": activity, "response": response, "executionMode": mode}, token), (200,))
        require(executed.get("total") == expected_total and executed.get("passed") == 1, "Run/Submit test selection mismatch.")
    after = checked("Read library after execution", fixture.api(path, token=token), (200,))
    require(after["library"]["attempts"] == [], "Execution silently accepted an attempt.")
    isolated = checked("Read unrelated activity account", fixture.api(path, token=other), (200,))
    require(isolated["library"]["activities"] == [], "Activities leaked across accounts.")
    invalid_library = copy.deepcopy(after["library"])
    invalid_library["drafts"] = [{"id": "invalid", "activity": activity, "response": dict(response, interaction={"retries": -1}), "stage": 0, "startedAt": "2026-10-25T12:00:00.000Z", "updatedAt": "2026-10-25T12:00:00.000Z"}]
    checked("Reject malformed interaction evidence", fixture.api(path, "POST", {"revision": after["revision"], "library": invalid_library}, token), (400,))


def main():
    fixture = study.Fixture()
    try:
        run(fixture)
        print("Interactive API checks passed; isolated fixtures will be removed.")
        return 0
    except (CheckFailure, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        require(not fixture.cleanup(), "Interactive fixture cleanup failed.")

if __name__ == "__main__":
    sys.exit(main())
