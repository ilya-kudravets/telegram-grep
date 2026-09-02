.PHONY: install start web test test-mutation typecheck lint format build check clean distclean

install:
	bun install

start:
	bun start

web:
	bun run web

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

check: typecheck lint test

clean:
	rm -rf dist out coverage reports .stryker-tmp
	rm -f *.bun-build .*.bun-build *.tsbuildinfo *.lcov

distclean: clean
	rm -rf node_modules
