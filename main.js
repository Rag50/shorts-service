const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000; 

// script check
// insta + yt

// Middleware
app.use(express.json());
app.use(cors());

// thumnail snapshot

// Create downloads directory if it doesn't exist
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Clean up old files (older than 1 hour)
const cleanupOldFiles = () => {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    files.forEach(file => {
        const filePath = path.join(DOWNLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > oneHour) {
            fs.unlinkSync(filePath);
            console.log(`Cleaned up old file: ${file}`);
        }
    });
};

// Run cleanup every 30 minutes
setInterval(cleanupOldFiles, 30 * 60 * 1000);

// Validate YouTube URL
const isValidYouTubeUrl = (url) => {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
};

// Instagram URL validation
const validateInstagramUrl = (url) => {
    const instagramRegex = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/(reel|p)\/[\w-]+\/?/;
    return instagramRegex.test(url);
};

// Extract shortcode from Instagram URL
const extractShortcode = (url) => {
    const match = url.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : null;
};

// Get video info from Instagram
const getInstagramVideoInfo = async (shortcode) => {
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
        };

        // Try multiple approaches
        let response;
        let html;
        
        try {
            // Method 1: Try the embed endpoint first
            response = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/`, {
                headers,
                timeout: 15000
            });
            html = response.data;
        } catch (embedError) {
            console.log('Embed method failed, trying main page...');
            
            // Method 2: Try the main page
            response = await axios.get(`https://www.instagram.com/p/${shortcode}/`, {
                headers,
                timeout: 15000
            });
            html = response.data;
        }

        // Try to extract data using multiple patterns
        let mediaData = null;
        
        // Pattern 1: Look for window.__additionalDataLoaded
        let jsonMatch = html.match(/window\.__additionalDataLoaded\s*\(\s*['"]\/p\/[^'"]+['"]\s*,\s*({.+?})\s*\)/);
        if (jsonMatch) {
            try {
                const additionalData = JSON.parse(jsonMatch[1]);
                mediaData = additionalData.graphql?.shortcode_media || additionalData.items?.[0];
            } catch (e) {
                console.log('Failed to parse additionalDataLoaded');
            }
        }

        // Pattern 2: Look for window._sharedData (legacy)
        if (!mediaData) {
            jsonMatch = html.match(/window\._sharedData\s*=\s*({.+?});/);
            if (jsonMatch) {
                try {
                    const sharedData = JSON.parse(jsonMatch[1]);
                    mediaData = sharedData.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
                } catch (e) {
                    console.log('Failed to parse sharedData');
                }
            }
        }

        // Pattern 3: Look for script tags with application/ld+json
        if (!mediaData) {
            const ldJsonMatch = html.match(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/);
            if (ldJsonMatch) {
                try {
                    const ldData = JSON.parse(ldJsonMatch[1]);
                    if (ldData.video) {
                        mediaData = {
                            is_video: true,
                            video_url: ldData.video.contentUrl || ldData.video.url,
                            display_url: ldData.video.thumbnailUrl,
                            edge_media_to_caption: {
                                edges: [{ node: { text: ldData.caption || '' } }]
                            },
                            owner: { username: ldData.author?.alternateName || '' }
                        };
                    }
                } catch (e) {
                    console.log('Failed to parse LD+JSON');
                }
            }
        }

        // Pattern 4: Try to find video URL directly in HTML
        if (!mediaData) {
            const videoUrlMatch = html.match(/"video_url":\s*"([^"]+)"/);
            const thumbnailMatch = html.match(/"display_url":\s*"([^"]+)"/);
            const usernameMatch = html.match(/"username":\s*"([^"]+)"/);
            
            if (videoUrlMatch) {
                mediaData = {
                    is_video: true,
                    video_url: videoUrlMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, ''),
                    display_url: thumbnailMatch ? thumbnailMatch[1].replace(/\\/g, '') : null,
                    owner: { username: usernameMatch ? usernameMatch[1] : '' },
                    edge_media_to_caption: { edges: [] }
                };
            }
        }

        if (!mediaData) {
            throw new Error('Could not extract media data from Instagram page');
        }

        // Extract video URL and other data
        let videoUrl = null;
        let thumbnailUrl = null;
        let isVideo = false;

        if (mediaData.is_video && mediaData.video_url) {
            // Clean up the video URL
            videoUrl = mediaData.video_url.replace(/\\u0026/g, '&').replace(/\\/g, '');
            isVideo = true;
        }
        
        if (mediaData.display_url) {
            thumbnailUrl = mediaData.display_url.replace(/\\/g, '');
        }

        // If we still don't have a video URL and it's supposed to be a video, try alternative extraction
        if (!videoUrl && mediaData.is_video) {
            const videoMatch = html.match(/https:\\\/\\\/[^"]*\.mp4[^"]*/);
            if (videoMatch) {
                videoUrl = videoMatch[0].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
            }
        }

        return {
            success: true,
            data: {
                shortcode,
                isVideo,
                videoUrl,
                thumbnailUrl,
                caption: mediaData.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                username: mediaData.owner?.username || '',
                likesCount: mediaData.edge_media_preview_like?.count || 0,
                commentsCount: mediaData.edge_media_to_comment?.count || 0,
                viewsCount: mediaData.video_view_count || 0
            }
        };

    } catch (error) {
        console.error('Error fetching Instagram data:', error.message);
        console.error('Error details:', error.response?.status, error.response?.statusText);
        
        // Provide more specific error messages
        if (error.response?.status === 404) {
            throw new Error('Instagram post not found or has been deleted');
        } else if (error.response?.status === 403) {
            throw new Error('Access denied - the post might be private');
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            throw new Error('Request timeout - Instagram might be blocking requests');
        } else {
            throw new Error(`Failed to fetch Instagram media data: ${error.message}`);
        }
    }
};

