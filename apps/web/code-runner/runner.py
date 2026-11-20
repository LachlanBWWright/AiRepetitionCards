"""Image-owned supervisor: learner processes never receive expected results."""
import json
import os
from pathlib import Path
import resource
import selectors
import signal
import subprocess
import sys
import tempfile
import time

OUTPUT_LIMIT = 65536
COMPILE_SECONDS = 15
EXECUTE_SECONDS = 8


def limits():
    # Permit Rust artifacts; pipe output has its own smaller streaming bound.
    resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def invoke(command, stdin, budget, directory):
    process = subprocess.Popen(
        command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, cwd=directory, start_new_session=True,
        preexec_fn=limits, env={"PATH": os.environ["PATH"], "HOME": directory},
    )
    streams = {"stdout": bytearray(), "stderr": bytearray()}
    pending = memoryview(stdin.encode())
    deadline = time.monotonic() + max(0.01, budget)
    timed_out = False
    exceeded = False
    with selectors.DefaultSelector() as selector:
        for stream, kind in [(process.stdout, "stdout"), (process.stderr, "stderr")]:
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, kind)
        os.set_blocking(process.stdin.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
        try:
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    break
                for key, _ in selector.select(min(remaining, 0.05)):
                    if key.data == "stdin":
                        pending = write_input(key.fileobj, pending)
                        if not pending:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                    else:
                        chunk = os.read(key.fd, 8192)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                        else:
                            streams[key.data].extend(chunk)
                            exceeded = len(streams[key.data]) > OUTPUT_LIMIT
                    if exceeded:
                        break
                if exceeded:
                    break
            if not timed_out and not exceeded:
                try:
                    process.wait(timeout=max(0.01, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    timed_out = True
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()
    return (
        process.returncode,
        streams["stdout"][:OUTPUT_LIMIT].decode("utf8", "replace"),
        streams["stderr"][:OUTPUT_LIMIT].decode("utf8", "replace"),
        timed_out, exceeded,
    )


def write_input(stream, pending):
    if not pending:
        return pending
    try:
        return pending[os.write(stream.fileno(), pending):]
    except BrokenPipeError:
        return memoryview(b"")


def prepare(request, directory):
    source = request["source"]
    language = request["language"]
    if language == "javascript":
        Path(directory, "source.js").write_text(source)
        compiled = invoke(["node", "--check", "source.js"], "", COMPILE_SECONDS, directory)
        return ["node", "--max-old-space-size=64", "/runner/javascript.cjs"], compiled
    if language == "python":
        path = Path(directory, "solution.py")
        path.write_text(source)
        compiled = invoke(
            ["python3", "-I", "-m", "py_compile", str(path)],
            "", COMPILE_SECONDS, directory,
        )
        return ["python3", "-I", "/runner/python.py", str(path)], compiled
    arity = len(request["tests"][0]["input"])
    arguments = ",".join("args[%d].clone()" % index for index in range(arity))
    wrapper = '''
fn main() {
    use std::io::Read;
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let args: Vec<serde_json::Value> = serde_json::from_str(&input).unwrap();
    let result: serde_json::Value = solve(ARGUMENTS);
    println!("{}", serde_json::to_string(&result).unwrap());
}
'''.replace("ARGUMENTS", arguments)
    Path(directory, "solution.rs").write_text("use serde_json::{Value, json};\n" + source + wrapper)
    libraries = list(Path("/runner/deps").glob("libserde_json-*.rlib"))
    compiled = invoke(
        ["rustc", "--edition=2021", "solution.rs", "-o", "solution", "-L", "dependency=/runner/deps",
         "--extern", "serde_json=" + str(libraries[0])],
        "", COMPILE_SECONDS, directory,
    )
    return [str(Path(directory, "solution"))], compiled


def evaluate(request):
    started = time.monotonic()
    tests = request["tests"]
    result = {"passed": 0, "total": len(tests), "failures": [], "status": "passed", "diagnostics": []}
    with tempfile.TemporaryDirectory(prefix="code-", dir="/tmp") as directory:
        command, compiled = prepare(request, directory)
        if compiled and (compiled[0] != 0 or compiled[3] or compiled[4]):
            result.update(status="timeout" if compiled[3] else "error",
                          failures=["Compilation timed out." if compiled[3] else "Compilation failed."],
                          diagnostics=[compiled[2][:2000]])
        else:
            deadline = time.monotonic() + EXECUTE_SECONDS
            for index, test in enumerate(tests):
                if time.monotonic() >= deadline:
                    result["status"] = "timeout"
                    result["failures"].append("Test %d: timed out." % (index + 1))
                    continue
                stdin = json.dumps({"input": test["input"]}) if request["language"] == "javascript" else json.dumps(test["input"])
                code, output, errors, timeout, exceeded = invoke(command, stdin, min(1, deadline - time.monotonic()), directory)
                if timeout or "Script execution timed out" in errors:
                    result["status"] = "timeout"
                    result["failures"].append("Test %d: timed out." % (index + 1))
                    continue
                if code != 0 or exceeded:
                    if result["status"] != "timeout":
                        result["status"] = "error"
                    result["failures"].append("Test %d: runtime error or output limit exceeded." % (index + 1))
                    if errors and len(result["diagnostics"]) < 3:
                        result["diagnostics"].append(errors[:1000])
                    continue
                try:
                    actual = json.loads(output)
                    # JSON equality, avoiding Python's bool == int coercion.
                    matches = equal(actual, test["expected"])
                except (ValueError, RecursionError):
                    matches = False
                if matches:
                    result["passed"] += 1
                else:
                    if result["status"] == "passed":
                        result["status"] = "failed"
                    result["failures"].append("Test %d: returned the wrong value." % (index + 1))
    result["runtimeMs"] = round((time.monotonic() - started) * 1000)
    return result


def equal(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(equal(value, right[key]) for key, value in left.items())
    if isinstance(left, list):
        return len(left) == len(right) and all(equal(a, b) for a, b in zip(left, right))
    return left == right


if __name__ == "__main__":
    data = sys.stdin.buffer.read(200001)
    if len(data) > 200000:
        sys.exit(2)
    print(json.dumps(evaluate(json.loads(data))))
