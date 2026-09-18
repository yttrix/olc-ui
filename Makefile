VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: build web test cross run clean

build: web
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o build/olc-ui ./cmd/olc-ui

web:
	cd web && npm ci --no-audit --no-fund && npm run build

test:
	go vet ./internal/... ./cmd/...
	go test -short ./internal/... ./core/...

cross: web
	for arch in amd64 arm64; do \
		CGO_ENABLED=0 GOOS=linux GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" -o build/olc-ui-linux-$$arch ./cmd/olc-ui; \
	done

# Local panel on http://127.0.0.1:18080/p/ with data in ./build/data.
run: build
	./build/olc-ui panel -data build/data -listen 127.0.0.1:18080 -tls off -base /p/

clean:
	rm -rf build
