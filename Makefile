.PHONY: install start web mobile mobile-ios mobile-android mobile-prebuild mobile-typecheck \
        test test-mutation typecheck lint format build check clean mobile-clean distclean

install:
	bun install

start:
	bun start

web:
	bun run web

# Expo dev server (Metro) for apps/mobile
mobile:
	bun run mobile

# build + launch on a simulator/device (native build via Xcode / Gradle)
mobile-ios:
	cd apps/mobile && bun run ios

mobile-android:
	cd apps/mobile && bun run android

# regenerate the native ios/ + android/ projects (run after native dep changes)
mobile-prebuild:
	cd apps/mobile && bunx expo prebuild --clean

# apps/mobile is excluded from the root tsc (own RN toolchain) — check it on its own
mobile-typecheck:
	cd apps/mobile && bunx tsc --noEmit

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

check: typecheck lint test mobile-typecheck

clean:
	rm -rf dist out coverage reports .stryker-tmp
	rm -f *.bun-build .*.bun-build *.tsbuildinfo *.lcov

# generated native dirs + stale RN build caches (regenerate with `make mobile-prebuild`)
mobile-clean:
	rm -rf apps/mobile/ios apps/mobile/android apps/mobile/.expo
	find apps/mobile/node_modules -type d -name .DerivedData -prune -exec rm -rf {} +

distclean: clean mobile-clean
	rm -rf node_modules
