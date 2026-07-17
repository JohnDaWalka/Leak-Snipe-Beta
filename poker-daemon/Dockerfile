# Stage 1: Build the Go application
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Install git for dependency resolution if needed
RUN apk add --no-cache git

# Copy dependency files
COPY go.mod go.sum ./
RUN go mod download

# Copy source files
COPY . .

# Build the binary statically
RUN CGO_ENABLED=0 GOOS=linux go build -o poker-daemon .

# Stage 2: Final minimal image
FROM alpine:latest

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/poker-daemon .

# Expose port 8080
EXPOSE 8080

CMD ["./poker-daemon"]