// Alternative Instagram download using yt-dlp (more reliable)
const downloadInstagramWithYtDlp = async (url, outputPath) => {
    return new Promise((resolve, reject) => {
        const pythonScript = `
import yt_dlp
import sys
import json
import os
import logging

# Disable yt-dlp logging to stdout
logging.getLogger('yt_dlp').setLevel(logging.CRITICAL)

def download_instagram_content(url, output_path):
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'outtmpl': output_path,
        'noplaylist': True,
        'extract_flat': False,
        'writethumbnail': False,
        'writeinfojson': False,
        'quiet': True,
        'no_warnings': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        },
        'ignoreerrors': False,
        'merge_output_format': 'mp4',
        'prefer_ffmpeg': True,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Get video info first
            info = ydl.extract_info(url, download=False)
            title = info.get('title', 'Instagram Content')
            duration = info.get('duration', 0)
            uploader = info.get('uploader', 'Unknown')
            description = info.get('description', '')
            
            # Download the content
            ydl.download([url])
            
            # Find the downloaded file
            base_path = output_path.replace('.%(ext)s', '')
            downloaded_file = None
            
            for ext in ['mp4', 'webm', 'mkv', 'mov']:
                file_path = f"{base_path}.{ext}"
                if os.path.exists(file_path):
                    downloaded_file = file_path
                    break
            
            if not downloaded_file:
                result = {
                    'error': 'Download failed',
                    'message': 'Could not find downloaded file'
                }
                sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.stdout.flush()
                sys.exit(1)
            
            result = {
                'success': True,
                'title': title,
                'filename': os.path.basename(downloaded_file),
                'duration': duration,
                'uploader': uploader,
                'description': description[:200] + '...' if len(description) > 200 else description
            }
            sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
            sys.stdout.flush()
            sys.exit(0)
            
    except Exception as e:
        error_msg = str(e)
        if 'private' in error_msg.lower():
            result = {
                'error': 'Private content',
                'message': 'This Instagram content is private and cannot be downloaded'
            }
        elif 'not available' in error_msg.lower():
            result = {
                'error': 'Content not available',
                'message': 'This Instagram content is not available or has been removed'
            }
        elif 'login' in error_msg.lower() or 'authentication' in error_msg.lower():
            result = {
                'error': 'Authentication required',
                'message': 'This content requires authentication to access'
            }
        else:
            result = {
                'error': 'Download failed',
                'message': f'Failed to download Instagram content: {error_msg}'
            }
        
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.stdout.flush()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        result = {
            'error': 'Invalid arguments',
            'message': 'Usage: python script.py <url> <output_path>'
        }
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.stdout.flush()
        sys.exit(1)
    
    url = sys.argv[1]
    output_path = sys.argv[2]
    download_instagram_content(url, output_path)
`;

        // Write Python script to temporary file
        const scriptPath = path.join(__dirname, 'temp_instagram_downloader.py');
        fs.writeFileSync(scriptPath, pythonScript);

        // Execute Python script
        const venvPath = path.join(__dirname, 'venv');
        const pythonExecutable = process.platform === 'win32' 
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python');
        
        const pythonProcess = spawn(pythonExecutable, [scriptPath, url, outputPath]);
        
        let output = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        pythonProcess.on('close', (code) => {
            // Clean up temp script
            if (fs.existsSync(scriptPath)) {
                fs.unlinkSync(scriptPath);
            }

            if (code === 0) {
                try {
                    const jsonMatch = output.match(/JSON_START(.+?)JSON_END/);
                    if (jsonMatch && jsonMatch[1]) {
                        const result = JSON.parse(jsonMatch[1]);
                        resolve(result);
                    } else {
                        reject(new Error('Could not parse download result'));
                    }
                } catch (parseError) {
                    reject(new Error('Failed to parse download result'));
                }
            } else {
                try {
                    let jsonMatch = output.match(/JSON_START(.+?)JSON_END/);
                    if (!jsonMatch) {
                        jsonMatch = errorOutput.match(/JSON_START(.+?)JSON_END/);
                    }
                    
                    if (jsonMatch && jsonMatch[1]) {
                        const errorResult = JSON.parse(jsonMatch[1]);
                        reject(new Error(errorResult.message || errorResult.error));
                    } else {
                        reject(new Error('Instagram download failed'));
                    }
                } catch {
                    reject(new Error('Instagram download failed'));
                }
            }
        });
    });
};

