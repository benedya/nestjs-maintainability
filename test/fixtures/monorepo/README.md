Nx-style layout: two applications with their own `NestFactory.create` entrypoint,
sharing one library through a `paths` alias. Exercises per-entrypoint scoping
(each app scored separately, plus the union) and tsconfig path resolution.
