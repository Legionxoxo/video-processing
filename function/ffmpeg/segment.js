import { exec } from "child_process";
import fs from "fs";
import path from "path";

const getVideoInfo = (inputPath) => {
    return new Promise((resolve, reject) => {
        const ffprobeCommand = `ffprobe -v quiet -print_format json -show_format -show_streams ${inputPath}`;

        exec(ffprobeCommand, (error, stdout) => {
            if (error) {
                console.error("Error getting video info:", error);
                reject(error);
                return;
            }

            const info = JSON.parse(stdout);
            const videoStream = info.streams.find(
                (stream) => stream.codec_type === "video"
            );
            const audioStream = info.streams.find(
                (stream) => stream.codec_type === "audio"
            );

            const videoInfo = {
                filename: path.basename(inputPath),
                width: parseInt(videoStream.width),
                height: parseInt(videoStream.height),
                bitrate: parseInt(info.format.bit_rate),
                duration: parseFloat(info.format.duration),
                size: parseInt(info.format.size),
                codec: videoStream.codec_name,
                fps: eval(videoStream.r_frame_rate).toFixed(2),
                audioCodec: audioStream ? audioStream.codec_name : "none",
            };

            resolve(videoInfo);
        });
    });
};

const formatSize = (bytes) => {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Byte";
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
};

const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
};

export const segmentVideo = async (inputPath, outputPath) => {
    return new Promise(async (resolve, reject) => {
        try {
            const startTime = Date.now();
            const videoInfo = await getVideoInfo(inputPath);
            const hlsPath = `${outputPath}/index.m3u8`;

            // First log input video details
            console.log("\n=================================");
            console.log("📊 Video Processing Information");
            console.log("=================================");
            console.log(`1. Original File: ${videoInfo.filename}`);
            console.log(
                `2. Resolution:    ${videoInfo.width}x${videoInfo.height}`
            );
            console.log(
                `3. Bitrate:       ${(videoInfo.bitrate / 1024 / 1024).toFixed(
                    2
                )} Mbps`
            );
            console.log(`4. FPS:           ${videoInfo.fps}`);
            console.log(
                `5. Duration:      ${formatDuration(videoInfo.duration)}`
            );
            console.log(`8. Input Size:    ${formatSize(videoInfo.size)}`);

            // ffmpeg command for HLS conversion
            const ffmpegCommand = `ffmpeg -i ${inputPath} -c:v libx264 -c:a aac -b:v 2000k -maxrate 2000k -bufsize 2000k -hls_time 10 -hls_playlist_type vod -hls_segment_filename "${outputPath}/segment%03d.ts" ${hlsPath}`;

            // Execute ffmpeg command
            exec(ffmpegCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error("Error executing ffmpeg command:", error);
                    reject(error);
                    return;
                }

                const endTime = Date.now();
                const processingTime = (endTime - startTime) / 1000; // in seconds
                const timePerMinute =
                    processingTime / (videoInfo.duration / 60);

                // Get output size and segment count
                const segmentFiles = fs.readdirSync(outputPath);
                const tsFiles = segmentFiles.filter((f) => f.endsWith(".ts"));
                const totalOutputSize = segmentFiles.reduce((total, file) => {
                    return (
                        total + fs.statSync(path.join(outputPath, file)).size
                    );
                }, 0);

                // Log processing results
                console.log(
                    `6. Process Time:  ${processingTime.toFixed(2)} seconds`
                );
                console.log(
                    `7. Time/Minute:   ${timePerMinute.toFixed(2)} seconds`
                );
                console.log(`8. Input Size:    ${formatSize(videoInfo.size)}`);
                console.log(`9. Output Size:   ${formatSize(totalOutputSize)}`);
                console.log(`10. Segments:     ${tsFiles.length} files`);
                console.log("\nSegment List:");
                console.log("---------------------------------");
                tsFiles.forEach((file) => {
                    const size = formatSize(
                        fs.statSync(path.join(outputPath, file)).size
                    );
                    console.log(`   ${file} (${size})`);
                });
                console.log("=================================\n");

                resolve({
                    success: true,
                    processingTime,
                    outputSize: totalOutputSize,
                    segmentCount: tsFiles.length,
                });
            });
        } catch (error) {
            reject(error);
        }
    });
};
