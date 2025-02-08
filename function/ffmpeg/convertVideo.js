import { exec } from "child_process";
import fs from "fs";
import path from "path";

// Quality presets with bitrates for different resolutions
const qualityPresets = {
    "4k": [
        { name: "1080p", bitrate: "4000k" },
        { name: "480p", bitrate: "1500k" },
        { name: "240p", bitrate: "400k" },
    ],
    "1080p": [
        { name: "720p", bitrate: "2500k" },
        { name: "480p", bitrate: "1500k" },
        { name: "240p", bitrate: "400k" },
    ],
    "720p": [
        { name: "480p", bitrate: "1500k" },
        { name: "240p", bitrate: "400k" },
    ],
    "480p": [{ name: "240p", bitrate: "400k" }],
};

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

            const videoInfo = {
                width: parseInt(videoStream.width),
                height: parseInt(videoStream.height),
                bitrate: parseInt(info.format.bit_rate),
                duration: parseFloat(info.format.duration),
                size: parseInt(info.format.size),
                codec: videoStream.codec_name,
            };

            console.log("Input Video Properties:", {
                resolution: `${videoInfo.width}x${videoInfo.height}`,
                bitrate: `${(videoInfo.bitrate / 1024 / 1024).toFixed(2)} Mbps`,
                duration: `${videoInfo.duration.toFixed(2)} seconds`,
                size: `${(videoInfo.size / 1024 / 1024).toFixed(2)} MB`,
                codec: videoInfo.codec,
            });

            resolve(videoInfo);
        });
    });
};

const determineQualityLevels = (height) => {
    if (height >= 2160) return qualityPresets["4k"];
    if (height >= 1080) return qualityPresets["1080p"];
    if (height >= 720) return qualityPresets["720p"];
    if (height >= 480) return qualityPresets["480p"];
    return []; // If resolution is too low, return empty array
};

const getFileSize = (filePath) => {
    try {
        const stats = fs.statSync(filePath);
        return stats.size;
    } catch (error) {
        console.error(`Error getting file size for ${filePath}:`, error);
        return 0;
    }
};

const formatSize = (bytes) => {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Byte";
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
};

const getConversionStats = async (inputPath, outputDir, name) => {
    // Get total size of all TS segments
    const segmentsDir = path.join(outputDir, name);
    let totalSegmentSize = 0;
    const files = fs.readdirSync(segmentsDir);
    files.forEach((file) => {
        if (file.endsWith(".ts")) {
            totalSegmentSize += getFileSize(path.join(segmentsDir, file));
        }
    });

    return {
        segmentsSize: totalSegmentSize,
        formattedSize: formatSize(totalSegmentSize),
    };
};

const convertToQuality = async (inputPath, outputDir, quality, videoInfo) => {
    const { name, bitrate } = quality;
    const resolutionDir = path.join(outputDir, name);

    if (!fs.existsSync(resolutionDir)) {
        fs.mkdirSync(resolutionDir, { recursive: true });
    }

    const outputPath = path.join(resolutionDir, "index.m3u8");
    const ffmpegCommand =
        `ffmpeg -i ${inputPath} -c:v h264 -c:a aac ` +
        `-b:v ${bitrate} -maxrate ${bitrate} -bufsize ${bitrate} ` +
        `-hls_time 10 -hls_playlist_type vod ` +
        `-hls_segment_filename "${resolutionDir}/segment%03d.ts" ` +
        `${outputPath}`;

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        exec(ffmpegCommand, async (error, stdout, stderr) => {
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;

            if (error) {
                console.error(`Error converting to ${name}:`, error);
                reject(error);
                return;
            }

            // Get conversion statistics
            const stats = await getConversionStats(inputPath, outputDir, name);
            const inputSize = getFileSize(inputPath);
            const compressionRatio = (
                (stats.segmentsSize / inputSize) *
                100
            ).toFixed(2);
            const targetBitrateInMbps = parseInt(bitrate) / 1000;

            console.log(`\nConversion Details for ${name}:`);
            console.log(`⏱️  Time taken: ${duration.toFixed(2)} seconds`);
            console.log(`📊 Target bitrate: ${targetBitrateInMbps} Mbps`);
            console.log(`📁 Output size: ${stats.formattedSize}`);
            console.log(
                `📈 Compression ratio: ${compressionRatio}% of original`
            );
            console.log(
                `🚀 Processing speed: ${(videoInfo.duration / duration).toFixed(
                    2
                )}x realtime`
            );

            resolve({
                name,
                duration,
                outputSize: stats.segmentsSize,
                compressionRatio,
                targetBitrate: targetBitrateInMbps,
            });
        });
    });
};

export const convertVideo = async (inputPath, outputDir, videoId) => {
    return new Promise(async (resolve, reject) => {
        const totalStartTime = Date.now();

        try {
            // Get input video information
            const videoInfo = await getVideoInfo(inputPath);
            console.log("\n📽️  Starting video conversion process...");

            // Determine quality levels based on input resolution
            const qualities = determineQualityLevels(videoInfo.height);

            // Create output directory if it doesn't exist
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Convert each quality level sequentially
            const conversionResults = [];
            for (const quality of qualities) {
                const result = await convertToQuality(
                    inputPath,
                    outputDir,
                    quality,
                    videoInfo
                );
                conversionResults.push(result);
            }

            // Create master playlist
            let masterPlaylist = "#EXTM3U\n#EXT-X-VERSION:3\n";
            qualities.forEach(({ name, bitrate }) => {
                masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${
                    parseInt(bitrate) * 1000
                },RESOLUTION=${videoInfo.width}x${videoInfo.height}\n`;
                masterPlaylist += `${name}/index.m3u8\n`;
            });

            const masterPlaylistPath = path.join(outputDir, "master.m3u8");
            fs.writeFileSync(masterPlaylistPath, masterPlaylist);

            // Delete the original uploaded file to save space
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }

            const totalDuration = (Date.now() - totalStartTime) / 1000;
            console.log("\n📊 Final Conversion Summary:");
            console.log("============================");
            conversionResults.forEach(
                ({
                    name,
                    duration,
                    outputSize,
                    compressionRatio,
                    targetBitrate,
                }) => {
                    console.log(`\n🎯 ${name}:`);
                    console.log(`   Duration: ${duration.toFixed(2)} seconds`);
                    console.log(`   Size: ${formatSize(outputSize)}`);
                    console.log(`   Bitrate: ${targetBitrate} Mbps`);
                    console.log(`   Compression: ${compressionRatio}%`);
                }
            );
            console.log(
                `\n⌛ Total processing time: ${totalDuration.toFixed(
                    2
                )} seconds\n`
            );

            resolve({
                success: true,
                masterPlaylistUrl: `/upload/videos/${videoId}/master.m3u8`,
            });
        } catch (error) {
            const totalDuration = (Date.now() - totalStartTime) / 1000;
            console.error(
                `❌ Conversion failed after ${totalDuration.toFixed(2)} seconds`
            );
            reject(error);
        }
    });
};
