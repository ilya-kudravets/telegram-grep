.PHONY: install start web smoke test test-mutation typecheck lint format build build-public check clean distclean

install:
	bun install

start:
	bun start

web:
	bun run web

# browser smoke page: the IndexedDB store and core-in-a-browser, which `bun test`
# cannot reach. Serve it, then drive it with a browser (or the Playwright MCP).
smoke:
	bun apps/web/smoke/serve.ts

test:
	bun test

test-mutation:
	bun run test:mutation

typecheck:
	bun run typecheck

lint:
	bun run lint

format:
	bun run format

build:
	bun run build

# Binary for public distribution: bakes a fallback app id in, so a user without
# .env can run it. A runtime API_ID/API_HASH (or --api-id/--api-hash) still wins, so
# the baked pair can be rotated without breaking installs. --env takes the BAKED_
# prefix only — nothing else from this shell reaches the binary. The pair is packed
# (XOR+base64) so bots grepping released artifacts for an api_hash find nothing; it is
# still extractable with a debugger, so register an app id for the release rather than
# reusing your own.
build-public:
	@[ -n "$$BAKED_API_ID" ] && [ -n "$$BAKED_API_HASH" ] || \
		{ echo "set BAKED_API_ID and BAKED_API_HASH (my.telegram.org)"; exit 1; }
	BAKED_CREDS="$$(bun -e 'import { packCreds } from "./packages/bun/src/env.ts"; \
		process.stdout.write(packCreds(process.env.BAKED_API_ID, process.env.BAKED_API_HASH))')" \
		bun build apps/cli/src/index.ts --compile --env='BAKED_*' --outfile dist/tg-client

check: typecheck lint test

clean:
	rm -rf dist out coverage reports .stryker-tmp
	rm -f *.bun-build .*.bun-build *.tsbuildinfo *.lcov

distclean: clean
	rm -rf node_modules