// Generate random filename
const generateFilename = () => {
    return crypto.randomBytes(16).toString('hex');
};

// YouTube Shorts downloader endpoint
app.post('/api/download-shorts', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ 
                error: 'URL is required',
                message: 'Please provide a YouTube URL'
            });
        }

        if (!isValidYouTubeUrl(url)) {
            return res.status(400).json({ 
                error: 'Invalid URL',
                message: 'Please provide a valid YouTube URL'
            });
        }

        // Download and upscale to 1080p if needed
        const videoQuality = 'upscaled 1080p';

        const filename = generateFilename();
        const outputPath = path.join(DOWNLOADS_DIR, `${filename}.%(ext)s`);

        console.log(`Starting download for: ${url} (quality: ${videoQuality})`);

        // Python script with yt-dlp
        const pythonScript = `
import yt_dlp
import sys
import json
import os
import logging

# Disable yt-dlp logging to stdout to prevent JSON parsing issues
logging.getLogger('yt_dlp').setLevel(logging.CRITICAL)

def upscale_video(input_path, output_path):
    """Upscale video to 1080p using ffmpeg with high-quality scaling"""
    import subprocess
    
    try:
        # Check if ffmpeg is available
        try:
            subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            sys.stderr.write("FFmpeg not found. Please install FFmpeg to enable upscaling.\\n")
            return input_path
        
        # Check if video needs upscaling by getting current resolution
        probe_cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', input_path
        ]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
        
        if probe_result.returncode != 0:
            sys.stderr.write(f"Failed to probe video: {probe_result.stderr}\\n")
            return input_path  # Return original if probe fails
        
        import json
        probe_data = json.loads(probe_result.stdout)
        video_stream = next((s for s in probe_data['streams'] if s['codec_type'] == 'video'), None)
        
        if not video_stream:
            sys.stderr.write("No video stream found\\n")
            return input_path
        
        current_height = int(video_stream.get('height', 0))
        current_width = int(video_stream.get('width', 0))
        
        sys.stderr.write(f"Current resolution: {current_width}x{current_height}\\n")
        
        # Only upscale if current height is less than 1080p
        if current_height >= 1080:
            sys.stderr.write("Video is already 1080p or higher, no upscaling needed\\n")
            return input_path
        
        # Calculate new dimensions maintaining aspect ratio
        aspect_ratio = current_width / current_height
        new_height = 1080
        new_width = int(new_height * aspect_ratio)
        
        # Ensure width is even (required for many codecs)
        if new_width % 2 != 0:
            new_width += 1
        
        sys.stderr.write(f"Upscaling to: {new_width}x{new_height} with ultra high quality settings\\n")
        
        # Check for additional enhancement filters
        enhancement_available = True
        try:
            # Test if advanced filters are available
            test_cmd = ['ffmpeg', '-hide_banner', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=1', '-f', 'null', '-']
            subprocess.run(test_cmd, capture_output=True, timeout=5)
        except:
            enhancement_available = False
        
        if enhancement_available:
            sys.stderr.write("Using advanced enhancement filters\\n")
        else:
            sys.stderr.write("Using standard enhancement filters\\n")
        
        # FFmpeg command for ultra high-quality upscaling
        if enhancement_available:
            # Ultra high quality with noise reduction and sharpening
            video_filter = f'scale={new_width}:{new_height}:flags=lanczos+accurate_rnd+full_chroma_int,hqdn3d=2:1:2:1,unsharp=5:5:1.0:5:5:0.0'
        else:
            # Standard high quality upscaling
            video_filter = f'scale={new_width}:{new_height}:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=5:5:1.0:5:5:0.0'
        
        ffmpeg_cmd = [
            'ffmpeg', '-i', input_path,
            # Advanced scaling with multiple filters for maximum quality
            '-vf', video_filter,
            # Video encoding settings for maximum quality
            '-c:v', 'libx264',              # H.264 codec
            '-preset', 'veryslow',          # Best compression (highest quality)
            '-crf', '16',                   # Very high quality (lower = better)
            '-profile:v', 'high',           # High profile for better quality
            '-level', '4.1',                # H.264 level for 1080p
            '-pix_fmt', 'yuv420p',          # Pixel format for compatibility
            '-refs', '16',                  # More reference frames
            '-bf', '16',                    # More B-frames
            '-g', '250',                    # GOP size
            '-keyint_min', '25',            # Minimum keyframe interval
            '-sc_threshold', '40',          # Scene change threshold
            '-me_method', 'umh',            # Motion estimation method
            '-subq', '10',                  # Sub-pixel motion estimation
            '-trellis', '2',                # Trellis quantization
            '-aq-mode', '2',                # Adaptive quantization
            '-aq-strength', '1.0',          # AQ strength
            # Audio settings
            '-c:a', 'aac',                  # AAC audio codec
            '-b:a', '192k',                 # Higher audio bitrate
            '-ar', '48000',                 # Audio sample rate
            # Output optimization
            '-movflags', '+faststart',      # Web optimization
            '-y',                           # Overwrite output file
            output_path
        ]
        
        sys.stderr.write("Starting upscaling process...\\n")
        sys.stderr.flush()
        
        # Run ffmpeg with detailed error output
        process = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        
        if process.returncode == 0:
            sys.stderr.write("Upscaling completed successfully\\n")
            sys.stderr.write(f"FFmpeg stdout: {process.stdout}\\n")
            
            # Verify the output file exists and check its resolution
            if os.path.exists(output_path):
                try:
                    verify_cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', output_path]
                    verify_result = subprocess.run(verify_cmd, capture_output=True, text=True)
                    if verify_result.returncode == 0:
                        verify_data = json.loads(verify_result.stdout)
                        video_stream = next((s for s in verify_data['streams'] if s['codec_type'] == 'video'), None)
                        if video_stream:
                            final_height = int(video_stream.get('height', 0))
                            final_width = int(video_stream.get('width', 0))
                            sys.stderr.write(f"Upscaled video resolution: {final_width}x{final_height}\\n")
                except Exception as e:
                    sys.stderr.write(f"Could not verify upscaled video: {str(e)}\\n")
            
            return output_path
        else:
            sys.stderr.write(f"FFmpeg failed with return code: {process.returncode}\\n")
            sys.stderr.write(f"FFmpeg stderr: {process.stderr}\\n")
            sys.stderr.write(f"FFmpeg stdout: {process.stdout}\\n")
            sys.stderr.write(f"FFmpeg command: {' '.join(ffmpeg_cmd)}\\n")
            return input_path  # Return original if upscaling fails
            
    except Exception as e:
        sys.stderr.write(f"Upscaling error: {str(e)}\\n")
        return input_path  # Return original if upscaling fails

def download_video(url, output_path):
    # User agents to avoid blocking
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
    
    # Format string for best available quality - will upscale later
    # Get the best quality first, then upscale with ffmpeg
    format_str = 'bestvideo+bestaudio/best'
    
    ydl_opts = {
        'format': format_str,  # Download best available quality
        'outtmpl': output_path,
        'noplaylist': True,
        'extract_flat': False,
        'writethumbnail': False,
        'writeinfojson': False,
        'quiet': True,  # Suppress yt-dlp output
        'no_warnings': True,  # Suppress warnings
        'user_agent': user_agents[0],
        'http_headers': {
            'User-Agent': user_agents[0],
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        },
        'extractor_args': {
            'youtube': {
                'player_client': ['web', 'android'],  # Web client first for best quality
                'skip': []  # Don't skip any streams to get all available qualities
            }
        },
        'cookiesfrombrowser': None,
        'sleep_interval': 1,
        'max_sleep_interval': 5,
        'ignoreerrors': False,
        'merge_output_format': 'mp4',  # Ensure output is MP4
        'prefer_ffmpeg': True,  # Use ffmpeg for better quality merging
        'postprocessors': [{
            'key': 'FFmpegVideoConvertor',
            'preferedformat': 'mp4',
        }],
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Get video info first
            info = ydl.extract_info(url, download=False)
            title = info.get('title', 'Unknown')
            duration = info.get('duration', 0)
            
            # Check available formats for debugging
            formats = info.get('formats', [])
            video_formats = [f for f in formats if f.get('vcodec') != 'none']
            best_1080p = [f for f in video_formats if f.get('height') == 1080]
            available_heights = sorted(list(set([f.get('height') for f in video_formats if f.get('height')])), reverse=True)
            highest_quality = available_heights[0] if available_heights else 'unknown'
            
            # Log available formats for debugging
            sys.stderr.write(f"Available video heights: {available_heights}\\n")
            sys.stderr.write(f"Highest available quality: {highest_quality}p\\n")
            sys.stderr.write(f"Available 1080p formats: {len(best_1080p)}\\n")
            if best_1080p:
                sys.stderr.write(f"Best 1080p format: {best_1080p[0].get('format_id', 'unknown')} - {best_1080p[0].get('ext', 'unknown')}\\n")
            
            # Determine if upscaling is needed
            needs_upscaling = highest_quality < 1080 if highest_quality != 'unknown' else True
            sys.stderr.write(f"Needs upscaling: {needs_upscaling}\\n")
            sys.stderr.flush()
            
            # Check if it's a short video (typically under 60 seconds)
            if duration and duration > 180:  # 3 minutes
                result = {
                    'error': 'Video too long',
                    'message': 'This appears to be a regular video, not a short'
                }
                sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.stdout.flush()
                sys.exit(1)
            
            # Download the video
            ydl.download([url])
            
            # Find the downloaded file
            base_path = output_path.replace('.%(ext)s', '')
            downloaded_file = None
            
            for ext in ['mp4', 'webm', 'mkv', 'flv']:
                file_path = f"{base_path}.{ext}"
                if os.path.exists(file_path):
                    downloaded_file = file_path
                    break
            
            if not downloaded_file:
                result = {
                    'error': 'Download failed',
                    'message': 'Could not find downloaded file'
                }
                sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.stdout.flush()
                sys.exit(1)
            
            # Upscale video if needed
            final_file = downloaded_file
            original_quality = highest_quality
            
            if needs_upscaling:
                sys.stderr.write(f"Starting upscaling process for {downloaded_file}...\\n")
                upscaled_path = f"{base_path}_upscaled.mp4"
                sys.stderr.write(f"Upscaled file will be: {upscaled_path}\\n")
                
                final_file = upscale_video(downloaded_file, upscaled_path)
                
                # Check if upscaling was successful
                if final_file == upscaled_path and os.path.exists(upscaled_path):
                    file_size = os.path.getsize(upscaled_path)
                    sys.stderr.write(f"Upscaling successful! File size: {file_size} bytes\\n")
                    
                    # Remove original file to save space
                    if os.path.exists(downloaded_file) and downloaded_file != upscaled_path:
                        os.remove(downloaded_file)
                        sys.stderr.write("Original file removed after successful upscaling\\n")
                else:
                    # If upscaling failed, use original file
                    final_file = downloaded_file
                    sys.stderr.write("Using original file (upscaling failed)\\n")
            else:
                sys.stderr.write("No upscaling needed - video is already high quality\\n")
            
            if os.path.exists(final_file):
                final_quality = "1080p (upscaled)" if needs_upscaling and final_file.endswith('_upscaled.mp4') else f"{highest_quality}p"
                
                result = {
                    'success': True,
                    'title': title,
                    'filename': os.path.basename(final_file),
                    'duration': duration,
                    'quality': final_quality,
                    'original_quality': f"{highest_quality}p" if highest_quality != 'unknown' else 'unknown',
                    'upscaled': needs_upscaling and final_file.endswith('_upscaled.mp4')
                }
                sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.stdout.flush()
                sys.exit(0)
            else:
                result = {
                    'error': 'Processing failed',
                    'message': 'Could not process downloaded file'
                }
                sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.stdout.flush()
                sys.exit(1)
            
    except Exception as e:
        result = {
            'error': 'Download failed',
            'message': str(e)
        }
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.stdout.flush()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        result = {
            'error': 'Invalid arguments',
            'message': 'Usage: python script.py <url> <output_path>'
        }
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.stdout.flush()
        sys.exit(1)
    
    url = sys.argv[1]
    output_path = sys.argv[2]
    download_video(url, output_path)
`;

        // Write Python script to temporary file
        const scriptPath = path.join(__dirname, 'temp_downloader.py');
        fs.writeFileSync(scriptPath, pythonScript);

        // Execute Python script using virtual environment
        const venvPath = path.join(__dirname, 'venv');
        const pythonExecutable = process.platform === 'win32' 
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python');
        
        const pythonProcess = spawn(pythonExecutable, [scriptPath, url, outputPath]);
        
        let output = '';
        let errorOutput = '';
        let responded = false;

        pythonProcess.stdout.on('data', (data) => {
            const dataStr = data.toString();
            output += dataStr;
            // Log non-JSON output for debugging
            if (!dataStr.includes('JSON_START')) {
                console.log('Python stdout:', dataStr.trim());
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            const dataStr = data.toString();
            errorOutput += dataStr;
            console.error('Python stderr:', dataStr.trim());
        });

        pythonProcess.on('close', (code) => {
            // Clean up temp script
            if (fs.existsSync(scriptPath)) {
                fs.unlinkSync(scriptPath);
            }

            if (responded) return;
            responded = true;

            if (code === 0) {
                try {
                    // Extract JSON from output using markers
                    const jsonMatch = output.match(/JSON_START(.+?)JSON_END/);
                    if (jsonMatch && jsonMatch[1]) {
                        const result = JSON.parse(jsonMatch[1]);
                        if (result.success) {
                            const filePath = path.join(DOWNLOADS_DIR, result.filename);
                            if (fs.existsSync(filePath)) {
                                const message = result.upscaled 
                                    ? `Video downloaded and upscaled to ${result.quality} (from ${result.original_quality})`
                                    : `Video downloaded in ${result.quality}`;
                                
                                res.json({
                                    success: true,
                                    message: message,
                                    title: result.title,
                                    filename: result.filename,
                                    downloadUrl: `/api/download-file/${result.filename}`,
                                    duration: result.duration,
                                    quality: result.quality,
                                    originalQuality: result.original_quality,
                                    upscaled: result.upscaled || false
                                });
                            } else {
                                res.status(500).json({
                                    error: 'File not found',
                                    message: 'Downloaded file could not be located'
                                });
                            }
                        } else {
                            res.status(400).json(result);
                        }
                    } else {
                        console.error('No valid JSON found in output:', output);
                        res.status(500).json({
                            error: 'Processing failed',
                            message: 'Could not process download result'
                        });
                    }
                } catch (parseError) {
                    console.error('Parse error:', parseError);
                    console.error('Raw output:', output);
                    res.status(500).json({
                        error: 'Processing failed',
                        message: 'Could not process download result'
                    });
                }
            } else {
                console.error('Python script error:', errorOutput);
                console.error('Python script output:', output);
                
                try {
                    // Try to extract JSON from output or error output
                    let jsonMatch = output.match(/JSON_START(.+?)JSON_END/);
                    if (!jsonMatch) {
                        jsonMatch = errorOutput.match(/JSON_START(.+?)JSON_END/);
                    }
                    
                    if (jsonMatch && jsonMatch[1]) {
                        const errorResult = JSON.parse(jsonMatch[1]);
                        res.status(400).json(errorResult);
                    } else {
                        res.status(500).json({
                            error: 'Download failed',
                            message: 'An error occurred while downloading the video'
                        });
                    }
                } catch {
                    res.status(500).json({
                        error: 'Download failed',
                        message: 'An error occurred while downloading the video'
                    });
                }
            }
        });

        // Set timeout for long-running downloads and upscaling
        setTimeout(() => {
            if (!pythonProcess.killed) {
                pythonProcess.kill();
                if (!responded) {
                    responded = true;
                    res.status(408).json({
                        error: 'Timeout',
                        message: 'Download took too long and was cancelled'
                    });
                }
            }
        }, 300000); // 5 minutes timeout for ultra high-quality upscaling

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            error: 'Server error',
            message: 'An internal server error occurred'
        });
    }
});

