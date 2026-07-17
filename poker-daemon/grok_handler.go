package main

import (
    "bytes"
    "io"
    "log"
    "net/http"
    "os"
    "fmt"
)

// grokHandler forwards chat requests to the Grok API and returns the response.
// It expects a JSON body compatible with the Grok chat completion endpoint.
func grokHandler(w http.ResponseWriter, r *http.Request) {
    // Read incoming request body
    reqBody, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "failed to read request body", http.StatusBadRequest)
        return
    }
    // Determine endpoint
    // Prefer a custom MCP endpoint if set, otherwise fall back to GROK_ENDPOINT env var, then default URL
    endpoint := os.Getenv("GROK_MCP_ENDPOINT")
    if endpoint == "" {
        endpoint = os.Getenv("GROK_ENDPOINT")
    }
    if endpoint == "" {
        endpoint = "https://api.x.ai/v1/chat/completions"
    }
    // Build forward request
    forwardReq, err := http.NewRequest("POST", endpoint, bytes.NewReader(reqBody))
    if err != nil {
        http.Error(w, "failed to create forward request", http.StatusInternalServerError)
        return
    }
    forwardReq.Header.Set("Content-Type", "application/json")
    apiKey := os.Getenv("GROK_API_KEY")
    if apiKey != "" {
        forwardReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
    }
    // Execute request
    client := &http.Client{Timeout: 30 * 1e9}
    resp, err := client.Do(forwardReq)
    if err != nil {
        http.Error(w, "failed to contact Grok API", http.StatusBadGateway)
        return
    }
    defer resp.Body.Close()
    // Copy response headers
    for k, vals := range resp.Header {
        for _, v := range vals {
            w.Header().Add(k, v)
        }
    }
    w.WriteHeader(resp.StatusCode)
    // Stream response body to caller
    if _, err := io.Copy(w, resp.Body); err != nil {
        log.Printf("error copying Grok response: %v", err)
    }
}
