package main

import (
    "bytes"
    "io"
    "net/http"
    "os"
)

// claudeProxyHandler forwards requests to Anthropic Claude API, returns the response,
// and logs both request and response payloads to Cloudflare R2.
func claudeProxyHandler(w http.ResponseWriter, r *http.Request) {
    // Read incoming request body
    reqBody, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "failed to read request body", http.StatusBadRequest)
        return
    }
    // Build request to Claude API
    forwardReq, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(reqBody))
    if err != nil {
        http.Error(w, "failed to create forward request", http.StatusInternalServerError)
        return
    }
    forwardReq.Header.Set("Content-Type", "application/json")
    forwardReq.Header.Set("anthropic-version", "2023-06-01")
    forwardReq.Header.Set("x-api-key", os.Getenv("CLAUDE_API_KEY"))

    // Execute request
    client := &http.Client{Timeout: 30 * 1e9}
    resp, err := client.Do(forwardReq)
    if err != nil {
        http.Error(w, "failed to contact Claude API", http.StatusBadGateway)
        return
    }
    defer resp.Body.Close()

    // Read response body
    respBody, err := io.ReadAll(resp.Body)
    if err != nil {
        http.Error(w, "failed to read Claude response", http.StatusInternalServerError)
        return
    }

    // Return Claude response to the original caller
    for k, vals := range resp.Header {
        for _, v := range vals {
            w.Header().Add(k, v)
        }
    }
    w.WriteHeader(resp.StatusCode)
    _, _ = w.Write(respBody)

    // Log request and response to R2 (fire‑and‑forget)
    go logToR2(reqBody, respBody)
}
