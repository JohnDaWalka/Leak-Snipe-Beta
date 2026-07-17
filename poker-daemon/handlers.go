// handlers.go – MCP tool implementations for hand‑history management
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "os"
    "strings"

    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/service/s3"
    "github.com/aws/aws-sdk-go-v2/feature/s3/manager"
    "github.com/metoro-io/mcp-golang"
)

// Prefix under which hand‑history objects are stored in the bucket.
const handPrefix = "hand-histories/"

// listHandHistories lists all object keys under the hand‑histories prefix.
func listHandHistories() (*mcp_golang.ToolResponse, error) {
    client := initR2()
    bucket := os.Getenv("R2_BUCKET")
    if bucket == "" {
        return nil, fmt.Errorf("R2_BUCKET env var not set")
    }
    out, err := client.ListObjectsV2(context.TODO(), &s3.ListObjectsV2Input{
        Bucket: &bucket,
        Prefix: aws.String(handPrefix),
        MaxKeys: aws.Int32(1000),
    })
    if err != nil {
        return nil, err
    }
    keys := make([]string, 0, len(out.Contents))
    for _, obj := range out.Contents {
        if obj.Key != nil {
            keys = append(keys, strings.TrimPrefix(*obj.Key, handPrefix))
        }
    }
    payload, err := json.Marshal(keys)
    if err != nil {
        return nil, err
    }
    return mcp_golang.NewToolResponse(mcp_golang.NewTextContent(string(payload))), nil
}

// getHandHistoryArgs defines the input for the getHandHistory tool.
type getHandHistoryArgs struct {
    // Name of the hand file (without the prefix), e.g., "hand-123.json"
    File string `json:"file" jsonschema:"required,description=Hand file name"`
}

// getHandHistory fetches a specific hand JSON from R2.
func getHandHistory(args getHandHistoryArgs) (*mcp_golang.ToolResponse, error) {
    client := initR2()
    bucket := os.Getenv("R2_BUCKET")
    if bucket == "" {
        return nil, fmt.Errorf("R2_BUCKET env var not set")
    }
    key := handPrefix + args.File
    downloader := manager.NewDownloader(client)
    buf := manager.NewWriteAtBuffer([]byte{})
    _, err := downloader.Download(context.TODO(), buf, &s3.GetObjectInput{Bucket: &bucket, Key: &key})
    if err != nil {
        return nil, err
    }
    return mcp_golang.NewToolResponse(mcp_golang.NewTextContent(string(buf.Bytes()))), nil
}

// searchHandHistoriesArgs defines the input for the search tool.
type searchHandHistoriesArgs struct {
    Query string `json:"query" jsonschema:"required,description=Case‑insensitive substring to search for"`
}

// searchHandHistories searches hand files for the given query and returns matching filenames.
func searchHandHistories(args searchHandHistoriesArgs) (*mcp_golang.ToolResponse, error) {
    client := initR2()
    bucket := os.Getenv("R2_BUCKET")
    if bucket == "" {
        return nil, fmt.Errorf("R2_BUCKET env var not set")
    }
    // List objects under the prefix (pagination omitted for brevity – assume <1000 objects)
    out, err := client.ListObjectsV2(context.TODO(), &s3.ListObjectsV2Input{
        Bucket: &bucket,
        Prefix: aws.String(handPrefix),
        MaxKeys: aws.Int32(1000),
    })
    if err != nil {
        return nil, err
    }
    lowerQ := strings.ToLower(args.Query)
    matches := []string{}
    for _, obj := range out.Contents {
        if obj.Key == nil {
            continue
        }
        // Download object content
        downloader := manager.NewDownloader(client)
        buf := manager.NewWriteAtBuffer([]byte{})
        _, err := downloader.Download(context.TODO(), buf, &s3.GetObjectInput{Bucket: &bucket, Key: obj.Key})
        if err != nil {
            log.Printf("failed to download %s: %v", *obj.Key, err)
            continue
        }
        content := string(buf.Bytes())
        if strings.Contains(strings.ToLower(content), lowerQ) {
            matches = append(matches, strings.TrimPrefix(*obj.Key, handPrefix))
        }
    }
    payload, err := json.Marshal(matches)
    if err != nil {
        return nil, err
    }
    return mcp_golang.NewToolResponse(mcp_golang.NewTextContent(string(payload))), nil
}
