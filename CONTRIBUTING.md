# Contributing to Ostrich

Thanks for your interest! Bug reports, ideas and pull requests are all
welcome.

## Reporting bugs and suggesting features

Open an [issue](https://github.com/Skerpsh/Ostrich_Messenger/issues/new/choose)
and pick a template. For security problems, follow [SECURITY.md](SECURITY.md)
instead.

## Setting up

See [Local development](README.md#local-development) in the README: you need
Node.js 22, PostgreSQL and, for the CLI, Go.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Keep the change focused: one feature or fix per pull request.
3. Match the style of the code around it. Comments explain *why*, in plain
   English.
4. Run the checks for every part you touched:

   ```bash
   (cd backend && npm run typecheck && npm test)
   (cd frontend && npm run typecheck && npm run lint && npm test)
   (cd cli && gofmt -l . && go vet ./... && go test ./...)
   ```

5. Open a pull request describing what changed and why. CI runs the same
   checks.

## Things to keep in mind

- **Encryption** is implemented twice: in TypeScript
  (`frontend/src/lib/crypto.ts`) and in Go (`cli/crypto.go`). A change to one
  needs the same change in the other, and both must pass
  `testdata/crypto-vectors.json`.
- **Clients stay in step.** A feature in the app usually belongs in the CLI
  too, and the other way round.
- **Database changes** go into a new numbered file in `backend/migrations/`.
  Never edit a migration that has already been applied.
- **The server must not learn more.** Anything that sends new plaintext or
  metadata to the server needs a good reason in the pull request.

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
