# samples/

Put example survey point files (`P,N,E,Z,D` text) here. Everything in this folder except this README is gitignored,
because real survey jobs carry client information.

Some tests (`parse`, `dxf`, `boundary`, `dxfview`, `linework.reference`, `rules`) check the generator against one real job:
`samples/job-a.txt` and its finished drawing `reference/job-a.dxf`. Without those two files the suites are skipped.
