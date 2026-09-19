Three `@Global()` modules that nothing declares an import of. Because Nest makes
globals visible everywhere, none of the dependencies on them is a boundary
violation - but they still count fully towards coupling, and their Ca is the
point of the fixture.
