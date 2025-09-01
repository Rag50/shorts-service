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

def download_video(url, output_path, quality):
    """Download YouTube video with cookie-free bot evasion"""
    
    # Detect cloud environment
    is_cloud = bool(
        os.environ.get('GOOGLE_CLOUD_PROJECT') or 
        os.environ.get('AWS_REGION') or 
        os.environ.get('NODE_ENV') == 'production' or
        os.environ.get('KUBERNETES_SERVICE_HOST') or
        os.environ.get('HEROKU_APP_NAME')
    )
    
    sys.stderr.write(f"Environment: {'Cloud' if is_cloud else 'Local'} | Cookie-Free Bot Evasion Active\n")
    
    # Add delay for cloud environments to avoid rate limiting
    if is_cloud:
        delay = random.uniform(3, 8)
        sys.stderr.write(f"Cloud detected - waiting {delay:.1f}s to avoid rate limiting...\n")
        time.sleep(delay)
    
    # Try multiple methods in order of reliability
    methods = [
        ('Android Client', try_android_client),
        ('iOS Client', try_ios_client), 
        ('Mobile Web', try_mobile_web),
        ('Minimal Config', try_minimal_config)
    ]
    
    for method_name, method_func in methods:
        try:
            sys.stderr.write(f"Trying {method_name}...\n")
            result = method_func(url, output_path, quality)
            if result:
                sys.stderr.write(f"✅ Success with {method_name}!\n")
                return result
            sys.stderr.write(f"❌ {method_name} failed, trying next method...\n")
            
            # Add delay between methods
            time.sleep(random.uniform(2, 5))
            
        except Exception as e:
            sys.stderr.write(f"❌ {method_name} error: {str(e)[:100]}\n")
            continue
    
    # If all methods fail
    if is_cloud:
        result = {
            'error': 'YouTube Bot Detection',
            'message': 'All cookie-free methods failed. YouTube is blocking your cloud IP. Try: 1) Wait 30-60 minutes, 2) Use a residential proxy, 3) Deploy to a different region.',
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

def try_android_client(url, output_path, quality):
    """Method 1: Android client - most reliable"""
    format_map = {
        "1080": "best[height<=1080]/best",
        "720": "best[height<=720]/best",
        "360": "best[height<=360]/best", 
        "best": "best"
    }
    
    ydl_opts = {
        'format': format_map.get(quality, 'best'),
        'outtmpl': output_path,
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
        'retries': 1,
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info:
            ydl.download([url])
            return check_downloaded_file(output_path, info, 'android', quality)
    return None

def try_ios_client(url, output_path, quality):
    """Method 2: iOS client"""
    format_map = {
        "1080": "best[height<=1080]/best",
        "720": "best[height<=720]/best", 
        "360": "best[height<=360]/best",
        "best": "best"
    }
    
    ydl_opts = {
        'format': format_map.get(quality, 'best'),
        'outtmpl': output_path,
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
        'retries': 1,
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info:
            ydl.download([url])
            return check_downloaded_file(output_path, info, 'ios', quality)
    return None

def try_mobile_web(url, output_path, quality):
    """Method 3: Mobile web browser"""
    mobile_ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    
    format_map = {
        "1080": "best[height<=1080]/best",
        "720": "best[height<=720]/best",
        "360": "best[height<=360]/best",
        "best": "best"
    }
    
    ydl_opts = {
        'format': format_map.get(quality, 'best'),
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
        'user_agent': mobile_ua,
        'http_headers': {
            'User-Agent': mobile_ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
        },
        'socket_timeout': 30,
        'retries': 1,
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info:
            ydl.download([url])
            return check_downloaded_file(output_path, info, 'mobile_web', quality)
    return None

def try_minimal_config(url, output_path, quality):
    """Method 4: Minimal configuration as last resort"""
    ydl_opts = {
        'format': 'best',
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 60,
        'retries': 1,
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info:
            ydl.download([url])
            return check_downloaded_file(output_path, info, 'minimal', quality)
    return None

def check_downloaded_file(output_path, info, method, quality):
    """Check if file was downloaded successfully and return result"""
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
        # Remove the downloaded file since it's too long
        os.remove(downloaded_file)
        result = {
            'error': 'Video too long',
            'message': 'This appears to be a regular video, not a short'
        }
        print('JSON_START' + json.dumps(result) + 'JSON_END')
        sys.exit(1)
    
    # Get actual resolution
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
    
    result = {
        'success': True,
        'title': title,
        'filename': os.path.basename(downloaded_file),
        'duration': duration,
        'quality': actual_quality,
        'requested_quality': quality,
        'method': method,
        'note': f'Downloaded using {method} method (cookie-free bot evasion)'
    }
    
    print('JSON_START' + json.dumps(result) + 'JSON_END')
    sys.exit(0)

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
