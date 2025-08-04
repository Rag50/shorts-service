# YouTube Shorts & Instagram Reels Downloader API

A powerful Node.js API service for downloading YouTube Shorts and Instagram Reels with automatic upscaling capabilities.

## Features

- 🎬 **YouTube Shorts Download**: Download YouTube short videos with automatic quality detection
- 📸 **Instagram Reels Support**: Download Instagram Reels and Posts
- 🔍 **Content Information Extraction**: Get metadata before downloading
- ⬆️ **Automatic Upscaling**: Upscale videos to 1080p using FFmpeg with high-quality filters
- 🧹 **Auto Cleanup**: Automatic file cleanup after 1 hour
- 📦 **Batch Processing**: Process multiple Instagram URLs at once
- 🔄 **Multiple Fallbacks**: Multiple extraction methods for reliability

## 🔧 Installation & Setup

### Prerequisites
- Node.js (v14+)
- Python 3.7+
- FFmpeg

### Local Development Setup
```bash
# Clone the repository
git clone <repository-url>
cd shorts-download

# Install Node.js dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt

# Start the server
npm start
```

### Cloud Deployment (GCP/AWS/Azure)

When deploying to cloud platforms, Instagram may block requests from datacenter IPs. Here are solutions:

#### Option 1: Environment Variables
```bash
# Set environment variables for cloud detection
export NODE_ENV=production
export GOOGLE_CLOUD_PROJECT=your-project-id  # For GCP
export AWS_REGION=us-east-1                  # For AWS

# Optional: Configure proxy for Instagram downloads
export INSTAGRAM_PROXY_URL=http://username:password@proxy-server:port
```

#### Option 2: Use Residential Proxy Services
For production Instagram downloads, consider using:
- **ProxyMesh**: Residential proxies
- **Bright Data**: High-quality proxy network
- **Smartproxy**: Residential proxy pool
- **Storm Proxies**: Dedicated Instagram proxies

Example proxy configuration:
```bash
export INSTAGRAM_PROXY_URL=http://user:pass@residential-proxy.example.com:8080
```

#### Option 3: VPN Solutions
- Use a VPN service that provides residential IP addresses
- Configure your cloud instance to route traffic through the VPN

### Docker Deployment
```dockerfile
FROM node:16-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

# Install Python and dependencies
RUN apk add --no-cache python3 py3-pip ffmpeg
COPY requirements.txt ./
RUN pip3 install -r requirements.txt

COPY . .
EXPOSE 3000

# Set environment for cloud deployment
ENV NODE_ENV=production

CMD ["npm", "start"]
```

The server will start on port 3000 by default (or the port specified in the `PORT` environment variable).

## API Endpoints

### Health Check

#### `GET /api/health`

Check if the API is running and get available endpoints.

**Response:**
```json
{
  "status": "OK",
  "message": "YouTube Shorts & Instagram Reels Downloader API is running",
  "endpoints": {
    "youtube": "/api/download-shorts",
    "instagram": {
      "info": "/api/instagram/info",
      "download": "/api/instagram/download",
      "downloadReels": "/api/download-reels",
      "batch": "/api/instagram/batch"
    },
    "download": "/api/download-file/:filename"
  },
  "timestamp": "2025-08-03T10:30:45.123Z"
}
```

---

### YouTube Shorts

#### `POST /api/download-shorts`

Download a YouTube Shorts video with automatic upscaling to 1080p if needed.

**Request Body:**
```json
{
  "url": "https://youtube.com/shorts/VIDEO_ID"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Video downloaded and upscaled to 1080p (upscaled) (from 720p)",
  "title": "Amazing Short Video",
  "filename": "a1b2c3d4e5f6.mp4",
  "downloadUrl": "/api/download-file/a1b2c3d4e5f6.mp4",
  "duration": 45,
  "quality": "1080p (upscaled)",
  "originalQuality": "720p",
  "upscaled": true
}
```

**Error Responses:**
- `400`: Invalid or missing URL
- `408`: Download timeout (after 5 minutes)
- `500`: Processing failed

**Features:**
- Automatic quality detection
- Upscaling to 1080p using high-quality FFmpeg filters
- Duration validation (rejects videos longer than 3 minutes)
- Original file cleanup after successful upscaling

---

