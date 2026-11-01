.PHONY: ui build run dev test helm-check
ui:
	cd frontend && npm ci --no-audit --no-fund && npm run build
build: ui
	mkdir -p artifacts
	go build -trimpath -o artifacts/clusterlens ./backend/cmd/clusterlens
run:
	./artifacts/clusterlens
dev:
	go run ./backend/cmd/clusterlens
test:
	go test -race ./backend/...
	cd frontend && npm test
	python3 -m unittest discover -s tests -v
helm-check:
	helm lint deploy/helm/clusterlens
	helm template clusterlens deploy/helm/clusterlens --namespace observability-lab > /dev/null
