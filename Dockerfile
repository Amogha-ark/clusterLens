FROM node:22-alpine AS ui
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-alpine AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY backend/ ./backend/
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /clusterlens ./backend/cmd/clusterlens

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=backend /clusterlens /app/clusterlens
COPY --from=ui /src/frontend/dist /app/ui
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/app/clusterlens"]
CMD ["--kubeconfig=", "--listen=0.0.0.0:8080", "--static=/app/ui"]
