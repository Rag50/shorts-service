#!/usr/bin/env python3
"""
YouTube Video Downloader with Quality Options
Usage: python youtube_downloader.py <url> <output_path> <quality>
"""

import yt_dlp
import sys
import json
import os
import logging
import subprocess
import time
import random

# Disable yt-dlp logging to stdout to prevent JSON parsing issues
logging.getLogger('yt_dlp').setLevel(logging.CRITICAL)

def convert_json_to_netscape_cookies(cookie_file):
    """Convert JSON cookies to Netscape format temporary file for yt-dlp"""
    try:
        with open(cookie_file, 'r') as f:
            json_cookies = json.load(f)
        
        # Create temporary cookie file in Netscape format
        temp_cookie_file = cookie_file.replace('.json', '_temp.txt')
        
        with open(temp_cookie_file, 'w') as f:
            f.write("# Netscape HTTP Cookie File\n")
            
            cookie_count = 0
            for cookie in json_cookies:
                domain = cookie.get('domain', '')
                if 'youtube.com' in domain or 'google.com' in domain:
                    flag = 'TRUE' if domain.startswith('.') else 'FALSE'
                    path = cookie.get('path', '/')
                    secure = 'TRUE' if cookie.get('secure', False) else 'FALSE'
                    
                    # Handle expiration
                    expires = cookie.get('expirationDate', 0)
                    if isinstance(expires, float):
                        expires = int(expires)
                    elif expires == 0:
                        expires = int(time.time()) + 365*24*3600  # 1 year from now
                    
                    name = cookie.get('name', '')
                    value = cookie.get('value', '')
                    
                    if name and value:
                        f.write(f"{domain}\t{flag}\t{path}\t{secure}\t{expires}\t{name}\t{value}\n")
                        cookie_count += 1
        
        if cookie_count > 0:
            sys.stderr.write(f"Converted {cookie_count} cookies to Netscape format\n")
            return temp_cookie_file
        else:
            sys.stderr.write("No YouTube/Google cookies found in JSON file\n")
            return None
            
    except Exception as e:
        sys.stderr.write(f"Error converting JSON cookies: {str(e)}\n")
        return None

def try_cookie_free_methods(url, output_path, quality):
    """Try multiple cookie-free methods"""
    
    # Method 1: Android client
    try:
        sys.stderr.write("Trying Android client (cookie-free)...\n")
        base_opts = {
            'quiet': True,
            'no_warnings': True,
            'extractor_args': {
                'youtube': {
                    'player_client': ['android'],
                    'skip': ['webpage']
                }
            },
            'user_agent': 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
            'socket_timeout': 30,
            'retries': 2,
        }
        ydl_opts = get_ydl_opts_for_quality(quality, output_path, base_opts)
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                ydl.download([url])
                return check_downloaded_file(output_path, info, 'android_cookie_free', quality)
    except Exception as e:
        sys.stderr.write(f"Android client failed: {str(e)[:100]}\n")
    
    # Method 2: iOS client
    try:
        sys.stderr.write("Trying iOS client (cookie-free)...\n")
        time.sleep(random.uniform(2, 5))
        
        base_opts = {
            'quiet': True,
            'no_warnings': True,
            'extractor_args': {
                'youtube': {
                    'player_client': ['ios'],
                    'skip': ['webpage']
                }
            },
            'user_agent': 'com.google.ios.youtube/17.31.4 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
            'socket_timeout': 30,
            'retries': 2,
        }
        ydl_opts = get_ydl_opts_for_quality(quality, output_path, base_opts)
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                ydl.download([url])
                return check_downloaded_file(output_path, info, 'ios_cookie_free', quality)
    except Exception as e:
        sys.stderr.write(f"iOS client failed: {str(e)[:100]}\n")
    
    return None

