.PHONY: install start web smoke pages serve-pages test test-mutation typecheck lint format build build-public check clean distclean

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
	BAKED_CREDS="$$(bun -e 'import { packCreds } from "./packages/core/src/creds.ts"; \
		process.stdout.write(packCreds(process.env.BAKED_API_ID, process.env.BAKED_API_HASH))')" \
		bun build apps/cli/src/index.ts --compile --env='BAKED_*' --outfile dist/tg-client

# Static, server-less build for GitHub Pages (or any file host). Relative asset paths
# (--public-path=./) so it also works from a project-page subpath like /telegram-grep/.
#
# By default nothing is baked in and the page asks for an api_id/api_hash at first launch.
# Set BAKED_API_ID/BAKED_API_HASH to ship a fallback pair (the form stays available as an
# override). A pair in a browser bundle is PUBLIC — DevTools reads it in seconds — so
# register an app id for the site, never the one you use yourself, and rotate it if it
# gets flagged.
pages:
	@if [ -n "$$BAKED_API_ID" ] && [ -n "$$BAKED_API_HASH" ]; then \
		BAKED_CREDS="$$(bun -e 'import { packCreds } from "./packages/core/src/creds.ts"; \
			process.stdout.write(packCreds(process.env.BAKED_API_ID, process.env.BAKED_API_HASH))')" \
			bun run build:pages; \
	else \
		bun run build:pages; \
	fi

# Serve the built bundle from a subpath, the way Pages does — the check that no asset
# request escapes the prefix.
serve-pages: pages
	bun apps/web/smoke/serve-pages.ts

check: typecheck lint test

clean:
	rm -rf dist out coverage reports .stryker-tmp
	rm -f *.bun-build .*.bun-build *.tsbuildinfo *.lcov

distclean: clean
	rm -rf node_modules