// Instagram Reels info endpoint
app.post('/api/instagram/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        if (!validateInstagramUrl(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Instagram URL'
            });
        }

        // Try yt-dlp method first as it's more reliable
        try {
            const filename = generateFilename();
            const outputPath = path.join(DOWNLOADS_DIR, `${filename}.%(ext)s`);
            
            // Use yt-dlp to extract info without downloading
            const pythonScript = `
import yt_dlp
import sys
import json
import logging

# Disable yt-dlp logging to stdout
logging.getLogger('yt_dlp').setLevel(logging.CRITICAL)

def get_instagram_info(url):
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        },
        'ignoreerrors': False,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Extract info only, don't download
            info = ydl.extract_info(url, download=False)
            
            result = {
                'success': True,
                'data': {
                    'shortcode': url.split('/')[-2] if url.split('/')[-2] else url.split('/')[-3],
                    'isVideo': True,  # Instagram content is typically video
                    'videoUrl': info.get('url', ''),
                    'thumbnailUrl': info.get('thumbnail', ''),
                    'caption': info.get('description', '') or info.get('title', ''),
                    'username': info.get('uploader', '') or info.get('channel', ''),
                    'likesCount': info.get('like_count', 0),
                    'commentsCount': info.get('comment_count', 0),
                    'viewsCount': info.get('view_count', 0),
                    'duration': info.get('duration', 0)
                }
            }
            sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
            sys.stdout.flush()
            sys.exit(0)
            
    except Exception as e:
        error_msg = str(e)
        if 'private' in error_msg.lower():
            result = {
                'success': False,
                'error': 'Private content',
                'message': 'This Instagram content is private and cannot be accessed'
            }
        elif 'not available' in error_msg.lower():
            result = {
                'success': False,
                'error': 'Content not available',
                'message': 'This Instagram content is not available or has been removed'
            }
        elif 'login' in error_msg.lower() or 'authentication' in error_msg.lower():
            result = {
                'success': False,
                'error': 'Authentication required',
                'message': 'This content requires authentication to access'
            }
        else:
            result = {
                'success': False,
                'error': 'Failed to extract info',
                'message': f'Failed to extract Instagram info: {error_msg}'
            }
        
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.stdout.flush()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        result = {
            'success': False,
            'error': 'Invalid arguments',
            'message': 'Usage: python script.py <url>'
        }
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.stdout.flush()
        sys.exit(1)
    
    url = sys.argv[1]
    get_instagram_info(url)
`;

            // Write Python script to temporary file
            const scriptPath = path.join(__dirname, 'temp_instagram_info.py');
            fs.writeFileSync(scriptPath, pythonScript);

            // Execute Python script
            const venvPath = path.join(__dirname, 'venv');
            const pythonExecutable = process.platform === 'win32' 
                ? path.join(venvPath, 'Scripts', 'python.exe')
                : path.join(venvPath, 'bin', 'python');
            
            const { spawn } = require('child_process');
            const pythonProcess = spawn(pythonExecutable, [scriptPath, url]);
            
            let output = '';
            let errorOutput = '';

            pythonProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            pythonProcess.on('close', (code) => {
                // Clean up temp script
                if (fs.existsSync(scriptPath)) {
                    fs.unlinkSync(scriptPath);
                }

                try {
                    const jsonMatch = output.match(/JSON_START(.+?)JSON_END/);
                    if (jsonMatch && jsonMatch[1]) {
                        const result = JSON.parse(jsonMatch[1]);
                        res.json(result);
                    } else {
                        // Fallback to basic info
                        const shortcode = extractShortcode(url);
                        res.json({
                            success: true,
                            data: {
                                shortcode: shortcode,
                                isVideo: true,
                                videoUrl: '',
                                thumbnailUrl: '',
                                caption: 'Instagram content',
                                username: 'Unknown',
                                likesCount: 0,
                                commentsCount: 0,
                                viewsCount: 0
                            }
                        });
                    }
                } catch (parseError) {
                    console.error('Parse error:', parseError);
                    res.status(500).json({
                        success: false,
                        error: 'Failed to parse info result'
                    });
                }
            });

        } catch (ytDlpError) {
            console.log('yt-dlp info extraction failed, using fallback...');
            
            // Fallback to basic URL info
            const shortcode = extractShortcode(url);
            if (!shortcode) {
                return res.status(400).json({
                    success: false,
                    error: 'Could not extract shortcode from URL'
                });
            }

            res.json({
                success: true,
                data: {
                    shortcode: shortcode,
                    isVideo: true,
                    videoUrl: '',
                    thumbnailUrl: '',
                    caption: 'Instagram content (info extraction limited)',
                    username: 'Unknown',
                    likesCount: 0,
                    commentsCount: 0,
                    viewsCount: 0
                }
            });
        }

    } catch (error) {
        console.error('Error in /api/instagram/info:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Instagram Reels download endpoint (returns downloadable link)
app.post('/api/instagram/download', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required',
                message: 'Please provide an Instagram URL'
            });
        }

        if (!validateInstagramUrl(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL',
                message: 'Please provide a valid Instagram Reels/Post URL'
            });
        }

        const filename = generateFilename();
        const outputPath = path.join(DOWNLOADS_DIR, `${filename}.%(ext)s`);

        console.log(`Starting Instagram download for: ${url}`);

        // Use yt-dlp method to download the file
        try {
            const result = await downloadInstagramWithYtDlp(url, outputPath);
            
            if (result.success) {
                const filePath = path.join(DOWNLOADS_DIR, result.filename);
                if (fs.existsSync(filePath)) {
                    res.json({
                        success: true,
                        message: 'Instagram content downloaded successfully',
                        title: result.title,
                        filename: result.filename,
                        downloadUrl: `/api/download-file/${result.filename}`,
                        duration: result.duration,
                        uploader: result.uploader,
                        description: result.description
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'File not found',
                        message: 'Downloaded file could not be located'
                    });
                }
            } else {
                res.status(400).json({
                    success: false,
                    error: result.error || 'Download failed',
                    message: result.message || 'Failed to download Instagram content'
                });
            }
        } catch (ytDlpError) {
            console.error('yt-dlp method failed:', ytDlpError.message);
            res.status(500).json({
                success: false,
                error: 'Download failed',
                message: 'Instagram download failed. The content might be private, unavailable, or Instagram is blocking requests.'
            });
        }

    } catch (error) {
        console.error('Error in /api/instagram/download:', error.message);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An internal server error occurred'
        });
    }
});