### Instagram Content

#### `POST /api/instagram/info`

Extract metadata from Instagram Reels/Posts without downloading.

**Request Body:**
```json
{
  "url": "https://www.instagram.com/reel/SHORTCODE/"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "shortcode": "SHORTCODE",
    "isVideo": true,
    "videoUrl": "https://...",
    "thumbnailUrl": "https://...",
    "caption": "Check out this amazing content!",
    "username": "username",
    "likesCount": 1250,
    "commentsCount": 45,
    "viewsCount": 5600,
    "duration": 30
  }
}
```

**Error Responses:**
```json
{
  "success": false,
  "error": "Private content",
  "message": "This Instagram content is private and cannot be accessed"
}
```

#### `POST /api/instagram/download`

Download Instagram Reels/Posts and get download URL.

**Request Body:**
```json
{
  "url": "https://www.instagram.com/reel/SHORTCODE/"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Instagram content downloaded successfully",
  "title": "Instagram Reel",
  "filename": "a1b2c3d4e5f6.mp4",
  "downloadUrl": "/api/download-file/a1b2c3d4e5f6.mp4",
  "duration": 30,
  "uploader": "username",
  "description": "Amazing content description..."
}
```

#### `POST /api/download-reels`

Alternative endpoint for Instagram downloads (same functionality as `/api/instagram/download`).

**Request Body:**
```json
{
  "url": "https://www.instagram.com/reel/SHORTCODE/"
}
```

**Response:** Same as `/api/instagram/download`

#### `POST /api/instagram/batch`

Process multiple Instagram URLs at once (max 10 URLs).

**Request Body:**
```json
{
  "urls": [
    "https://www.instagram.com/reel/SHORTCODE1/",
    "https://www.instagram.com/reel/SHORTCODE2/",
    "https://www.instagram.com/p/SHORTCODE3/"
  ]
}
```

**Success Response (200):**
```json
{
  "success": true,
  "results": [
    {
      "url": "https://www.instagram.com/reel/SHORTCODE1/",
      "success": true,
      "data": {
        "shortcode": "SHORTCODE1",
        "isVideo": true,
        "videoUrl": "https://...",
        "caption": "Content 1",
        "username": "user1",
        "duration": 30
      },
      "error": null
    },
    {
      "url": "https://www.instagram.com/reel/SHORTCODE2/",
      "success": false,
      "data": null,
      "error": "Private content"
    }
  ]
}
```

**Limitations:**
- Maximum 10 URLs per batch
- Only returns metadata, doesn't download files

---

### File Download

#### `GET /api/download-file/:filename`

Download the processed video file.

**Parameters:**
- `filename`: The filename returned from download endpoints

**Response:**
- **Content-Type**: `video/mp4`
- **Content-Disposition**: `attachment; filename="filename.mp4"`
- Direct file stream download

**Example:**
```
GET /api/download-file/a1b2c3d4e5f6.mp4
```

**Error Response (404):**
```json
{
  "error": "File not found",
  "message": "The requested file does not exist or has been cleaned up"
}
```

---

## Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "error": "Invalid URL",
  "message": "Please provide a valid YouTube/Instagram URL"
}
```

**408 Request Timeout:**
```json
{
  "error": "Timeout",
  "message": "Download took too long and was cancelled"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Server error",
  "message": "An internal server error occurred"
}
```

### YouTube-Specific Errors

```json
{
  "error": "Video too long",
  "message": "This appears to be a regular video, not a short"
}
```

```json
{
  "error": "Download failed",
  "message": "Could not find downloaded file"
}
```

### Instagram-Specific Errors

```json
{
  "error": "Private content",
  "message": "This Instagram content is private and cannot be downloaded"
}
```

```json
{
  "error": "Content not available",
  "message": "This Instagram content is not available or has been removed"
}
```

```json
{
  "error": "Authentication required",
  "message": "Instagram is requiring login to access this content. This is a temporary restriction."
}
```

```json
{
  "error": "Rate limited",
  "message": "Instagram is rate limiting requests. Please wait a few minutes and try again."
}
```

```json
{
  "error": "Access blocked",
  "message": "Instagram has temporarily blocked access. This usually resolves within a few hours."
}
```

**Instagram Download Restrictions:**
- Instagram frequently updates their anti-bot measures
- Some content may require authentication
- Rate limiting may occur with frequent requests
- Private accounts cannot be accessed
- Regional restrictions may apply

---

## Usage Examples

### JavaScript (Fetch API)

```javascript
// Download YouTube Shorts
async function downloadYouTubeShorts(url) {
  try {
    const response = await fetch('http://localhost:3000/api/download-shorts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('Download URL:', result.downloadUrl);
      // Open download URL
      window.open(result.downloadUrl, '_blank');
    } else {
      console.error('Error:', result.message);
    }
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Get Instagram info
async function getInstagramInfo(url) {
  try {
    const response = await fetch('http://localhost:3000/api/instagram/info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('Content info:', result.data);
      return result.data;
    }
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Download Instagram content
async function downloadInstagram(url) {
  try {
    const response = await fetch('http://localhost:3000/api/instagram/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('Download URL:', result.downloadUrl);
      return result.downloadUrl;
    }
  } catch (error) {
    console.error('Request failed:', error);
  }
}

// Batch process Instagram URLs
async function batchProcessInstagram(urls) {
  try {
    const response = await fetch('http://localhost:3000/api/instagram/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urls })
    });
    
    const result = await response.json();
    
    if (result.success) {
      result.results.forEach((item, index) => {
        if (item.success) {
          console.log(`URL ${index + 1} processed:`, item.data);
        } else {
          console.error(`URL ${index + 1} failed:`, item.error);
        }
      });
    }
  } catch (error) {
    console.error('Batch request failed:', error);
  }
}
```

### cURL Examples

```bash
# Download YouTube Shorts
curl -X POST http://localhost:3000/api/download-shorts \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/shorts/VIDEO_ID"}'

# Get Instagram info
curl -X POST http://localhost:3000/api/instagram/info \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.instagram.com/reel/SHORTCODE/"}'

# Download Instagram content
curl -X POST http://localhost:3000/api/instagram/download \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.instagram.com/reel/SHORTCODE/"}'

# Alternative Instagram download
curl -X POST http://localhost:3000/api/download-reels \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.instagram.com/reel/SHORTCODE/"}'

# Batch process Instagram URLs
curl -X POST http://localhost:3000/api/instagram/batch \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.instagram.com/reel/SHORTCODE1/",
      "https://www.instagram.com/reel/SHORTCODE2/"
    ]
  }'

# Download file
curl -O http://localhost:3000/api/download-file/filename.mp4

# Health check
curl http://localhost:3000/api/health
```

### Python Example

```python
import requests
import json

class ShortsDownloader:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
    
    def download_youtube_shorts(self, url):
        """Download YouTube Shorts video"""
        response = requests.post(
            f"{self.base_url}/api/download-shorts",
            json={"url": url}
        )
        return response.json()
    
    def get_instagram_info(self, url):
        """Get Instagram content info"""
        response = requests.post(
            f"{self.base_url}/api/instagram/info",
            json={"url": url}
        )
        return response.json()
    
    def download_instagram(self, url):
        """Download Instagram content"""
        response = requests.post(
            f"{self.base_url}/api/instagram/download",
            json={"url": url}
        )
        return response.json()
    
    def batch_process_instagram(self, urls):
        """Process multiple Instagram URLs"""
        response = requests.post(
            f"{self.base_url}/api/instagram/batch",
            json={"urls": urls}
        )
        return response.json()
    
    def download_file(self, filename, output_path):
        """Download the actual file"""
        response = requests.get(f"{self.base_url}/api/download-file/{filename}")
        if response.status_code == 200:
            with open(output_path, 'wb') as f:
                f.write(response.content)
            return True
        return False

# Usage example
downloader = ShortsDownloader()

# Download YouTube Shorts
result = downloader.download_youtube_shorts("https://youtube.com/shorts/VIDEO_ID")
if result.get('success'):
    print(f"Title: {result['title']}")
    print(f"Quality: {result['quality']}")
    print(f"Download URL: {result['downloadUrl']}")
    
    # Download the actual file
    downloader.download_file(result['filename'], f"./{result['filename']}")

# Get Instagram info
info = downloader.get_instagram_info("https://www.instagram.com/reel/SHORTCODE/")
if info.get('success'):
    print(f"Username: {info['data']['username']}")
    print(f"Caption: {info['data']['caption']}")
    print(f"Duration: {info['data']['duration']} seconds")

# Download Instagram content
insta_result = downloader.download_instagram("https://www.instagram.com/reel/SHORTCODE/")
if insta_result.get('success'):
    print(f"Instagram content downloaded: {insta_result['filename']}")
    downloader.download_file(insta_result['filename'], f"./{insta_result['filename']}")
```

---

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode

### File Management

- **Downloads Directory**: `./downloads/`
- **Auto Cleanup**: Files older than 1 hour are automatically deleted
- **Cleanup Interval**: Every 30 minutes
- **Timeout**: 5 minutes for downloads with upscaling

### Python Dependencies

The API requires these Python packages (install via `pip install -r requirements.txt`):
- `yt-dlp`: For video downloading and info extraction
- `requests`: For HTTP requests

---

## Technical Details

### Video Processing

1. **Quality Detection**: Automatically detects available video qualities
2. **Upscaling Algorithm**: Uses FFmpeg with high-quality filters:
   - Lanczos scaling with accurate rounding
   - Noise reduction (hqdn3d)
   - Unsharp masking for clarity
   - Advanced encoding settings for maximum quality

3. **Format Support**: MP4, WebM, MKV (converted to MP4)

### Supported URLs

**YouTube:**
- `https://youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://youtu.be/VIDEO_ID`

**Instagram:**
- `https://www.instagram.com/reel/SHORTCODE/`
- `https://www.instagram.com/p/SHORTCODE/`
- `https://instagram.com/reel/SHORTCODE/`

### Video Quality Processing

**YouTube Shorts:**
- Downloads best available quality first
- Automatically upscales videos below 1080p
- Uses advanced FFmpeg filters for upscaling:
  - `scale=width:height:flags=lanczos+accurate_rnd+full_chroma_int`
  - `hqdn3d=2:1:2:1` (noise reduction)
  - `unsharp=5:5:1.0:5:5:0.0` (sharpening)
- Encoding settings optimized for quality:
  - H.264 codec with `veryslow` preset
  - CRF 16 (very high quality)
  - High profile with advanced settings

**Instagram Content:**
- Downloads best available format
- Supports both Reels and regular posts
- Maintains original quality

---

## Architecture

### File Structure
```
/
├── main.js              # Main server file
├── package.json         # Node.js dependencies
├── requirements.txt     # Python dependencies
├── downloads/           # Temporary download directory
└── venv/               # Python virtual environment
```

### Data Flow

1. **Request Processing**: URL validation and parameter extraction
2. **Python Script Generation**: Dynamic Python scripts for yt-dlp
3. **Video Download**: yt-dlp downloads the content
4. **Quality Processing**: FFmpeg upscaling if needed
5. **File Management**: File serving and cleanup
6. **Response**: JSON response with download URLs

### Security Features

- URL validation to prevent malicious inputs
- File path sanitization
- Automatic cleanup of temporary files
- Process timeouts to prevent resource exhaustion
- Error handling for failed downloads

---

## 🔧 Troubleshooting

### Common Issues

#### Instagram Downloads Failing
**Error**: "This Instagram content is not available or has been removed"

**Causes & Solutions**:

1. **Cloud Platform IP Blocking** (Most Common)
   - Instagram blocks requests from datacenter IPs (GCP, AWS, Azure)
   - **Solution**: Use residential proxy service
   ```bash
   export INSTAGRAM_PROXY_URL=http://user:pass@residential-proxy.com:8080
   ```

2. **Rate Limiting**
   - Too many requests in short time
   - **Solution**: Wait 30-60 minutes before trying again
   - The API automatically implements delays and retries

3. **Content Actually Private/Deleted**
   - The Instagram content is genuinely unavailable
   - **Solution**: Verify the URL is correct and content is public

4. **User Agent Detection**
   - Instagram blocking your user agent
   - **Solution**: The API automatically rotates user agents

#### YouTube Downloads Failing
**Error**: Various yt-dlp errors

**Solutions**:
1. Update yt-dlp: `pip install -U yt-dlp`
2. Check if the video is available in your region
3. Verify the URL format is correct

#### FFmpeg Issues
**Error**: FFmpeg not found or encoding failures

**Solutions**:
1. **Install FFmpeg**:
   - Ubuntu/Debian: `sudo apt install ffmpeg`
   - macOS: `brew install ffmpeg`
   - Windows: Download from [ffmpeg.org](https://ffmpeg.org)

2. **Check FFmpeg Path**:
   ```bash
   which ffmpeg  # Should show path to ffmpeg
   ```

#### Server Performance
**Issue**: Slow downloads or timeouts

**Solutions**:
1. **Increase timeout limits** in your reverse proxy (nginx, etc.)
2. **Use streaming downloads** (already implemented)
3. **Monitor server resources** (CPU, memory, disk space)

### Cloud-Specific Troubleshooting

#### Google Cloud Platform (GCP)
```bash
# Set GCP environment variables
export GOOGLE_CLOUD_PROJECT=your-project-id
export NODE_ENV=production

# For App Engine, add to app.yaml:
runtime: nodejs16
env_variables:
  NODE_ENV: production
  INSTAGRAM_PROXY_URL: your-proxy-url
```

#### AWS
```bash
# Set AWS environment variables
export AWS_REGION=us-east-1
export NODE_ENV=production

# For Elastic Beanstalk, add to .ebextensions/environment.config:
option_settings:
  aws:elasticbeanstalk:application:environment:
    NODE_ENV: production
    INSTAGRAM_PROXY_URL: your-proxy-url
```

#### Azure
```bash
# Set Azure environment variables
export AZURE_REGION=eastus
export NODE_ENV=production

# For App Service, set in Application Settings:
NODE_ENV=production
INSTAGRAM_PROXY_URL=your-proxy-url
```

### Monitoring & Debugging

#### Enable Debug Logging
```bash
# Set debug mode
export DEBUG=true

# Check logs for detailed error information
tail -f /var/log/your-app.log
```

#### Test Endpoints
```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Test Instagram connectivity (new debug endpoint)
curl -X POST http://localhost:3000/api/test/instagram \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/reel/SHORTCODE/"}'

# Test Instagram info (without downloading)
curl "http://localhost:3000/api/instagram/info?url=INSTAGRAM_URL"
```

#### Debug Instagram Issues on Cloud Platforms
```bash
# 1. Check your environment
curl http://your-domain.com/api/health

# 2. Test Instagram connectivity
curl -X POST http://your-domain.com/api/test/instagram \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/reel/YOUR_SHORTCODE/"}'

# 3. If blocked, configure a proxy
export INSTAGRAM_PROXY_URL=http://user:pass@residential-proxy.com:8080

# 4. Restart your application and test again
```

### Legacy Issues (Less Common)

1. **Python virtual environment issues**
   ```
   Error: Python executable not found
   ```
   - Ensure the virtual environment is activated
   - Install required packages: `pip install -r requirements.txt`

2. **Download timeouts**
   ```
   Error: "Download took too long and was cancelled"
   ```
   - Large files or slow upscaling may timeout
   - Current timeout is 5 minutes (300 seconds)

5. **Port already in use**
   ```
   Error: EADDRINUSE: address already in use :::3000
   ```
   - Change the port using environment variable: `PORT=3001 node main.js`

6. **Instagram API changes**
   ```
   Error: Various Instagram-related errors
   ```
   - Instagram frequently changes their API and anti-bot measures
   - **Solution**: Keep yt-dlp updated: `pip install --upgrade yt-dlp`
   - Try again after some time as restrictions are often temporary

### Debug Information

The server provides detailed logging:
- Python script output to stderr
- Available video qualities and formats
- Upscaling process information
- File processing status

### Performance Tips

1. **Memory Usage**: Files are streamed, not loaded into memory
2. **Concurrent Downloads**: Each request spawns a separate Python process
3. **Cleanup**: Old files are automatically removed to save disk space
4. **Caching**: No caching implemented - each request downloads fresh content

---

## API Rate Limits

- No explicit rate limiting implemented
- Natural limits imposed by:
  - YouTube/Instagram server responses
  - Processing time for upscaling
  - Available system resources

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is for educational purposes. Please respect the terms of service of YouTube and Instagram when using this API.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review server logs for detailed error information
3. Create an issue in the repository with:
   - Error message
   - URL that failed
   - Server logs
   - Environment details
