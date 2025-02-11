import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const generateHLSPlaylist = (videoPath, outputDir, startTime = 0) => {
    const startProcessTime = Date.now();
    console.log("Starting HLS conversion:", {
        videoPath,
        outputDir,
        startTime,
        startedAt: new Date().toISOString(),
    });

    return new Promise((resolve, reject) => {
        const segmentDuration = 4; // 4 seconds per segment
        const playlistFile = path.join(outputDir, "index.m3u8");
        const segmentPattern = path.join(outputDir, "segment_%03d.ts");
        let currentSegment = 0;
        let segmentStartTime = Date.now();
        let currentStats = {
            fps: 0,
            frames: 0,
            time: "00:00:00",
            bitrate: "0",
            speed: "0",
            q: 0,
        };

        // Ensure the output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log("Creating HLS files in:", outputDir);
        console.log("Segment duration:", segmentDuration, "seconds");

        const hlsPlaylist = spawn("ffmpeg", [
            "-ss",
            String(startTime),
            "-i",
            videoPath,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "28",
            "-vf",
            "scale=-2:720,fps=fps=30",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-hls_time",
            String(segmentDuration),
            "-hls_list_size",
            "0",
            "-hls_segment_filename",
            segmentPattern,
            "-hls_flags",
            "independent_segments+program_date_time",
            "-hls_segment_type",
            "mpegts",
            "-progress",
            "pipe:1",
            "-stats_period",
            "4", // Update stats more frequently
            "-y",
            "-f",
            "hls",
            playlistFile,
        ]);

        // Cleanup function to stop FFmpeg process
        const cleanup = () => {
            if (!hlsPlaylist.killed) {
                hlsPlaylist.kill("SIGINT");
                console.log("FFmpeg process terminated");
                // Clean up stats file
                const statsFile = path.join(outputDir, "vstats.txt");
                if (fs.existsSync(statsFile)) {
                    fs.unlinkSync(statsFile);
                }
            }
        };

        // Listen for process termination events
        process.on("exit", cleanup);
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        // Parse FFmpeg progress output
        hlsPlaylist.stdout.on("data", (data) => {
            const output = data.toString();

            // Parse various FFmpeg stats
            const frameMatch = output.match(/frame=\s*(\d+)/);
            const fpsMatch = output.match(/fps=\s*(\d+)/);
            const qMatch = output.match(/q=\s*([\d.]+)/);
            const timeMatch = output.match(/time=\s*(\d{2}:\d{2}:\d{2}.\d{2})/);
            const bitrateMatch = output.match(/bitrate=\s*([\d.]+\w+)/);
            const speedMatch = output.match(/speed=\s*([\d.]+)x/);

            if (frameMatch) currentStats.frames = parseInt(frameMatch[1]);
            if (fpsMatch) currentStats.fps = parseInt(fpsMatch[1]);
            if (qMatch) currentStats.q = parseFloat(qMatch[1]);
            if (timeMatch) currentStats.time = timeMatch[1];
            if (bitrateMatch) currentStats.bitrate = bitrateMatch[1];
            if (speedMatch) currentStats.speed = parseFloat(speedMatch[1]);

            // Log when a new segment is created
            if (output.includes("segment:")) {
                currentSegment++;
                const segmentFile = path.join(
                    outputDir,
                    `segment_${String(currentSegment).padStart(3, "0")}.ts`
                );

                if (fs.existsSync(segmentFile)) {
                    const segmentStats = fs.statSync(segmentFile);
                    const segmentProcessTime = Date.now() - segmentStartTime;
                    const segmentSizeMB = segmentStats.size / 1024 / 1024;
                    const segmentBitrateMbps =
                        (segmentSizeMB * 8) / segmentDuration;

                    console.log(`Segment ${currentSegment} completed:`, {
                        duration: segmentDuration,
                        size: `${segmentSizeMB.toFixed(2)} MB`,
                        bitrate: `${segmentBitrateMbps.toFixed(2)} Mbps`,
                        processTime: `${segmentProcessTime}ms`,
                        fps: currentStats.fps,
                        frames: currentStats.frames,
                        quality: currentStats.q,
                        speed: `${currentStats.speed}x`,
                        path: segmentFile,
                    });

                    segmentStartTime = Date.now(); // Reset for next segment
                }
            }
        });

        // Log FFmpeg detailed processing information
        hlsPlaylist.stderr.on("data", (data) => {
            const output = data.toString();
            if (output.includes("time=")) {
                console.log("Processing:", {
                    frames: currentStats.frames,
                    fps: currentStats.fps,
                    quality: currentStats.q,
                    time: currentStats.time,
                    bitrate: currentStats.bitrate,
                    speed: `${currentStats.speed}x`,
                });
            }
        });

        hlsPlaylist.on("close", (code) => {
            // Remove process termination listeners
            process.off("exit", cleanup);
            process.off("SIGINT", cleanup);
            process.off("SIGTERM", cleanup);

            const totalProcessTime = Date.now() - startProcessTime;
            const totalSizeMB =
                currentSegment *
                (fs.statSync(path.join(outputDir, `segment_001.ts`)).size /
                    1024 /
                    1024);

            if (code !== 0) {
                console.error("FFmpeg process failed with code:", code);
                reject(new Error(`FFmpeg process exited with code ${code}`));
            } else {
                if (fs.existsSync(playlistFile)) {
                    console.log("HLS conversion completed:", {
                        totalTime: `${totalProcessTime}ms`,
                        segments: currentSegment,
                        totalSize: `${totalSizeMB.toFixed(2)} MB`,
                        averageBitrate: `${(
                            (totalSizeMB * 8) /
                            (currentSegment * segmentDuration)
                        ).toFixed(2)} Mbps`,
                        averageSpeed: `${currentStats.speed}x`,
                        playlistPath: playlistFile,
                    });
                    resolve(playlistFile);
                } else {
                    console.error("Playlist file not found after conversion");
                    reject(new Error("Playlist file not created"));
                }
            }
        });

        hlsPlaylist.on("error", (err) => {
            console.error("FFmpeg process error:", err);
            cleanup();
            reject(err);
        });
    });
};
