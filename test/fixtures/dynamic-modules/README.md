`forRoot`, `forRootAsync`, `register`, a spread of a local const array, and a
string-token provider. Everything statically resolvable must resolve to the
right module; everything that is not must land in `report.warnings` rather than
disappearing.
