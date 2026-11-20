// CC BY 4.0; source, attribution and conversion details in ../README.md.
export default [
  [
    "anki:xac4$iB_76:0",
    "What is Python, and how does it differ from a compiled language like C?",
    "What is Python, and how does it differ from a compiled language like C?\n\nPython is a high-level, interpreted, dynamically-typed language. Code runs through an interpreter at runtime rather than being compiled to machine code ahead of time. (Like PowerShell, it is interpreted and object-oriented, not compiled like C.)",
  ],
  [
    "anki:Bw:$FmW5N:0",
    "What does it mean that Python is dynamically typed?",
    "What does it mean that Python is dynamically typed?\n\nVariable types are figured out at runtime, not declared up front. The same variable can hold an int then a string. (PowerShell is the same way; you just write $x = 5 or x = 5 without declaring a type.)",
  ],
  [
    "anki:N0`srmmfSA:0",
    "What is duck typing?",
    "What is duck typing?\n\nIf an object has the methods you need, you can use it regardless of its actual class. If it walks like a duck and quacks like a duck, it is a duck. (Python cares about behavior, not the type name. PowerShell behaves similarly with its object pipeline.)",
  ],
  [
    "anki:v/,Xs_RN<#:0",
    "What is CPython?",
    "What is CPython?\n\nThe standard, reference implementation of Python, written in C. It compiles your source to bytecode, then interprets that bytecode. (When people say Python they almost always mean CPython.)",
  ],
  [
    "anki:dS]e7Yo]8t:0",
    "What is PEP 8?",
    "What is PEP 8?\n\nThe official style guide for Python: 4-space indentation, naming conventions, spacing, line length. (The rough equivalent of PowerShell's community style conventions, but more formalized and widely enforced by tools.)",
  ],
  [
    "anki:kV^qMX52*m:0",
    "What is the difference between Python 2 and Python 3?",
    "What is the difference between Python 2 and Python 3?\n\nPython 3 is current; Python 2 is dead (end of life). In 3, print is a function, division of two ints gives a float, and strings are Unicode by default. (If you see print without parentheses, that is old Python 2 code.)",
  ],
  [
    "anki:Gry;z12pC*:0",
    "What is the REPL?",
    "What is the REPL?\n\nThe interactive Read-Eval-Print Loop you get by typing 'python' with no file. You type code and see results immediately. (Exactly like the interactive PowerShell console where you test commands one line at a time.)",
  ],
  [
    "anki:ebr{T1gY,w:0",
    "How do you find out what type an object is?",
    "How do you find out what type an object is?\n\ntype(obj) returns the object's type; you can also use isinstance(obj, SomeType) to test it. (This is the Get-Member / .GetType() habit from PowerShell; type() answers 'what is this thing.')",
  ],
  [
    "anki:G%_8|$s8L<:0",
    "How do you see what methods and attributes an object has?",
    "How do you see what methods and attributes an object has?\n\ndir(obj) lists its attributes and methods. (This is the direct equivalent of PowerShell's Get-Member; it is how you explore an unfamiliar object interactively.)",
  ],
  [
    "anki:f*j+Hsi!dp:0",
    "What does isinstance() do and why prefer it over type() for checks?",
    "What does isinstance() do and why prefer it over type() for checks?\n\nisinstance(obj, int) tests whether an object is that type (and respects inheritance). Prefer it over 'type(obj) == int' because it handles subclasses correctly. (The proper way to ask 'is this a string' before you operate on it.)",
  ],
  [
    "anki:F`&#2haFqd:0",
    "What do hasattr() and getattr() do?",
    "What do hasattr() and getattr() do?\n\nhasattr(obj, 'name') checks if an attribute exists; getattr(obj, 'name', default) fetches it safely with a fallback. (Useful when you are handed objects of varying shape, like parsed API responses.)",
  ],
  [
    "anki:l{+y&Hm=o;:0",
    "How do you get help on a function or object in the interpreter?",
    "How do you get help on a function or object in the interpreter?\n\nhelp(obj) prints its documentation; obj.__doc__ holds the docstring. (The Get-Help equivalent from PowerShell.)",
  ],
  [
    "anki:rRmh1C[fWI:0",
    "What is a docstring?",
    "What is a docstring?\n\nA string literal right under a function/class definition that documents it, accessible via help() or __doc__. (Like comment-based help in PowerShell that feeds Get-Help.)",
  ],
  [
    "anki:elzmywDwLd:0",
    "What are Python's main built-in data types?",
    "What are Python's main built-in data types?\n\nint, float, str, bool, list, tuple, dict, set, and NoneType (None). (PowerShell has close cousins: String, Int, Bool, Array, Hashtable.)",
  ],
  [
    "anki:x+X4;(7fh<:0",
    "What is a list, and how do you create one?",
    "What is a list, and how do you create one?\n\nAn ordered, mutable collection: my_list = [1, 2, 3]. You can change, add, and remove elements. (The Python equivalent of a PowerShell array @(1,2,3), but mutable and richer.)",
  ],
  [
    "anki:d56lk1n}VT:0",
    "What is a tuple, and how does it differ from a list?",
    "What is a tuple, and how does it differ from a list?\n\nAn ordered, immutable collection: my_tuple = (1, 2, 3). Once made, it cannot change. Use tuples for fixed data, lists for data that changes; tuples can also be dict keys, which lists cannot. Caveat: a one-item tuple is (5,); without the comma it is just a number.",
  ],
  [
    "anki:wJEVS.~5`R:0",
    "What is a dictionary, and how do you create one?",
    "What is a dictionary, and how do you create one?\n\nA collection of key-value pairs: my_dict = {'key': 'value'}. Keys are unique and lookups are fast. (This is exactly a PowerShell hashtable @{ Key = 'Value' }.)",
  ],
  [
    "anki:j#WFS;]FVx:0",
    "What is a hash table, and how does a Python dict relate to it?",
    "What is a hash table, and how does a Python dict relate to it?\n\nA hash table stores key-value pairs and uses a hash of the key to find its value in near-constant time. A Python dict is a hash table. (Same underlying idea as a PowerShell hashtable; the name literally comes from this structure.)",
  ],
  [
    "anki:l_PuGM9%e&:0",
    "What is a set, and what is it for?",
    "What is a set, and what is it for?\n\nAn unordered collection of unique elements: my_set = {1, 2, 3}. Great for deduplication and fast membership tests. (PowerShell has no direct built-in; you would fake it with a hashtable's keys.)",
  ],
  [
    "anki:o`mL47?8lC:0",
    "What is the difference between a list and a set?",
    "What is the difference between a list and a set?\n\nA list is ordered and allows duplicates; a set is unordered and holds only unique items, with faster membership testing. (Reach for a set when you are asking 'have I seen this before,' like tracking unique IPs.)",
  ],
  [
    "anki:vbmeYL44gT:0",
    "Is a string mutable in Python?",
    "Is a string mutable in Python?\n\nNo. Strings are immutable; any operation that looks like it changes a string actually returns a new one. (Same as .NET strings, which PowerShell also uses.)",
  ],
  [
    "anki:F&3kS{k>/:0",
    "What is None in Python?",
    "What is None in Python?\n\nNone is Python's null value, meaning 'no value.' It is a single shared object of type NoneType. (The equivalent of $null in PowerShell.)",
  ],
  [
    "anki:cEjD]RiaeV:0",
    "How do you check for None correctly?",
    "How do you check for None correctly?\n\nUse 'is': if x is None. (Prefer 'is' over '==' here, just like PowerShell teaches you to write $null -eq $x to be safe.)",
  ],
  [
    "anki:QjwZ$!eQMT:0",
    "What is the difference between == and is?",
    "What is the difference between == and is?\n\n== compares values (are these equal); 'is' compares identity (are these literally the same object in memory). Use 'is' only for None and singletons. (== is the everyday comparison; 'is' is about object identity.)",
  ],
  [
    "anki:HO=X;&^!X%:0",
    "What values are falsy in Python?",
    "What values are falsy in Python?\n\nFalse, None, 0, 0.0, '' (empty string), [] (empty list), {} (empty dict), and any empty collection. Everything else is truthy. (Handy: 'if my_list:' is true only when the list has items.)",
  ],
  [
    "anki:RjjE2Ak*N!:0",
    "How do you convert a string to an int, and what can go wrong?",
    "How do you convert a string to an int, and what can go wrong?\n\nint('123') converts it; str(123) goes back. int('abc') raises ValueError. (This is casting, like [int]'123' in PowerShell; wrap it in try/except when the input is untrusted.)",
  ],
  [
    "anki:ku~X397#P<:0",
    "What is the difference between mutable and immutable types?",
    "What is the difference between mutable and immutable types?\n\nMutable types (list, dict, set) can be changed in place. Immutable types (int, str, tuple) cannot; operations create new objects. (Knowing which is which prevents a lot of surprise bugs.)",
  ],
  [
    "anki:u.bwz=P@U~:0",
    "What is the difference between a shallow copy and a deep copy?",
    "What is the difference between a shallow copy and a deep copy?\n\nA shallow copy duplicates the outer object but shares the nested objects inside. A deep copy (copy.deepcopy) recursively duplicates everything. (If you have a list of lists and only shallow-copy it, editing an inner list still affects both.)",
  ],
  [
    "anki:y#z{*&yy5R:0",
    "Why can modifying a list inside a function change the caller's list?",
    "Why can modifying a list inside a function change the caller's list?\n\nLists are mutable and passed by reference, so the function edits the same object. Reassigning the name inside the function does not affect the caller. (A common gotcha; if you want to be safe, copy the list first.)",
  ],
  [
    "anki:tmQ:4a2=?W:0",
    "Why is a mutable default argument like def f(x=[]) dangerous?",
    "Why is a mutable default argument like def f(x=[]) dangerous?\n\nThe default list is created once and reused across every call, so it accumulates data between calls. Use x=None and create the list inside the function. (One of Python's most famous traps.)",
  ],
  [
    "anki:bFd,fd*v0F:0",
    "What is the difference between assigning a list and copying it?",
    "What is the difference between assigning a list and copying it?\n\nb = a makes both names point to the SAME list, so editing one edits both. b = a.copy() or b = list(a) makes an independent copy. (Assignment shares the reference; it does not duplicate the data.)",
  ],
  [
    "anki:AIF%K>A>e]:0",
    "How do you write an if/elif/else?",
    "How do you write an if/elif/else?\n\nif cond:\n    ...\nelif other:\n    ...\nelse:\n    ...  Indentation defines the blocks; there are no braces. (PowerShell uses braces; Python uses whitespace instead.)",
  ],
  [
    "anki:B<&Sz_V*E_:0",
    "How do you write a for loop over a list?",
    "How do you write a for loop over a list?\n\nfor item in my_list:\n    print(item). It iterates the items directly. (Like PowerShell's foreach ($item in $list), but the default and only 'for' style.)",
  ],
  [
    "anki:D&O_mp5:0]:0",
    "How do you loop with both index and value?",
    "How do you loop with both index and value?\n\nUse enumerate: for i, value in enumerate(my_list). It yields index-value pairs. (Cleaner than tracking a counter yourself.)",
  ],
  [
    "anki:D[d2_9f^@s:0",
    "What does range() do?",
    "What does range() do?\n\nProduces a sequence of numbers lazily: range(5) is 0..4; range(2,10,2) is 2,4,6,8. (Used to loop a set number of times; it does not build a full list in memory.)",
  ],
  [
    "anki:OC|UB*]?L+:0",
    "How do you exit a loop early, and how do you skip one iteration?",
    "How do you exit a loop early, and how do you skip one iteration?\n\nbreak exits the loop entirely; continue skips to the next iteration. (Same keywords and meaning as PowerShell.)",
  ],
  [
    "anki:Pei3j7[|ZO:0",
    "What is a while loop and when do you use it?",
    "What is a while loop and when do you use it?\n\nRepeats while a condition holds: while cond:. Use it when you do not know the iteration count in advance. (Same concept as PowerShell's while.)",
  ],
  [
    "anki:q#w!Au<AkR:0",
    "What does zip() do?",
    "What does zip() do?\n\nPairs up items from multiple iterables: zip([1,2],['a','b']) yields (1,'a'),(2,'b'). (The go-to when you need to walk two lists together, like usernames and their statuses.)",
  ],
  [
    "anki:M4->hyf*a<:0",
    "What is a list comprehension?",
    "What is a list comprehension?\n\nA compact way to build a list: [x*2 for x in range(5)]. You can filter: [x for x in items if x > 0]. (No PowerShell equivalent syntax; it is one of Python's signature features.)",
  ],
  [
    "anki:P]H}=/B7I[:0",
    "What is a dict comprehension?",
    "What is a dict comprehension?\n\nBuilding a dict compactly: {k: v for k, v in pairs}. (Same idea as a list comprehension but produces key-value pairs.)",
  ],
] as const;
