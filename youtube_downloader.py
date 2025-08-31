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

# Disable yt-dlp logging to stdout to prevent JSON parsing issues
logging.getLogger('yt_dlp').setLevel(logging.CRITICAL)

def download_video(url, output_path, quality):
    """Download YouTube video with specified quality"""
    
    # User agents to avoid blocking
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
    
    # Set ydl_opts based on quality parameter - using proven approach
    if quality == "1080":
        ydl_opts = {
            "format": "bestvideo[height<=1080]+bestaudio/best",
            "merge_output_format": "mp4",
            "outtmpl": output_path,
        }
    elif quality == "720":
        ydl_opts = {
            "format": "bestvideo[height<=720]+bestaudio/best",
            "merge_output_format": "mp4",
            "outtmpl": output_path,
        }
    elif quality == "360":
        ydl_opts = {
            "format": "bestvideo[height<=360]+bestaudio/best",
            "merge_output_format": "mp4",
            "outtmpl": output_path,
        }
    else:  # 'best' or any other value
        ydl_opts = {
            "format": "bestvideo+bestaudio/best",
            "merge_output_format": "mp4",
            "outtmpl": output_path,
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
            available_heights = sorted(list(set([f.get('height') for f in video_formats if f.get('height')])), reverse=True)
            highest_quality = available_heights[0] if available_heights else 'unknown'
            
            # Log detailed format information
            sys.stderr.write(f"\n=== FORMAT DEBUG INFO ===\n")
            sys.stderr.write(f"Title: {title}\n")
            sys.stderr.write(f"Duration: {duration} seconds\n")
            sys.stderr.write(f"Total formats available: {len(formats)}\n")
            sys.stderr.write(f"Video formats available: {len(video_formats)}\n")
            sys.stderr.write(f"Available video heights: {available_heights}\n")
            sys.stderr.write(f"Highest available quality: {highest_quality}p\n")
            sys.stderr.write(f"Requested quality: {quality}\n")
            sys.stderr.write(f"Format string: {ydl_opts['format']}\n")
            
            # Show all available video formats
            sys.stderr.write("\nAll available video formats:\n")
            for fmt in video_formats:
                height = fmt.get('height', 'unknown')
                width = fmt.get('width', 'unknown')
                ext = fmt.get('ext', 'unknown')
                format_id = fmt.get('format_id', 'unknown')
                vcodec = fmt.get('vcodec', 'unknown')
                filesize = fmt.get('filesize', 'unknown')
                fps = fmt.get('fps', 'unknown')
                tbr = fmt.get('tbr', 'unknown')
                sys.stderr.write(f"  ID: {format_id}, Resolution: {width}x{height}, FPS: {fps}, Bitrate: {tbr}, Ext: {ext}, Codec: {vcodec}, Size: {filesize}\n")
            
            # Show what format will be selected
            sys.stderr.write(f"\nTrying format selection with: {ydl_opts['format']}\n")
            
            sys.stderr.write("========================\n\n")
            sys.stderr.flush()
            
            # Check if it's a short video (typically under 60 seconds)
            if duration and duration > 180:  # 3 minutes
                result = {
                    'error': 'Video too long',
                    'message': 'This appears to be a regular video, not a short'
                }
                print('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.exit(1)
            
            # Download the video - simple approach like the reference code
            sys.stderr.write("Starting download...\n")
            ydl.download([url])
            sys.stderr.write("Download completed\n")
            
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
                print('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.exit(1)
            
            # Get actual resolution of downloaded file
            actual_quality = 'unknown'
            try:
                probe_cmd = [
                    'ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', downloaded_file
                ]
                probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
                
                if probe_result.returncode == 0:
                    probe_data = json.loads(probe_result.stdout)
                    video_stream = next((s for s in probe_data['streams'] if s['codec_type'] == 'video'), None)
                    
                    if video_stream:
                        actual_height = int(video_stream.get('height', 0))
                        actual_width = int(video_stream.get('width', 0))
                        actual_quality = f"{actual_height}p"
                        sys.stderr.write(f"Downloaded resolution: {actual_width}x{actual_height}\n")
                    else:
                        actual_quality = f"{highest_quality}p" if highest_quality != 'unknown' else 'unknown'
                else:
                    actual_quality = f"{highest_quality}p" if highest_quality != 'unknown' else 'unknown'
            except Exception as e:
                sys.stderr.write(f"Could not probe video resolution: {str(e)}\n")
                actual_quality = f"{highest_quality}p" if highest_quality != 'unknown' else 'unknown'
            
            if os.path.exists(downloaded_file):
                result = {
                    'success': True,
                    'title': title,
                    'filename': os.path.basename(downloaded_file),
                    'duration': duration,
                    'quality': actual_quality,
                    'requested_quality': quality,
                    'available_quality': f"{highest_quality}p" if highest_quality != 'unknown' else 'unknown',
                    'available_heights': available_heights
                }
                print('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.exit(0)
            else:
                result = {
                    'error': 'Processing failed',
                    'message': 'Could not process downloaded file'
                }
                print('JSON_START' + json.dumps(result) + 'JSON_END')
                sys.exit(1)
            
    except Exception as e:
        result = {
            'error': 'Download failed',
            'message': str(e)
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
