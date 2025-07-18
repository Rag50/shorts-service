const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000; 

// script check

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

        const filename = generateFilename();
        const outputPath = path.join(DOWNLOADS_DIR, `${filename}.%(ext)s`);

        console.log(`Starting download for: ${url}`);

        // Python script with yt-dlp
        const pythonScript = `
import yt_dlp
import sys
import json
import os
import logging

# Disable yt-dlp logging to stdout to prevent JSON parsing issues
logging.getLogger('yt_dlp').setLevel(logging.CRITICAL)

def download_video(url, output_path):
    # User agents to avoid blocking
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ]
    
    ydl_opts = {
        'format': 'best[height<=720]/best',  # Prefer 720p or lower for shorts
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
                'skip': ['dash', 'hls'],
                'player_client': ['android', 'web']
            }
        },
        'cookiesfrombrowser': None,
        'sleep_interval': 1,
        'max_sleep_interval': 5,
        'ignoreerrors': False,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Get video info first
            info = ydl.extract_info(url, download=False)
            title = info.get('title', 'Unknown')
            duration = info.get('duration', 0)
            
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
            for ext in ['mp4', 'webm', 'mkv', 'flv']:
                file_path = f"{base_path}.{ext}"
                if os.path.exists(file_path):
                    result = {
                        'success': True,
                        'title': title,
                        'filename': os.path.basename(file_path),
                        'duration': duration
                    }
                    sys.stdout.write('JSON_START' + json.dumps(result) + 'JSON_END')
                    sys.stdout.flush()
                    sys.exit(0)
            
            result = {
                'error': 'Download failed',
                'message': 'Could not find downloaded file'
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
    if len(sys.argv) != 3:
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
                                res.json({
                                    success: true,
                                    message: 'Video downloaded successfully',
                                    title: result.title,
                                    filename: result.filename,
                                    downloadUrl: `/api/download-file/${result.filename}`,
                                    duration: result.duration
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

        // Set timeout for long-running downloads
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
        }, 60000); // 1 minute timeout

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            error: 'Server error',
            message: 'An internal server error occurred'
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
        message: 'YouTube Shorts Downloader API is running',
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
    console.log(`YouTube Shorts Downloader API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;