// Instagram Reels download to file endpoint (like YouTube)
app.post('/api/download-reels', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ 
                error: 'URL is required',
                message: 'Please provide an Instagram URL'
            });
        }

        if (!validateInstagramUrl(url)) {
            return res.status(400).json({ 
                error: 'Invalid URL',
                message: 'Please provide a valid Instagram Reels/Post URL'
            });
        }

        const filename = generateFilename();
        const outputPath = path.join(DOWNLOADS_DIR, `${filename}.%(ext)s`);

        console.log(`Starting Instagram download for: ${url}`);

        // Use yt-dlp method (most reliable for Instagram)
        try {
            const result = await downloadInstagramWithYtDlp(url, outputPath);
            
            if (result.success) {
                const filePath = path.join(DOWNLOADS_DIR, result.filename);
                if (fs.existsSync(filePath)) {
                    res.json({
                        success: true,
                        message: 'Instagram content downloaded successfully',
                        title: result.title,
                        filename: result.filename,
                        downloadUrl: `/api/download-file/${result.filename}`,
                        duration: result.duration,
                        uploader: result.uploader,
                        description: result.description
                    });
                } else {
                    res.status(500).json({
                        error: 'File not found',
                        message: 'Downloaded file could not be located'
                    });
                }
            } else {
                res.status(400).json({
                    error: result.error || 'Download failed',
                    message: result.message || 'Failed to download Instagram content'
                });
            }
        } catch (ytDlpError) {
            console.error('yt-dlp method failed:', ytDlpError.message);
            res.status(500).json({
                error: 'Download failed',
                message: 'Instagram download failed. The content might be private, unavailable, or Instagram is blocking requests.'
            });
        }

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            error: 'Server error',
            message: 'An internal server error occurred'
        });
    }
});

