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
import time
import random

# Disable yt-dlp logging to stdout
logging.getLogger('yt_dlp').setLevel(logging.CRITICAL)

def download_instagram_content(url, output_path):
    # Enhanced cloud environment detection
    is_cloud = bool(
        os.environ.get('GOOGLE_CLOUD_PROJECT') or 
        os.environ.get('AWS_REGION') or 
        os.environ.get('CLOUD_PROVIDER') or
        os.environ.get('NODE_ENV') == 'production' or
        os.environ.get('KUBERNETES_SERVICE_HOST') or  # Kubernetes
        os.environ.get('HEROKU_APP_NAME') or         # Heroku
        os.environ.get('AZURE_FUNCTIONS_ENVIRONMENT') # Azure
    )
    
    # Check if we're running on a known cloud IP range (basic detection)
    try:
        import socket
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        # Common cloud IP patterns (basic check)
        cloud_patterns = ['10.', '172.', '192.168.']
        is_likely_cloud = not any(local_ip.startswith(pattern) for pattern in cloud_patterns)
        if is_likely_cloud:
            is_cloud = True
    except:
        pass
    
    sys.stderr.write(f"Environment: {'Cloud/Datacenter' if is_cloud else 'Local'} | URL: {url[:50]}...\\n")
    
    # Enhanced user agents with more variety for cloud environments
    mobile_user_agents = [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Android 13; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0',
        'Mozilla/5.0 (Android 12; Mobile; rv:91.0) Gecko/91.0 Firefox/91.0',
        'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
        'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 11; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36'
    ]
    
    desktop_user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/119.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    ]
    
    # Use broader range of user agents for cloud environments
    user_agents = mobile_user_agents + desktop_user_agents if is_cloud else mobile_user_agents[:5]
    selected_ua = random.choice(user_agents)
    
    # Increased delays for cloud environments
    delay_range = (5, 15) if is_cloud else (2, 8)
    delay = random.uniform(*delay_range)
    sys.stderr.write(f"Waiting {delay:.1f} seconds before request...\\n")
    time.sleep(delay)
    
    # Base configuration
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'outtmpl': output_path,
        'noplaylist': True,
        'extract_flat': False,
        'writethumbnail': False,
        'writeinfojson': False,
        'quiet': True,
        'no_warnings': True,
        'user_agent': selected_ua,
        'socket_timeout': 120 if is_cloud else 60,
        'retries': 8 if is_cloud else 5,
        'sleep_interval': 5 if is_cloud else 2,
        'max_sleep_interval': 20 if is_cloud else 8,
        'http_headers': {
            'User-Agent': selected_ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9,es;q=0.8,pt;q=0.7,fr;q=0.6',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?1' if 'Mobile' in selected_ua else '?0',
            'Sec-Ch-Ua-Platform': '"Android"' if 'Android' in selected_ua else '"iOS"' if 'iPhone' in selected_ua or 'iPad' in selected_ua else '"Windows"',
        },
        'ignoreerrors': False,
    }
    
    # Add proxy support if configured (useful for cloud environments)
    proxy_url = os.environ.get('INSTAGRAM_PROXY_URL')
    if proxy_url:
        sys.stderr.write(f"Using proxy: {proxy_url.split('@')[-1] if '@' in proxy_url else proxy_url}\\n")
        ydl_opts['proxy'] = proxy_url
    
    # Additional settings for better compatibility
    ydl_opts.update({
        'merge_output_format': 'mp4',
        'prefer_ffmpeg': True,
        'extractor_args': {
            'instagram': {
                'api_token': None,
                'include_onion_networks': False,
            }
        },
    })
    
    try:
        # Method 1: Try with enhanced yt-dlp settings
        sys.stderr.write("Attempting Method 1: Enhanced yt-dlp with cloud-optimized settings...\\n")
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Get video info first with retry mechanism
            max_retries = 5
            info = None
            
            for attempt in range(max_retries):
                try:
                    sys.stderr.write(f"Info extraction attempt {attempt + 1}/{max_retries}...\\n")
                    info = ydl.extract_info(url, download=False)
                    sys.stderr.write("Successfully extracted video info\\n")
                    break
                except Exception as e:
                    error_msg = str(e).lower()
                    sys.stderr.write(f"Attempt {attempt + 1} failed: {str(e)}\\n")
                    
                    # If it's a specific error that won't resolve with retries, break early
                    if 'private' in error_msg or 'not available' in error_msg or 'does not exist' in error_msg:
                        if attempt >= 1:  # Try at least twice for these errors
                            raise e
                    
                    if attempt < max_retries - 1:
                        retry_delay = random.uniform(5, 15)  # Longer delays for cloud
                        sys.stderr.write(f"Waiting {retry_delay:.1f} seconds before retry...\\n")
                        time.sleep(retry_delay)
                    else:
                        # Try Method 2 if all attempts fail
                        raise e
            
            if not info:
                raise Exception("Failed to extract video information after multiple attempts")
            
            title = info.get('title', 'Instagram Content')
            duration = info.get('duration', 0)
            uploader = info.get('uploader', 'Unknown')
            description = info.get('description', '')
            
            sys.stderr.write(f"Successfully extracted info for: {title}\\n")
            
            # Download the content with retry mechanism
            for attempt in range(max_retries):
                try:
                    sys.stderr.write(f"Download attempt {attempt + 1}/{max_retries}...\\n")
                    ydl.download([url])
                    sys.stderr.write("Download completed successfully\\n")
                    break
                except Exception as e:
                    sys.stderr.write(f"Download attempt {attempt + 1} failed: {str(e)}\\n")
                    if attempt < max_retries - 1:
                        retry_delay = random.uniform(8, 20)
                        sys.stderr.write(f"Waiting {retry_delay:.1f} seconds before retry...\\n")
                        time.sleep(retry_delay)
                    else:
                        raise e
        
    except Exception as method1_error:
        sys.stderr.write(f"Method 1 failed: {str(method1_error)}\\n")
        
        # Method 2: Try with different extractor settings
        sys.stderr.write("Attempting Method 2: Alternative extractor settings...\\n")
        
        try:
            # Wait before trying alternative method
            time.sleep(random.uniform(10, 20))
            
            alt_ydl_opts = ydl_opts.copy()
            alt_ydl_opts.update({
                'extractor_args': {
                    'instagram': {
                        'api_token': None,
                        'include_onion_networks': True,
                    }
                },
                'socket_timeout': 120,
                'retries': 8,
                'sleep_interval': 5,
                'max_sleep_interval': 20,
            })
            
            with yt_dlp.YoutubeDL(alt_ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                title = info.get('title', 'Instagram Content')
                duration = info.get('duration', 0)
                uploader = info.get('uploader', 'Unknown')
                description = info.get('description', '')
                
                ydl.download([url])
                
        except Exception as method2_error:
            sys.stderr.write(f"Method 2 failed: {str(method2_error)}\\n")
            
            # Method 3: Try with minimal settings (last resort)
            sys.stderr.write("Attempting Method 3: Minimal settings (last resort)...\\n")
            
            try:
                time.sleep(random.uniform(15, 30))
                
                minimal_opts = {
                    'format': 'best',
                    'outtmpl': output_path,
                    'quiet': True,
                    'no_warnings': True,
                    'socket_timeout': 180,
                    'retries': 10,
                    'sleep_interval': 10,
                    'max_sleep_interval': 30,
                }
                
                with yt_dlp.YoutubeDL(minimal_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    title = info.get('title', 'Instagram Content')
                    duration = info.get('duration', 0)
                    uploader = info.get('uploader', 'Unknown')
                    description = info.get('description', '')
                    
                    ydl.download([url])
                    
            except Exception as method3_error:
                sys.stderr.write(f"All methods failed. Last error: {str(method3_error)}\\n")
                
                # Check for specific Instagram blocking patterns
                error_msg = str(method1_error).lower()
                if any(phrase in error_msg for phrase in ['not available', 'private', 'removed', 'restricted']):
                    if is_cloud:
                        raise Exception(f"Instagram content blocked: {str(method1_error)}. This is likely due to Instagram blocking datacenter/cloud IPs. Solutions: 1) Use a residential proxy service (ProxyMesh, Bright Data, etc.), 2) Deploy on a different cloud region, 3) Use a VPN service with residential IPs. Error: {str(method1_error)}")
                    else:
                        raise Exception(f"Instagram content not available: {str(method1_error)}. The content may be private, deleted, or restricted.")
                elif 'login' in error_msg or 'authentication' in error_msg:
                    raise Exception(f"Instagram authentication required. Instagram is requesting login for this content. This often happens with cloud IPs. Try using a proxy or VPN service.")
                elif 'rate limit' in error_msg or 'too many requests' in error_msg:
                    raise Exception(f"Instagram rate limiting detected. Wait 30-60 minutes before trying again. If you're on a cloud platform, consider using proxy rotation.")
                else:
                    # For cloud environments, provide specific guidance
                    if is_cloud:
                        raise Exception(f"All download methods failed. Cloud platform detected - Instagram often blocks datacenter IPs. Solutions: 1) Set INSTAGRAM_PROXY_URL environment variable with a residential proxy, 2) Use a different cloud region, 3) Deploy to a platform with residential IPs. Error: {str(method3_error)}")
                    else:
                        raise Exception(f"All download methods failed. Error details: {str(method3_error)}. Try again later as Instagram may be temporarily blocking requests.")
    
    # Find the downloaded file (this part remains the same for all methods)
            base_path = output_path.replace('.%(ext)s', '')
            downloaded_file = None
            
            for ext in ['mp4', 'webm', 'mkv', 'mov', 'avi']:
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
        error_msg = str(e).lower()
        sys.stderr.write(f"Error occurred: {str(e)}\\n")
        
        if 'private' in error_msg or 'this account is private' in error_msg:
            result = {
                'error': 'Private content',
                'message': 'This Instagram content is private and cannot be downloaded'
            }
        elif 'not available' in error_msg or 'video unavailable' in error_msg or 'does not exist' in error_msg:
            result = {
                'error': 'Content not available',
                'message': 'This Instagram content is not available or has been removed'
            }
        elif 'login' in error_msg or 'authentication' in error_msg or 'sign up' in error_msg:
            result = {
                'error': 'Authentication required',
                'message': 'Instagram is requiring login to access this content. Try again later.'
            }
        elif 'rate limit' in error_msg or 'too many requests' in error_msg:
            result = {
                'error': 'Rate limited',
                'message': 'Instagram is rate limiting requests. Please wait and try again later.'
            }
        elif 'blocked' in error_msg or 'forbidden' in error_msg:
            result = {
                'error': 'Access blocked',
                'message': 'Instagram has blocked access to this content. This may be temporary.'
            }
        elif 'network' in error_msg or 'connection' in error_msg or 'timeout' in error_msg:
            result = {
                'error': 'Network error',
                'message': 'Network connection failed. Please check your internet connection and try again.'
            }
        else:
            result = {
                'error': 'Download failed',
                'message': f'Failed to download Instagram content. Instagram may be blocking automated downloads. Error: {str(e)[:100]}'
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

// Alternative Instagram download method using gallery-dl as fallback
const downloadInstagramWithGalleryDl = async (url, outputPath) => {
    return new Promise((resolve, reject) => {
        const pythonScript = `
import subprocess
import sys
import json
import os
import logging

def download_with_gallery_dl(url, output_path):
    try:
        # Try using gallery-dl as an alternative
        gallery_dl_cmd = [
            'gallery-dl',
            '--write-info-json',
            '--no-part',
            '--output', output_path.replace('.%(ext)s', '.%(ext)s'),
            url
        ]
        
        result = subprocess.run(gallery_dl_cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            # Look for downloaded files
            base_path = output_path.replace('.%(ext)s', '')
            for ext in ['mp4', 'webm', 'mkv', 'mov']:
                file_path = f"{base_path}.{ext}"
                if os.path.exists(file_path):
                    response = {
                        'success': True,
                        'title': 'Instagram Content',
                        'filename': os.path.basename(file_path),
                        'duration': 0,
                        'uploader': 'Unknown',
                        'description': 'Downloaded via alternative method'
                    }
                    sys.stdout.write('JSON_START' + json.dumps(response) + 'JSON_END')
                    sys.stdout.flush()
                    return
            
        # If gallery-dl fails, return error
        response = {
            'error': 'Alternative download failed',
            'message': 'Both yt-dlp and gallery-dl methods failed. Instagram may be blocking downloads.'
        }
        sys.stdout.write('JSON_START' + json.dumps(response) + 'JSON_END')
        sys.stdout.flush()
        
    except Exception as e:
        response = {
            'error': 'Alternative download failed',
            'message': f'Alternative download method failed: {str(e)}'
        }
        sys.stdout.write('JSON_START' + json.dumps(response) + 'JSON_END')
        sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        response = {
            'error': 'Invalid arguments',
            'message': 'Usage: python script.py <url> <output_path>'
        }
        sys.stdout.write('JSON_START' + json.dumps(response) + 'JSON_END')
        sys.stdout.flush()
        sys.exit(1)
    
    url = sys.argv[1]
    output_path = sys.argv[2]
    download_with_gallery_dl(url, output_path)
`;

        // Write Python script to temporary file
        const scriptPath = path.join(__dirname, 'temp_alternative_downloader.py');
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

            try {
                const jsonMatch = output.match(/JSON_START(.+?)JSON_END/);
                if (jsonMatch && jsonMatch[1]) {
                    const result = JSON.parse(jsonMatch[1]);
                    if (result.success) {
                        resolve(result);
                    } else {
                        reject(new Error(result.message || result.error));
                    }
                } else {
                    reject(new Error('Could not parse alternative download result'));
                }
            } catch (parseError) {
                reject(new Error('Failed to parse alternative download result'));
            }
        });
    });
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
            
            // Provide specific error messages based on the error
            let errorMessage = 'Instagram download failed. ';
            let errorType = 'Download failed';
            
            if (ytDlpError.message.includes('private') || ytDlpError.message.includes('Private')) {
                errorMessage += 'This content is private and cannot be downloaded.';
                errorType = 'Private content';
            } else if (ytDlpError.message.includes('not available') || ytDlpError.message.includes('unavailable')) {
                errorMessage += 'This content is not available or has been removed.';
                errorType = 'Content not available';
            } else if (ytDlpError.message.includes('login') || ytDlpError.message.includes('authentication')) {
                errorMessage += 'Instagram is requiring login to access this content. This is a temporary restriction.';
                errorType = 'Authentication required';
            } else if (ytDlpError.message.includes('rate limit') || ytDlpError.message.includes('too many requests')) {
                errorMessage += 'Instagram is rate limiting requests. Please wait a few minutes and try again.';
                errorType = 'Rate limited';
            } else if (ytDlpError.message.includes('blocked') || ytDlpError.message.includes('forbidden')) {
                errorMessage += 'Instagram has temporarily blocked access. This usually resolves within a few hours.';
                errorType = 'Access blocked';
            } else {
                errorMessage += 'Instagram may be blocking automated downloads or the content may be restricted.';
            }
            
            res.status(500).json({
                success: false,
                error: errorType,
                message: errorMessage,
                suggestion: 'Try again later or use a different Instagram URL. Instagram frequently updates their anti-bot measures.'
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
            
            // Provide specific error messages based on the error
            let errorMessage = 'Instagram download failed. ';
            let errorType = 'Download failed';
            
            if (ytDlpError.message.includes('private') || ytDlpError.message.includes('Private')) {
                errorMessage += 'This content is private and cannot be downloaded.';
                errorType = 'Private content';
            } else if (ytDlpError.message.includes('not available') || ytDlpError.message.includes('unavailable')) {
                errorMessage += 'This content is not available or has been removed.';
                errorType = 'Content not available';
            } else if (ytDlpError.message.includes('login') || ytDlpError.message.includes('authentication')) {
                errorMessage += 'Instagram is requiring login to access this content. This is a temporary restriction.';
                errorType = 'Authentication required';
            } else if (ytDlpError.message.includes('rate limit') || ytDlpError.message.includes('too many requests')) {
                errorMessage += 'Instagram is rate limiting requests. Please wait a few minutes and try again.';
                errorType = 'Rate limited';
            } else if (ytDlpError.message.includes('blocked') || ytDlpError.message.includes('forbidden')) {
                errorMessage += 'Instagram has temporarily blocked access. This usually resolves within a few hours.';
                errorType = 'Access blocked';
            } else {
                errorMessage += 'Instagram may be blocking automated downloads or the content may be restricted.';
            }
            
            res.status(500).json({
                error: errorType,
                message: errorMessage,
                suggestion: 'Try again later or use a different Instagram URL. Instagram frequently updates their anti-bot measures.'
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
    // Enhanced health check with environment detection
    const isCloud = !!(
        process.env.GOOGLE_CLOUD_PROJECT || 
        process.env.AWS_REGION || 
        process.env.CLOUD_PROVIDER ||
        process.env.NODE_ENV === 'production' ||
        process.env.KUBERNETES_SERVICE_HOST ||
        process.env.HEROKU_APP_NAME ||
        process.env.AZURE_FUNCTIONS_ENVIRONMENT
    );
    
    const proxyConfigured = !!process.env.INSTAGRAM_PROXY_URL;
    
    res.json({ 
        status: 'OK', 
        message: 'YouTube Shorts & Instagram Reels Downloader API is running',
        environment: isCloud ? 'cloud/datacenter' : 'local',
        proxy_configured: proxyConfigured,
        node_env: process.env.NODE_ENV || 'development',
        cloud_info: {
            gcp: !!process.env.GOOGLE_CLOUD_PROJECT,
            aws: !!process.env.AWS_REGION,
            azure: !!process.env.AZURE_FUNCTIONS_ENVIRONMENT,
            heroku: !!process.env.HEROKU_APP_NAME,
            kubernetes: !!process.env.KUBERNETES_SERVICE_HOST
        },
        endpoints: {
            youtube: '/api/download-shorts',
            instagram: {
                info: '/api/instagram/info',
                download: '/api/instagram/download', 
                downloadReels: '/api/download-reels',
                batch: '/api/instagram/batch',
                test: '/api/test/instagram'
            },
            download: '/api/download-file/:filename'
        },
        timestamp: new Date().toISOString()
    });
});

// Test Instagram connectivity endpoint
app.post('/api/test/instagram', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required for testing'
            });
        }
        
        if (!validateInstagramUrl(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Instagram URL'
            });
        }
        
        // Basic connectivity test without downloading
        const testScript = `
import requests
import sys
import json
import os

def test_instagram_access(url):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    is_cloud = bool(
        os.environ.get('GOOGLE_CLOUD_PROJECT') or 
        os.environ.get('AWS_REGION') or 
        os.environ.get('NODE_ENV') == 'production'
    )
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        
        result = {
            'success': True,
            'status_code': response.status_code,
            'accessible': response.status_code == 200,
            'environment': 'cloud' if is_cloud else 'local',
            'response_size': len(response.content),
            'headers_received': dict(response.headers),
            'proxy_configured': bool(os.environ.get('INSTAGRAM_PROXY_URL')),
            'message': 'Instagram page accessible' if response.status_code == 200 else f'Instagram returned status {response.status_code}'
        }
        
        if response.status_code != 200:
            result['warning'] = 'Non-200 status code may indicate blocking or content issues'
            
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        
    except requests.exceptions.Timeout:
        result = {
            'success': False,
            'error': 'Timeout',
            'message': 'Request to Instagram timed out',
            'environment': 'cloud' if is_cloud else 'local',
            'suggestion': 'Instagram may be blocking requests from your IP'
        }
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        
    except requests.exceptions.ConnectionError:
        result = {
            'success': False,
            'error': 'Connection Error',
            'message': 'Could not connect to Instagram',
            'environment': 'cloud' if is_cloud else 'local',
            'suggestion': 'Check internet connection or firewall settings'
        }
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
        
    except Exception as e:
        result = {
            'success': False,
            'error': 'Request Failed',
            'message': str(e),
            'environment': 'cloud' if is_cloud else 'local'
        }
        sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.instagram.com"
    test_instagram_access(url)
`;
        
        const filename = generateFilename();
        const scriptPath = path.join(__dirname, `temp_test_${filename}.py`);
        fs.writeFileSync(scriptPath, testScript);
        
        const venvPath = path.join(__dirname, 'venv');
        const pythonExecutable = process.platform === 'win32' 
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python');
        
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
            // Clean up
            if (fs.existsSync(scriptPath)) {
                fs.unlinkSync(scriptPath);
            }
            
            try {
                const jsonMatch = output.match(/JSON_START(.+?)JSON_END/);
                if (jsonMatch && jsonMatch[1]) {
                    const result = JSON.parse(jsonMatch[1]);
                    res.json(result);
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Test failed',
                        message: 'Could not parse test result',
                        debug: { output, errorOutput }
                    });
                }
            } catch (parseError) {
                res.status(500).json({
                    success: false,
                    error: 'Parse error',
                    message: 'Could not parse test result',
                    debug: { output, errorOutput }
                });
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: error.message
        });
    }
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