def try_cookie_methods(url, output_path, quality, cookie_file):
    """Try methods with cookies using proper cookie file"""
    
    # Method 1: Simple approach with cookies
    try:
        sys.stderr.write("Trying with cookies (flexible format)...\n")
        base_opts = {
            'quiet': True,
            'no_warnings': True,
            'cookiefile': cookie_file,
            'socket_timeout': 60,
            'retries': 3,
        }
        ydl_opts = get_ydl_opts_for_quality(quality, output_path, base_opts)
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                ydl.download([url])
                return check_downloaded_file(output_path, info, 'cookies_simple', quality)
    except Exception as e:
        sys.stderr.write(f"Simple cookie method failed: {str(e)[:100]}\n")
    
    # Method 2: Android client with cookies
    try:
        sys.stderr.write("Trying Android client with cookies...\n")
        time.sleep(random.uniform(2, 5))
        
        base_opts = {
            'quiet': True,
            'no_warnings': True,
            'cookiefile': cookie_file,
            'extractor_args': {
                'youtube': {
                    'player_client': ['android'],
                    'skip': ['webpage']
                }
            },
            'user_agent': 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
            'socket_timeout': 60,
            'retries': 3,
        }
        ydl_opts = get_ydl_opts_for_quality(quality, output_path, base_opts)
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                ydl.download([url])
                return check_downloaded_file(output_path, info, 'android_with_cookies', quality)
    except Exception as e:
        sys.stderr.write(f"Android client with cookies failed: {str(e)[:100]}\n")
    
    # Method 3: Fallback with best available format
    try:
        sys.stderr.write("Trying fallback with best available format...\n")
        time.sleep(random.uniform(3, 7))
        
        ydl_opts = {
            'format': 'best',
            'outtmpl': output_path,
            'quiet': True,
            'no_warnings': True,
            'cookiefile': cookie_file,
            'socket_timeout': 90,
            'retries': 2,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info:
                ydl.download([url])
                return check_downloaded_file(output_path, info, 'cookies_fallback', quality)
    except Exception as e:
        sys.stderr.write(f"Cookie fallback failed: {str(e)[:100]}\n")
    
    return None

def get_ydl_opts_for_quality(quality, output_path, base_opts=None):
    """Get yt-dlp options with proper quality format selection"""
    if base_opts is None:
        base_opts = {}
    
    # Set format based on quality parameter with fallbacks for better compatibility
    if quality == "1080":
        opts = {
            "format": "bestvideo[height<=1080]+bestaudio/best/best[height<=1080]/best",
            "merge_output_format": "mp4",
            "outtmpl": output_path,
        }
    elif quality == "720":
        opts = {
            "format": "bestvideo[height<=720]+bestaudio/best/best[height<=720]/best",
            "merge_output_format": "mp4", 
            "outtmpl": output_path,
        }
    elif quality == "360":
        opts = {
            "format": "bestvideo[height<=360]+bestaudio/best/best[height<=360]/best",
            "merge_output_format": "mp4",
            "outtmpl": output_path,
        }
    else:  # 'best' or any other value
        opts = {
            "format": "bestvideo+bestaudio/best",
            "merge_output_format": "mp4",
            "outtmpl": output_path,
        }
    
    # Merge with base options
    opts.update(base_opts)
    return opts

def check_downloaded_file(output_path, info, method, quality):
    """Check if file was downloaded and return result"""
    base_path = output_path.replace('.%(ext)s', '')
    downloaded_file = None
    
    for ext in ['mp4', 'webm', 'mkv', 'flv']:
        file_path = f"{base_path}.{ext}"
        if os.path.exists(file_path):
            downloaded_file = file_path
            break
    
    if not downloaded_file:
        return None
    
    title = info.get('title', 'Unknown')
    duration = info.get('duration', 0)
    
    # Check if it's a short video
    if duration and duration > 180:  # 3 minutes
        os.remove(downloaded_file)
        result = {
            'error': 'Video too long',
            'message': 'This appears to be a regular video, not a short'
        }
        print('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.exit(1)
    
    # Get actual quality
    actual_quality = 'unknown'
    try:
        probe_cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', downloaded_file]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
        
        if probe_result.returncode == 0:
            probe_data = json.loads(probe_result.stdout)
            video_stream = next((s for s in probe_data['streams'] if s['codec_type'] == 'video'), None)
            if video_stream:
                actual_height = int(video_stream.get('height', 0))
                actual_quality = f"{actual_height}p"
    except:
        pass
    
    # Get available formats info like your original version
    formats = info.get('formats', [])
    video_formats = [f for f in formats if f.get('vcodec') != 'none']
    available_heights = sorted(list(set([f.get('height') for f in video_formats if f.get('height')])), reverse=True)
    highest_quality = available_heights[0] if available_heights else 'unknown'
    
    result = {
        'success': True,
        'title': title,
        'filename': os.path.basename(downloaded_file),
        'duration': duration,
        'quality': actual_quality,
        'requested_quality': quality,
        'available_quality': f"{highest_quality}p" if highest_quality != 'unknown' else 'unknown',
        'available_heights': available_heights,
        'method': method,
        'note': f'Downloaded using {method}'
    }
    
    print('JSON_START' + json.dumps(result) + 'JSON_END')
    sys.exit(0)

def download_video(url, output_path, quality):
    """Download YouTube video with cookie-free methods and cookie fallback"""
    
    # Detect cloud environment
    is_cloud = bool(
        os.environ.get('GOOGLE_CLOUD_PROJECT') or 
        os.environ.get('AWS_REGION') or 
        os.environ.get('NODE_ENV') == 'production' or
        os.environ.get('KUBERNETES_SERVICE_HOST') or
        os.environ.get('HEROKU_APP_NAME')
    )
    
    sys.stderr.write(f"Environment: {'Cloud' if is_cloud else 'Local'} | Bot Evasion Active\n")
    
    # Add delay for cloud environments
    if is_cloud:
        delay = random.uniform(3, 8)
        sys.stderr.write(f"Cloud detected - waiting {delay:.1f}s to avoid rate limiting...\n")
        time.sleep(delay)
    
    # Force cookie method - skip cookie-free attempts
    sys.stderr.write("=== FORCING COOKIE METHOD ===\n")
    
    # Check for cookie file
    cookie_file = os.environ.get('YOUTUBE_COOKIES_FILE')
    if not cookie_file:
        # Try default cookie.json in current directory
        if os.path.exists('cookie.json'):
            cookie_file = 'cookie.json'
    
    if cookie_file and os.path.exists(cookie_file):
        sys.stderr.write(f"Using cookie file: {cookie_file}\n")
        
        # Convert JSON cookies to Netscape format if needed
        if cookie_file.endswith('.json'):
            netscape_cookie_file = convert_json_to_netscape_cookies(cookie_file)
            if netscape_cookie_file:
                result = try_cookie_methods(url, output_path, quality, netscape_cookie_file)
                if result:
                    sys.stderr.write("✅ Cookie method succeeded!\n")
                    # Clean up temp cookie file
                    try:
                        os.remove(netscape_cookie_file)
                    except:
                        pass
                    return result
                # Clean up temp cookie file even if failed
                try:
                    os.remove(netscape_cookie_file)
                except:
                    pass
            else:
                sys.stderr.write("Failed to convert JSON cookies\n")
        else:
            # Use cookie file directly (already in Netscape format)
            result = try_cookie_methods(url, output_path, quality, cookie_file)
            if result:
                sys.stderr.write("✅ Cookie method succeeded!\n")
                return result
    else:
        sys.stderr.write("No cookie file found. Set YOUTUBE_COOKIES_FILE environment variable or place cookie.json in current directory\n")
    
    # If all methods fail
    if is_cloud:
                result = {
            'error': 'YouTube Bot Detection',
            'message': 'All methods failed. YouTube is blocking your cloud IP. Solutions: 1) Wait 30-60 minutes, 2) Try fresh cookies from a different Google account, 3) Use a residential proxy, 4) Deploy to a different region.',
            'environment': 'cloud'
                }
    else:
        result = {
            'error': 'YouTube Bot Detection',
            'message': 'All methods failed. YouTube may be temporarily blocking your IP. Wait 10-30 minutes and try again.',
            'environment': 'local'
        }
    
        print('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.exit(1)

def main():
    if len(sys.argv) < 4:
        result = {
            'error': 'Invalid arguments',
            'message': 'Usage: python youtube_downloader.py <url> <output_path> <quality>'
        }
        print('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.exit(1)
    
    url = sys.argv[1]
    output_path = sys.argv[2]
    quality = sys.argv[3]
    
    # Validate quality parameter
    valid_qualities = ['best', '1080', '720', '360']
    if quality not in valid_qualities:
        result = {
            'error': 'Invalid quality',
            'message': f'Quality must be one of: {", ".join(valid_qualities)}'
        }
        print('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.exit(1)
    
    download_video(url, output_path, quality)

if __name__ == "__main__":
    main()