// Instagram batch processing endpoint
app.post('/api/instagram/batch', async (req, res) => {
    try {
        const { urls } = req.body;

        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({
                success: false,
                error: 'URLs array is required'
            });
        }

        if (urls.length > 10) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 10 URLs allowed per batch'
            });
        }

        // Use yt-dlp for batch processing instead of scraping
        const results = await Promise.allSettled(
            urls.map(async (url) => {
                if (!validateInstagramUrl(url)) {
                    throw new Error('Invalid URL');
                }
                
                // Use yt-dlp to extract basic info
                const pythonScript = `
import yt_dlp
import sys
import json
import logging

logging.getLogger('yt_dlp').setLevel(logging.CRITICAL)

def get_info(url):
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            result = {
                'shortcode': url.split('/')[-2] if url.split('/')[-2] else url.split('/')[-3],
                'isVideo': True,
                'videoUrl': info.get('url', ''),
                'thumbnailUrl': info.get('thumbnail', ''),
                'caption': info.get('description', '') or info.get('title', ''),
                'username': info.get('uploader', ''),
                'duration': info.get('duration', 0)
            }
            sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
            sys.stdout.flush()
            
    except Exception as e:
        result = {'error': str(e)}
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.stdout.flush()

get_info("${url}")
`;

                return new Promise((resolve, reject) => {
                    const scriptPath = path.join(__dirname, `temp_batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.py`);
                    fs.writeFileSync(scriptPath, pythonScript);

                    const venvPath = path.join(__dirname, 'venv');
                    const pythonExecutable = process.platform === 'win32' 
                        ? path.join(venvPath, 'Scripts', 'python.exe')
                        : path.join(venvPath, 'bin', 'python');
                    
                    const pythonProcess = spawn(pythonExecutable, [scriptPath]);
                    
                    let output = '';

                    pythonProcess.stdout.on('data', (data) => {
                        output += data.toString();
                    });

                    pythonProcess.on('close', (code) => {
                        if (fs.existsSync(scriptPath)) {
                            fs.unlinkSync(scriptPath);
                        }

                        try {
                            const jsonMatch = output.match(/JSON_START(.+?)JSON_END/);
                            if (jsonMatch && jsonMatch[1]) {
                                const result = JSON.parse(jsonMatch[1]);
                                if (result.error) {
                                    reject(new Error(result.error));
                                } else {
                                    resolve(result);
                                }
                            } else {
                                reject(new Error('Could not parse result'));
                            }
                        } catch (parseError) {
                            reject(new Error('Failed to parse result'));
                        }
                    });
                });
            })
        );

        const processedResults = results.map((result, index) => ({
            url: urls[index],
            success: result.status === 'fulfilled',
            data: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason.message : null
        }));

        res.json({
            success: true,
            results: processedResults
        });

    } catch (error) {
        console.error('Error in /api/instagram/batch:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// File download endpoint
app.get('/api/download-file/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(DOWNLOADS_DIR, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                error: 'File not found',
                message: 'The requested file does not exist or has expired'
            });
        }

        const stats = fs.statSync(filePath);
        const fileSize = stats.size;

        res.setHeader('Content-Length', fileSize);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        fileStream.on('end', () => {
            // Optional: Delete file after download
            setTimeout(() => {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`File deleted after download: ${filename}`);
                }
            }, 5000); // Delete after 5 seconds
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            error: 'Download failed',
            message: 'Could not download the file'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'YouTube Shorts & Instagram Reels Downloader API is running',
        endpoints: {
            youtube: '/api/download-shorts',
            instagram: {
                info: '/api/instagram/info',
                download: '/api/instagram/download', 
                downloadReels: '/api/download-reels',
                batch: '/api/instagram/batch'
            },
            download: '/api/download-file/:filename'
        },
        timestamp: new Date().toISOString()
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`YouTube Shorts & Instagram Reels Downloader API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`Endpoints:`);
    console.log(`  YouTube Shorts: POST http://localhost:${PORT}/api/download-shorts`);
    console.log(`  Instagram Info: POST http://localhost:${PORT}/api/instagram/info`);
    console.log(`  Instagram Download: POST http://localhost:${PORT}/api/instagram/download`);
    console.log(`  Instagram Reels: POST http://localhost:${PORT}/api/download-reels`);
    console.log(`  Instagram Batch: POST http://localhost:${PORT}/api/instagram/batch`);
    console.log(`  File Download: GET http://localhost:${PORT}/api/download-file/:filename`);
});

module.exports = app;