// CC BY 4.0; source, attribution and conversion details in ../README.md.
export default [
  [
    "anki:hUptwOlIUJ:0",
    "What is the Global Interpreter Lock (GIL)?",
    "What is the Global Interpreter Lock (GIL)?\n\nA lock in CPython that lets only one thread run Python bytecode at a time, which limits CPU-bound threading. (For CPU-heavy work use multiprocessing; for I/O-bound work threads are fine. Python 3.13 and later offer an optional free-threaded build without the GIL, but the default build keeps it.)",
  ],
  [
    "anki:c_QLkgC3w3:0",
    "What is the difference between multithreading and multiprocessing in Python?",
    "What is the difference between multithreading and multiprocessing in Python?\n\nThreads share memory but are limited by the GIL, so they suit I/O-bound work (waiting on network/disk). Multiprocessing uses separate processes with their own memory, suiting CPU-bound work. (Pick based on whether you are waiting or computing.)",
  ],
  [
    "anki:H#2qO/rGJ^:0",
    "What is a virtual environment and why use one?",
    "What is a virtual environment and why use one?\n\nAn isolated Python environment (python -m venv) with its own packages, so projects do not clash over dependency versions. (Standard practice; keeps each project's libraries separate.)",
  ],
  [
    "anki:jbp~($r.._:0",
    "What is pip and requirements.txt?",
    "What is pip and requirements.txt?\n\npip installs packages from PyPI (pip install requests). requirements.txt pins the project's dependencies so others can reproduce the environment. (The Install-Module / package management equivalent.)",
  ],
  [
    "anki:JYoPaAJnwR:0",
    "What are type hints, and do they change runtime behavior?",
    "What are type hints, and do they change runtime behavior?\n\nAnnotations like def f(x: int) -> str: that document expected types. They do not enforce anything at runtime; tools like mypy check them. (Signals maintainable, modern Python; increasingly expected in professional code.)",
  ],
  [
    "anki:N&w.9v[e2^:0",
    'filename = "report_2024.csv". What does filename[-3:] return?',
    'filename = "report_2024.csv". What does filename[-3:] return?\n\n"csv", the last 3 characters.',
  ],
  [
    "anki:BmNNMq|F[K:0",
    'filename = "report_2024.csv". What does filename[:-4] return?',
    'filename = "report_2024.csv". What does filename[:-4] return?\n\n"report_2024", everything except the last 4 characters, which drops ".csv".',
  ],
] as const;
