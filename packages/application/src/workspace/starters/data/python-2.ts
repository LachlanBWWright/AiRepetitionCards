// CC BY 4.0; source, attribution and conversion details in ../README.md.
export default [
  [
    "anki:m)k?Yxya<P:0",
    "What is a generator expression, and how does it differ from a list comprehension?",
    "What is a generator expression, and how does it differ from a list comprehension?\n\nSame syntax but with parentheses: (x*2 for x in range(5)). It produces items lazily one at a time instead of building the whole list in memory. (Use it for large data so you do not load everything at once.)",
  ],
  [
    "anki:psu6X&fUXI:0",
    "How do you define a function?",
    "How do you define a function?\n\ndef name(param1, param2):\n    return result. (Like a PowerShell function, but parameters go in the parentheses and you use 'return' or the last expression.)",
  ],
  [
    "anki:fg;L+_``t!:0",
    "What is the difference between *args and **kwargs?",
    "What is the difference between *args and **kwargs?\n\n*args gathers extra positional arguments into a tuple; **kwargs gathers extra keyword arguments into a dict. (They let a function take a variable number of arguments, like a flexible param block.)",
  ],
  [
    "anki:JdF[noW6iM:0",
    "What is a default parameter value?",
    "What is a default parameter value?\n\nA value used when the caller omits the argument: def f(x, y=10). (Same concept as [string]$name = 'default' in a PowerShell param block.)",
  ],
  [
    "anki:dit}Fn-`~B:0",
    "What is the difference between a parameter and an argument?",
    "What is the difference between a parameter and an argument?\n\nA parameter is the name in the function definition; an argument is the actual value you pass in. (The same distinction PowerShell draws.)",
  ],
  [
    "anki:O*NEqKx:WM:0",
    "What is a lambda?",
    "What is a lambda?\n\nA small anonymous one-expression function: square = lambda x: x*x. (Handy as a throwaway, often passed to sorted() or filter(); like a quick scriptblock in PowerShell.)",
  ],
  [
    "anki:N1R&)@~xK}:0",
    "What does return do, and what if you leave it out?",
    "What does return do, and what if you leave it out?\n\nreturn hands a value back and exits the function. With no return, the function returns None. (In PowerShell, uncaptured output goes to the pipeline; Python only returns what you explicitly return.)",
  ],
  [
    "anki:Gn|INvozKU:0",
    "What is variable scope, and what is LEGB?",
    "What is variable scope, and what is LEGB?\n\nLEGB is the lookup order: Local, Enclosing, Global, Built-in. A name in a function is local unless declared otherwise. (PowerShell has similar scopes: local, script, global.)",
  ],
  [
    "anki:Dy|T9+`I$7:0",
    "What do global and nonlocal do?",
    "What do global and nonlocal do?\n\nglobal lets a function reassign a module-level variable; nonlocal lets a nested function reassign one in the enclosing function. (Use sparingly; needed only when you must write to an outer-scope name.)",
  ],
  [
    "anki:Jh_!z3d56B:0",
    "What is the difference between a script and a module?",
    "What is the difference between a script and a module?\n\nA script is a .py file you run directly to do work. A module is a .py file you import to reuse its functions elsewhere. The same file can act as both. (This is the exact distinction PowerShell draws between a script and a module.)",
  ],
  [
    "anki:twj>}>6;D?:0",
    "What does if __name__ == '__main__': do, and why use it?",
    "What does if __name__ == '__main__': do, and why use it?\n\nIt runs the code under it only when the file is executed directly, not when it is imported. So your file can be both a runnable script and an importable module. (There is no clean PowerShell equivalent; this is the canonical script-versus-module idiom, worth knowing cold.)",
  ],
  [
    "anki:c,_qn9L:AN:0",
    "What is the difference between import x and from x import y?",
    "What is the difference between import x and from x import y?\n\nimport x brings in the module (use x.func()). from x import y brings a specific name in directly (use y()). (Like Import-Module then calling Module\\Cmdlet vs importing the cmdlet by name.)",
  ],
  [
    "anki:ml*k8O/4zW:0",
    "What is a package in Python?",
    "What is a package in Python?\n\nA folder of modules, historically marked by an __init__.py file, that you import as a namespace. (A module is one file; a package is a directory of them. Like a PowerShell module folder with a manifest.)",
  ],
  [
    "anki:tlb3[y7KL4:0",
    "What is argparse and when do you use it?",
    "What is argparse and when do you use it?\n\nThe standard-library module for building command-line tools: it parses flags and arguments and generates help. (This is how a Python CLI tool takes parameters; the equivalent of a PowerShell param() block with validation for a script.)",
  ],
  [
    "anki:Q=G_&AW;nW:0",
    "How do you read command-line arguments in a simple script?",
    "How do you read command-line arguments in a simple script?\n\nsys.argv is a list of the arguments (sys.argv[0] is the script name). For anything real, use argparse. (sys.argv is the quick-and-dirty version, like $args in PowerShell; argparse is the proper param() block.)",
  ],
  [
    "anki:nh/)Q^Y>cw:0",
    "How do you handle errors in Python?",
    "How do you handle errors in Python?\n\ntry:\n    risky()\nexcept SomeError as e:\n    handle(e)\nfinally:\n    cleanup(). (Same try/catch/finally idea as PowerShell, but the keyword is 'except' instead of 'catch.')",
  ],
  [
    "anki:uX7I8um>`]:0",
    "What is the difference between an error and an exception?",
    "What is the difference between an error and an exception?\n\nMost runtime problems are exceptions, which are objects raised during execution and catchable with try/except. A SyntaxError happens before running. (Exception is the base class you usually catch.)",
  ],
  [
    "anki:G:YlC7*`rW:0",
    "Why is 'except Exception' better than a bare 'except:'?",
    "Why is 'except Exception' better than a bare 'except:'?\n\nA bare except swallows everything, including Ctrl-C (KeyboardInterrupt) and SystemExit, which you rarely want. except Exception catches normal errors while letting those through. (Bare except is a well-known code smell.)",
  ],
  [
    "anki:BcXYX<dTrc:0",
    "What does finally do?",
    "What does finally do?\n\nIt always runs, whether or not an exception happened, so you use it for cleanup like closing files or connections. (Same as PowerShell's finally block.)",
  ],
  [
    "anki:uFHgWqUvoh:0",
    "How do you raise an exception?",
    "How do you raise an exception?\n\nraise ValueError('message'). You can raise built-in or your own custom exception classes. (Like throw in PowerShell.)",
  ],
  [
    "anki:mB0OGwY-Pj:0",
    "What exceptions come up parsing untrusted data, and how do you handle them?",
    "What exceptions come up parsing untrusted data, and how do you handle them?\n\nKeyError (missing dict key), ValueError (bad conversion), TypeError, json.JSONDecodeError. Wrap parsing in try/except and validate before using. (Core habit for a security engineer processing logs or API responses.)",
  ],
  [
    "anki:pu|B^g;+G,:0",
    "How do you read a Python traceback when debugging?",
    "How do you read a Python traceback when debugging?\n\nRead it bottom-up: the last line is the actual exception and message; the lines above show the call path that led there. (The single most useful debugging skill; the bottom line tells you what broke.)",
  ],
  [
    "anki:C[Nn^xW=TA:0",
    "How do you read a file safely in Python?",
    "How do you read a file safely in Python?\n\nwith open('file.txt') as f:\n    data = f.read(). The 'with' auto-closes it even on error. (Get-Content is the PowerShell read; 'with' is the safe-open pattern.)",
  ],
  [
    "anki:oXHkEw{x~|:0",
    "What is a context manager and why use 'with'?",
    "What is a context manager and why use 'with'?\n\nAn object that sets up and tears down a resource automatically, like a file, lock, or DB connection. 'with open(...) as f:' guarantees the file closes even on error. (It is basically a built-in try/finally for resources; reach for it whenever you open something.)",
  ],
  [
    "anki:C=6yiA/#|C:0",
    "How would you read a large log file without loading it all into memory?",
    "How would you read a large log file without loading it all into memory?\n\nIterate line by line inside a with block: with open('log') as f: for line in f: process(line). This streams instead of reading the whole file with .read(). (Important when logs are gigabytes; the streaming habit a security engineer needs.)",
  ],
  [
    "anki:K5V)>yrkdA:0",
    "How do you parse JSON in Python?",
    "How do you parse JSON in Python?\n\nimport json; json.loads(text) parses a string, json.dumps(obj) serializes. json.load/json.dump work on file objects. (Everywhere in API and cloud work; the ConvertFrom-Json / ConvertTo-Json of Python.)",
  ],
  [
    "anki:ix+Mr2G,J::0",
    "How do you make an HTTP request in Python?",
    "How do you make an HTTP request in Python?\n\nUse the requests library: r = requests.get(url); r.json(). (The Invoke-RestMethod of Python; used to hit APIs and threat-intel feeds.)",
  ],
  [
    "anki:Sz6C2p+[f:0",
    "What is the datetime module for, and why does it matter in security work?",
    "What is the datetime module for, and why does it matter in security work?\n\nParsing, formatting, and doing math on dates and times: datetime.strptime parses a timestamp string, and you can compare or subtract times. (Essential for log correlation, working out what happened when, and time windows.)",
  ],
  [
    "anki:BL1gAN1$je:0",
    "What is hashlib used for?",
    "What is hashlib used for?\n\nComputing hashes: hashlib.sha256(data).hexdigest(). (Security-critical: file integrity, computing or matching IOCs, checksums. Know SHA-256 is preferred and MD5/SHA-1 are considered weak.)",
  ],
  [
    "anki:LKWStIiH,|:0",
    "What is the base64 module for?",
    "What is the base64 module for?\n\nEncoding and decoding base64: base64.b64decode(s). (Comes up decoding payloads, tokens, and encoded data during investigations.)",
  ],
  [
    "anki:C<8q#};:aN:0",
    "What is the ipaddress module, and give a security use.",
    "What is the ipaddress module, and give a security use.\n\nIt represents and validates IPs and networks: you can check if an address falls inside a subnet with ip_address(x) in ip_network('10.0.0.0/8'). (Exactly the 'is this IP in our range' question a security engineer asks constantly.)",
  ],
  [
    "anki:QZ4L[P_Zas:0",
    "What does the os module give you?",
    "What does the os module give you?\n\nOperating-system access: os.environ for environment variables, os.path for paths, os.listdir, running in a cross-platform way. (os.environ is how you read secrets from the environment instead of hardcoding them.)",
  ],
  [
    "anki:s,Vf*O9*j&:0",
    "What is the subprocess module, and what is the security gotcha?",
    "What is the subprocess module, and what is the security gotcha?\n\nIt runs external commands: subprocess.run(['ls','-l']). The gotcha is shell=True with unsanitized input, which is a command-injection vulnerability. Pass a list of args and avoid shell=True. (A classic security review catch.)",
  ],
  [
    "anki:Ey:?;K|9`/:0",
    "Why use the logging module instead of print?",
    "Why use the logging module instead of print?\n\nlogging gives levels (debug/info/warning/error), timestamps, and configurable outputs, so it produces real audit trails. print just writes to stdout. (For any production or security tool, logging is the professional choice; like using Write-Verbose/proper logging over Write-Host.)",
  ],
  [
    "anki:F{>[Sn9|LJ:0",
    "What is pathlib?",
    "What is pathlib?\n\nThe modern, object-oriented way to handle filesystem paths: Path('dir') / 'file.txt'. Cleaner and cross-platform versus string paths. (Preferred over os.path in new code.)",
  ],
  [
    "anki:Pj@uat>vz[:0",
    "How do you work with CSV data?",
    "How do you work with CSV data?\n\nimport csv; csv.DictReader for reading rows as dicts, csv.writer for writing. Or pandas for heavier work. (Import-Csv / Export-Csv are the PowerShell equivalents.)",
  ],
  [
    "anki:rLg2w-/NLV:0",
    "What is pandas and when would you use it?",
    "What is pandas and when would you use it?\n\nA data-analysis library with DataFrames (table-like structures) for cleaning, joining, filtering, and analyzing data. (You would use it to join disparate log sources or enrich alerts; heavier than the csv module.)",
  ],
  [
    "anki:rx><16R#:p:0",
    "How do you use regular expressions in Python?",
    "How do you use regular expressions in Python?\n\nimport re; re.search(pattern, text), re.findall(pattern, text), re.sub(pattern, repl, text). (Used constantly to parse logs and pull out IOCs; PowerShell's -match / -replace are the parallels.)",
  ],
  [
    "anki:I[p~(ms`)(:0",
    "How should you handle secrets in a Python script?",
    "How should you handle secrets in a Python script?\n\nNever hardcode them. Read from environment variables (os.environ), a secrets manager, or a vault, and keep them out of source control. (Standard security hygiene; the answer is always 'not in the code.')",
  ],
  [
    "anki:pz5H&5pMED:0",
    "What is the difference between stdout and stderr?",
    "What is the difference between stdout and stderr?\n\nstdout is normal program output; stderr is for errors and diagnostics, kept separate so you can redirect them independently. (Same split as PowerShell's output vs error streams.)",
  ],
] as const;
