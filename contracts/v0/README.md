# CityScope Contract v0.1

This directory is the frozen hackathon integration contract. `proposals/` keeps the review history; runtime code and fixtures must use this directory as the single source of truth.

Commands:

- `npm run contracts:generate`
- `npm run contracts:validate`
- `npm run demo:fixture`
- `npm run fixtures:validate`

`actorKind=agent` means a behavioral role may propose actions. `actorKind=service` means a deterministic calculator or world service and must never be presented as an opinionated Agent.
