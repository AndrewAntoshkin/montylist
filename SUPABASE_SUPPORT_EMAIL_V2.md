# Email to Supabase Support (Updated after diagnostics)

**Subject:** `Large file uploads (>100MB) fail with 502 "Network connection lost" - project goykmdyodqhptkzfgumq`

---

Hello Supabase Support Team,

We are experiencing intermittent 502 errors when uploading **large video files (>100 MB)** to Storage in project `goykmdyodqhptkzfgumq`.

## Project Details

- **Project ref:** `goykmdyodqhptkzfgumq`
- **Plan:** Pro Plan
- **Bucket:** `videos` (Public)
- **Usage:** ~5.47 GB Storage, ~21.6 GB Egress (well below limits)

## Problem Description

### Browser Uploads (Large Files)

When uploading large video files (100-150 MB) from browser using signed upload URLs:

```javascript
// Get signed URL - works fine
const { uploadUrl } = await fetch('/api/create-upload-url', {
  body: JSON.stringify({ filename, fileType, fileSize })
});

// Direct XHR upload - fails with 502
xhr.open('PUT', uploadUrl);
xhr.setRequestHeader('Content-Type', file.type);
xhr.send(file); // file is 140 MB MP4

// Error:
Origin http://localhost:3000 is not allowed by Access-Control-Allow-Origin. 
Status code: 502
```

### Server-Side Uploads (Video Chunks)

When uploading video chunks (100-200 MB each) from Node.js:

```typescript
const stream = fs.createReadStream(chunkFile.localPath); // ~150 MB chunk
const { error } = await supabase.storage
  .from('videos')
  .upload(chunkStoragePath, stream, {
    contentType: 'video/mp4',
    duplex: 'half',
  });

// Error after 5 retry attempts:
StorageApiError: "gateway error: Error: Network connection lost."
status: 502
```

## Diagnostics We Performed

### ✅ Small files work perfectly:

We tested with official CLI and Node.js SDK:

```bash
# CLI test (1 KB file)
$ supabase storage cp ./tiny-test.txt ss:///videos/test/tiny-test.txt
✅ SUCCESS - file uploaded

# SDK test (100 bytes buffer)
await supabase.storage.upload(path, Buffer.from('test'), {...})
✅ SUCCESS

# SDK test (1 MB buffer)
await supabase.storage.upload(path, Buffer.alloc(1024*1024), {...})
✅ SUCCESS

# Signed URL test (small file)
const { signedUrl } = await createSignedUploadUrl(...)
fetch(signedUrl, { method: 'PUT', body: 'test' })
✅ SUCCESS
```

### ❌ Large files (>100 MB) fail with 502:

- Browser XHR upload of 140 MB MP4: 502
- Server stream upload of 150 MB chunk: 502
- **Pattern:** Files >100 MB consistently fail with "gateway error: Network connection lost"

## Technical Details

- **SDK:** `@supabase/supabase-js` v2.81.1
- **Runtime:** Node.js 20, Next.js 16.0.3  
- **Upload method:** 
  - Browser: XHR with signed URLs from `createSignedUploadUrl()`
  - Server: SDK `storage.upload()` with Node.js streams (`duplex: 'half'`)
- **File types:** MP4 video files
- **Retry logic:** Up to 5 attempts with exponential backoff (2s → 32s)

## Questions

1. **Is there a file size limit** for single upload requests?
   - We see 502 for files >100 MB
   - Small files (<1 MB) work perfectly

2. **Should we use resumable/chunked upload** for large files?
   - Is there a recommended approach for files >100 MB?
   - Should we split uploads into smaller parts?

3. **Are there rate limits or bandwidth limits** that could cause 502?
   - Maximum concurrent uploads?
   - Maximum bandwidth per second?

4. **Is this a known issue** with large file uploads to Storage?

## Impact

This blocks our video processing workflow. Users upload videos 100-500 MB, which need to be:
1. Uploaded to Storage (fails intermittently)
2. Split into chunks and re-uploaded (fails with 502)

## What We Need

1. Recommended approach for uploading files >100 MB
2. Any configuration changes needed in our bucket/project
3. Clarification on file size limits and best practices

We've prepared detailed logs and can provide request IDs if needed.

Thank you for your help!

Best regards,
Andrew



