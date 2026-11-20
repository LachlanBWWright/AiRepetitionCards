// CC BY 4.0; source, attribution and conversion details in ../README.md.
export default [
  [
    "anki:GrLuPj/$`:0",
    "How do you write to stderr in Python?",
    "How do you write to stderr in Python?\n\nprint('msg', file=sys.stderr), or use the logging module. (Keeps error messages out of the normal output stream so piped data stays clean.)",
  ],
  [
    "anki:k#]SWVZP8f:0",
    "How do you redirect output at the shell when running a Python script?",
    "How do you redirect output at the shell when running a Python script?\n\npython script.py > out.txt sends stdout to a file; 2> err.txt sends stderr; 2>&1 merges them. (The same redirection operators PowerShell uses: > and 2>.)",
  ],
  [
    "anki:bCxGQ@s>7;:0",
    "How do you debug Python code?",
    "How do you debug Python code?\n\nInsert breakpoint() (or import pdb; pdb.set_trace()) to drop into the debugger, step through, and inspect variables. Read the traceback bottom-up. Use logging over scattered prints. (A real method beats scattering prints everywhere.)",
  ],
  [
    "anki:Rdj~}y]Y#/:0",
    "What does the print() function do with multiple arguments?",
    "What does the print() function do with multiple arguments?\n\nprint(a, b, c) prints them separated by spaces and adds a newline. You can change sep= and end=. (Write-Host / Write-Output are the loose PowerShell parallels.)",
  ],
  [
    "anki:pEtPU!#?}~:0",
    "What is a class and an object?",
    "What is a class and an object?\n\nA class is a blueprint; an object is an instance made from it. class Dog: defines it; d = Dog() creates one. (PowerShell 5+ also has classes with the same idea.)",
  ],
  [
    "anki:L1*t>ua^+T:0",
    "What is self in a method?",
    "What is self in a method?\n\nself is the current instance, so methods can read and set that object's attributes. It is the first parameter of instance methods. (Roughly like $this inside a PowerShell class.)",
  ],
  [
    "anki:n)t_XODHPc:0",
    "What is __init__?",
    "What is __init__?\n\nThe constructor, called automatically when you create an instance, used to set up initial attributes. (Like a class constructor in PowerShell.)",
  ],
  [
    "anki:P#&O:Rg]jP:0",
    "What is the difference between a function and a method?",
    "What is the difference between a function and a method?\n\nA method belongs to an object or class and takes self; a function stands alone. (The same distinction exists in PowerShell classes.)",
  ],
  [
    "anki:iXS9sWAg3q:0",
    "What is a decorator?",
    "What is a decorator?\n\nA function that wraps another to add behavior, applied with @name above the definition. Examples: @staticmethod, @property, timing or logging wrappers. (Think of it as automatically piping a function through a wrapper.)",
  ],
  [
    "anki:ez3E)[Whw3:0",
    "What is a generator, and why use one?",
    "What is a generator, and why use one?\n\nA function that uses yield to produce values one at a time, lazily, instead of building a full list in memory. (Great for streaming large datasets, like reading a huge log without loading it all.)",
  ],
  [
    "anki:LlmXUkvmxe:0",
    "What is the difference between yield and return?",
    "What is the difference between yield and return?\n\nreturn exits the function with a value. yield produces a value but pauses the function, resuming on the next request, which makes it a generator. (yield is how you make something you can iterate over lazily.)",
  ],
  [
    "anki:h-;ndsDO>g:0",
    "What is collections.Counter, and give a security use?",
    "What is collections.Counter, and give a security use?\n\nCounter tallies occurrences: Counter(ip_list) gives each IP's count, and .most_common(5) gives the top 5. (Perfect for counting failed logins per IP; saves writing the tally loop by hand.)",
  ],
  [
    "anki:ugwKQx/b95:0",
    "What is collections.defaultdict?",
    "What is collections.defaultdict?\n\nA dict that auto-creates a default value for missing keys, so you can do d[key].append(x) without checking if the key exists first. (Removes the 'if key not in dict' boilerplate when grouping data.)",
  ],
  [
    "anki:Ntl4^Z%,.1:0",
    "What is a namedtuple?",
    "What is a namedtuple?\n\nA tuple with named fields, so you access p.x instead of p[0]. (Gives you lightweight, readable records without writing a full class.)",
  ],
  [
    "anki:iGe1K`J}-/:0",
    "What do split() and join() do?",
    "What do split() and join() do?\n\n'a,b,c'.split(',') gives ['a','b','c']; ','.join(list) rebuilds the string. (The core of parsing a log line into fields and reassembling; PowerShell's -split and -join.)",
  ],
  [
    "anki:sd`RZ[uyW2:0",
    "What does strip() do?",
    "What does strip() do?\n\nRemoves leading and trailing whitespace (or specified characters): line.strip(). (Cleaning up parsed log fields; .Trim() in PowerShell.)",
  ],
  [
    "anki:r#wbH]d|&&:0",
    "How do you check if a string contains a substring?",
    "How do you check if a string contains a substring?\n\n'error' in line returns True/False. For position, use line.find('x') (returns -1 if absent) or line.index('x') (raises if absent). (The 'in' test is the quick membership check.)",
  ],
  [
    "anki:d,/;4+:&)]:0",
    "What do startswith() and endswith() do?",
    "What do startswith() and endswith() do?\n\nline.startswith('GET') and filename.endswith('.log') test the ends of a string. (Common for filtering log lines or filenames.)",
  ],
  [
    "anki:kd[hsAp>m>:0",
    "How do you change string case?",
    "How do you change string case?\n\ns.lower(), s.upper(), s.title(). (Useful for case-insensitive matching, like normalizing usernames or domains.)",
  ],
  [
    "anki:kZt4n^Gso~:0",
    "How do you replace text in a string?",
    "How do you replace text in a string?\n\ns.replace('old', 'new'). For pattern-based replacement, use re.sub. (Direct analog of PowerShell's -replace, minus the regex unless you use re.)",
  ],
  [
    "anki:de=Bi]15a@:0",
    "What is the difference between dict['key'] and dict.get('key')?",
    "What is the difference between dict['key'] and dict.get('key')?\n\nBracket access raises KeyError if the key is missing; .get('key') returns None (or a default you pass) instead. (Use .get() when a missing key is normal and should not crash you.)",
  ],
  [
    "anki:dt!,Bz`HUD:0",
    "How do you iterate a dictionary's keys and values together?",
    "How do you iterate a dictionary's keys and values together?\n\nfor key, value in my_dict.items(). Use .keys() or .values() for just one. (In PowerShell you would use .GetEnumerator(); .items() is the Python way.)",
  ],
  [
    "anki:dV-1OE<Phk:0",
    "How do you safely group items into a dict of lists?",
    "How do you safely group items into a dict of lists?\n\nUse defaultdict(list) and d[key].append(item), or dict.setdefault(key, []).append(item). (Avoids checking whether the key exists first; common when bucketing events by host or IP.)",
  ],
  [
    "anki:dyMf3klAa5:0",
    "How do you merge two dictionaries?",
    "How do you merge two dictionaries?\n\nPython 3.9+: d1 | d2. Older: {**d1, **d2} or d1.update(d2). (Later keys win on conflicts.)",
  ],
  [
    "anki:xy><_s,2?2:0",
    "What is an f-string, and why is it preferred?",
    "What is an f-string, and why is it preferred?\n\nString interpolation with an f prefix: f'{user} logged in at {ts}'. Expressions inside braces are evaluated inline. It is the modern, readable standard. (Cleaner than concatenation; the PowerShell equivalent is \"$user logged in\".)",
  ],
  [
    "anki:Kt|{QpWrpz:0",
    "What are format specifiers inside f-strings?",
    "What are format specifiers inside f-strings?\n\nFormatting controls after a colon: f'{value:.2f}' for two decimals, f'{n:,}' for thousands separators, f'{x:>10}' to right-align in 10 spaces. (Used for clean, aligned report or table output.)",
  ],
  [
    "anki:BNU(T8a@k5:0",
    "What are the older string formatting styles you might see?",
    "What are the older string formatting styles you might see?\n\nPercent style: '%s' % name. And .format(): '{}'.format(name). (You will meet both in legacy code and some logging calls; f-strings are what you write today.)",
  ],
  [
    "anki:Kad*3kBTx9:0",
    "What is the tabs-vs-spaces gotcha in Python?",
    "What is the tabs-vs-spaces gotcha in Python?\n\nPython uses indentation for blocks, and mixing tabs and spaces raises IndentationError or TabError. Standard is 4 spaces. (A real trap since whitespace is syntax, unlike PowerShell's braces.)",
  ],
  [
    "anki:b%<QOW|.xC:0",
    "Why does 0.1 + 0.2 not equal 0.3 in Python?",
    "Why does 0.1 + 0.2 not equal 0.3 in Python?\n\nFloating-point numbers cannot represent some decimals exactly, so 0.1 + 0.2 is 0.30000000000000004. Never compare floats with ==; use a tolerance (math.isclose). (A classic 'predict the output' trap.)",
  ],
  [
    "anki:z$&~6`kSM+:0",
    "What is the difference between / and // in Python 3?",
    "What is the difference between / and // in Python 3?\n\n/ is true division and always returns a float (4/2 is 2.0). // is floor division (7//2 is 3). (In Python 3 even 4/2 gives 2.0, which surprises people; PowerShell's / behaves more like true division too.)",
  ],
  [
    "anki:BTv&BdmK(*:0",
    "What happens if you modify a list while iterating over it?",
    "What happens if you modify a list while iterating over it?\n\nYou get skipped elements or errors because the indices shift under you. Iterate over a copy (for x in list[:]) or build a new list instead. (A subtle bug worth knowing on sight.)",
  ],
  [
    "anki:vduEA3=F-N:0",
    "What do 'and' and 'or' actually return in Python?",
    "What do 'and' and 'or' actually return in Python?\n\nThey return one of the operands, not a strict boolean: 0 or 'hi' returns 'hi'; 'a' and 'b' returns 'b'. (Useful for defaults like name = given or 'anonymous'.)",
  ],
  [
    "anki:J$%v(OEBB_:0",
    "What does negative indexing do?",
    "What does negative indexing do?\n\nlist[-1] is the last element, list[-2] the second-to-last. (Cleaner than len(list)-1; a small fluency tell.)",
  ],
  [
    "anki:sMTsr#{0_c:0",
    "What does slicing an out-of-range range return?",
    "What does slicing an out-of-range range return?\n\nIt does not error: [1,2,3][5:10] returns []. Slicing is forgiving, unlike indexing a single out-of-range element, which raises IndexError. (Good to know so you do not over-guard slices.)",
  ],
  [
    "anki:ctcMk0PR,!:0",
    "What does list slicing syntax mean, e.g. my_list[1:4] and [::-1]?",
    "What does list slicing syntax mean, e.g. my_list[1:4] and [::-1]?\n\nmy_list[1:4] takes items from index 1 up to but not including 4. [::-1] reverses the sequence. Works on lists, strings, tuples. (Slicing is one of Python's most-used features.)",
  ],
  [
    "anki:Ex+>dVvr!w:0",
    "What is the walrus operator :=?",
    "What is the walrus operator :=?\n\nAssigns a value inside an expression: if (n := len(data)) > 10:. It lets you assign and test in one line. (Newer syntax; recognizing it signals you keep up with the language.)",
  ],
  [
    "anki:LU1niUCE12:0",
    "What is a ternary (conditional) expression in Python?",
    "What is a ternary (conditional) expression in Python?\n\nvalue = a if condition else b. A one-line if/else that returns a value. (The compact form for simple either-or assignments.)",
  ],
  [
    "anki:L1d^*k9/s.:0",
    "How do you swap two variables in Python?",
    "How do you swap two variables in Python?\n\na, b = b, a. Tuple unpacking does it in one line with no temp variable. (A small idiom that signals real Python familiarity.)",
  ],
  [
    "anki:P&iAWyxFR`:0",
    "What is unpacking, including * unpacking?",
    "What is unpacking, including * unpacking?\n\na, b, c = [1,2,3] assigns each; first, *rest = [1,2,3,4] puts 1 in first and [2,3,4] in rest. (Handy for pulling apart records or splitting a header from the rest of a list.)",
  ],
  [
    "anki:cQPiBeObNG:0",
    "Why is eval() or exec() on untrusted input dangerous?",
    "Why is eval() or exec() on untrusted input dangerous?\n\nThey execute arbitrary code from a string, so untrusted input becomes remote code execution. Avoid them on any external data. (A security engineer is expected to flag this immediately.)",
  ],
] as const;
