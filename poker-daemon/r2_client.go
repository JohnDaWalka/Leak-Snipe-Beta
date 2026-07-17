// r2_client.go – minimal R2 helper
package main

import (
    "context"
    "fmt"
    "log"
    "os"
    "strings"
    "time"

    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/credentials"
    "github.com/aws/aws-sdk-go-v2/feature/s3/manager"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

// initR2 creates an S3 client configured for Cloudflare R2.
func initR2() *s3.Client {
    // Expect env vars: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET
    accessKey := os.Getenv("R2_ACCESS_KEY_ID")
    secretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
    accountID := os.Getenv("R2_ACCOUNT_ID")
    if accessKey == "" || secretKey == "" || accountID == "" {
        log.Fatalf("R2 credentials (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID) must be set")
    }

    endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)
    resolver := aws.EndpointResolverFunc(func(service, region string) (aws.Endpoint, error) {
        if service == s3.ServiceID {
            return aws.Endpoint{URL: endpoint, SigningRegion: "us-east-1"}, nil
        }
        return aws.Endpoint{}, &aws.EndpointNotFoundError{}
    })

    cfg, err := config.LoadDefaultConfig(context.TODO(),
        config.WithRegion("us-east-1"),
        config.WithEndpointResolver(resolver),
        config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
    )
    if err != nil {
        log.Fatalf("unable to load R2 SDK config: %v", err)
    }
    return s3.NewFromConfig(cfg)
}

// uploadHand uploads a JSON hand to R2 bucket.
func uploadHand(client *s3.Client, bucket, key, jsonData string) error {
    uploader := manager.NewUploader(client)
    _, err := uploader.Upload(context.TODO(), &s3.PutObjectInput{Bucket: aws.String(bucket), Key: aws.String(key), Body: strings.NewReader(jsonData)})
    return err
}

// listHands lists objects in the bucket (max 100).
func listHands(client *s3.Client, bucket string) ([]string, error) {
    out, err := client.ListObjectsV2(context.TODO(), &s3.ListObjectsV2Input{Bucket: aws.String(bucket), MaxKeys: aws.Int32(100)})
    if err != nil {
        return nil, err
    }
    keys := make([]string, len(out.Contents))
    for i, o := range out.Contents {
        keys[i] = *o.Key
    }
    return keys, nil
}

// exampleR2Usage demonstrates a simple upload and list.
func exampleR2Usage() {
    client := initR2()
    bucket := os.Getenv("R2_BUCKET")
    if bucket == "" {
        log.Fatalf("R2_BUCKET env var required")
    }
    // Upload a test hand
    data := `{"cards":"AhKd"}`
    err := uploadHand(client, bucket, fmt.Sprintf("hand-%d.json", time.Now().Unix()), data)
    if err != nil {
        log.Printf("upload error: %v", err)
    } else {
        log.Println("hand uploaded to R2")
    }
    // List current objects
    keys, err := listHands(client, bucket)
    if err != nil {
        log.Printf("list error: %v", err)
    } else {
        log.Printf("R2 objects: %v", keys)
    }
}

// logToR2 uploads request and response payloads as a single JSON object to R2.
func logToR2(reqBody, respBody []byte) {
    client := initR2()
    bucket := os.Getenv("R2_BUCKET")
    if bucket == "" {
        log.Printf("R2_BUCKET env var not set, skipping log upload")
        return
    }
    // Build a simple log JSON object
    logJSON := fmt.Sprintf(`{"request":%s,"response":%s}`, string(reqBody), string(respBody))
    // Use a timestamped key for uniqueness
    key := fmt.Sprintf("log-%d.json", time.Now().UnixNano())
    if err := uploadHand(client, bucket, key, logJSON); err != nil {
        log.Printf("failed to upload log to R2: %v", err)
    } else {
        log.Printf("uploaded request/response log to R2: %s", key)
    }
}

