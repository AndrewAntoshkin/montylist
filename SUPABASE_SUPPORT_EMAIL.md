# Email to Supabase Support

**Subject:** `Storage API returns 500/502 errors - project goykmdyodqhptkzfgumq cannot access Storage even via CLI`

---

Hello Supabase Support Team,

We are experiencing critical issues with Storage API access in our project `goykmdyodqhptkzfgumq`. The Storage API is returning 500/502 errors for both browser uploads and server-side uploads, and **even the official Supabase CLI cannot connect to Storage**.

## Project Details

- **Project ref:** `goykmdyodqhptkzfgumq`
- **Plan:** Pro Plan
- **Bucket:** `videos` (Public bucket)
- **Current usage:**
  - Storage Size: ~5.47 GB
  - Egress: ~21.6 GB
  - Well below Pro plan limits

## Problem Description

### 1. Browser Upload Failures (XHR → Supabase Storage)

When uploading files directly from the browser using signed upload URLs:

```javascript
// Step 1: Get signed URL (works fine)
POST /api/create-upload-url → 200 OK

// Step 2: Direct upload to Storage (fails with 502)
xhr.open('PUT', uploadUrl);
xhr.send(file);

// Error in browser console:
Origin http://localhost:3000 is not allowed by Access-Control-Allow-Origin. 
Status code: 502

XMLHttpRequest cannot load 
https://goykmdyodqhptkzfgumq.supabase.co/storage/v1/object/upload/sign/videos/...
```

**Important:** 
- Same code successfully uploads OTHER files (same format, size, origin, bucket)
- CORS settings unchanged
- Error is specifically 502 (gateway error), not 4xx
- Bucket `videos` is public, policies unchanged

### 2. Server-Side Upload Failures (Node.js SDK)

When uploading video chunks from our Next.js API (Node.js 20):

```typescript
const stream = fs.createReadStream(chunkFile.localPath);
const { error } = await supabase.storage
  .from('videos')
  .upload(chunkStoragePath, stream, {
    contentType: 'video/mp4',
    upsert: false,
    duplex: 'half',
  });
```

**Error (all 5 retry attempts fail):**
```
Error [StorageApiError]: "gateway error: Error: Network connection lost."
__isStorageError: true
status: 502
statusCode: '502'
```

### 3. **CRITICAL: Official Supabase CLI Also Fails**

We tested with official Supabase CLI to isolate the issue:

```bash
$ supabase login
✅ You are now logged in. Happy coding!

$ supabase link --project-ref goykmdyodqhptkzfgumq
✅ Finished supabase link.

$ supabase storage ls ss:///videos --experimental
❌ Initialising login role...
❌ Authorization failed for the access token and project ref pair: error code: 500

$ supabase storage cp ./test.txt ss:///videos/test/test.txt --experimental
❌ Initialising login role...
(hangs indefinitely)
```

**This proves the issue is on Supabase's side**, not in our application code.

## Timeline

- **November 18, 2025:** Everything worked perfectly
- **November 19-20, 2025:** Started experiencing intermittent 502 errors
- **November 20, 2025 (today):** Storage API completely inaccessible, even via CLI

## What We've Checked

1. ✅ **Usage/Quotas:** Well below Pro plan limits
2. ✅ **Bucket settings:** Public bucket, policies unchanged
3. ✅ **Code comparison:** Compared with working version from Nov 18 - no significant changes to Storage logic
4. ✅ **Network:** Other APIs work fine (Auth, Database)
5. ✅ **CLI test:** Official Supabase CLI also fails (rules out our code)

## Recent Changes (on our side)

- We increased usage of chunked video processing (more Storage uploads)
- Temporarily added CORS headers to `next.config.ts` for testing (already removed)
- Added retry logic and streaming for uploads (improvements, not breaking changes)

**However:** Even after reverting ALL changes, the problem persists. And CLI failures prove this is server-side.

## Questions for Supabase

1. **Are there known issues with Storage API in our project/region?**
2. **Why does CLI return "Authorization failed: error code 500"?**
3. **Are there any hidden rate limits or quotas we might have hit?**
   - Max file size per upload?
   - Max concurrent uploads?
   - API requests per minute?
4. **Can we migrate the project to a different region if this is region-specific?**

## Technical Details

- **SDK:** `@supabase/supabase-js` version 2.81.1
- **Runtime:** Node.js 20, Next.js 16.0.3
- **Supabase CLI:** version 2.58.5
- **Upload method:** 
  - Browser: XHR with signed URLs from `createSignedUploadUrl()`
  - Server: SDK `storage.upload()` with Node.js streams

## Impact

This is blocking our production application. Users cannot upload videos, and even previously uploaded videos cannot be processed (chunks cannot be uploaded).

## What We Need

1. Investigation into Storage API issues for project `goykmdyodqhptkzfgumq`
2. Root cause analysis of 500/502 errors
3. Recommended solution or workaround
4. Timeline for resolution

We can provide additional logs, screenshots, request IDs, or any other debugging information you need.

Thank you for your help!

Best regards,
Andrew

---

**Attachment:** Screenshots of:
- Browser console showing 502 errors
- Server logs showing StorageApiError
- CLI output showing authorization failures



