import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import { fileURLToPath } from "url";
import { generateHLSPlaylist } from "./function/ffmpeg/segment.js";
import { spawn } from "child_process";

const app = express();
const port = 8080;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// __dirname handling for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path for normal and converted videos
const normalVideosPath = path.join(__dirname, "videos");
const convertedVideosPath = path.join(__dirname, "converted");

// Ensure directories exist
[normalVideosPath, convertedVideosPath].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve index.html for the root route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// API to list all available normal videos
app.get("/api/videos", (req, res) => {
    fs.readdir(normalVideosPath, (err, files) => {
        if (err) {
            res.status(500).json({ message: "Error reading videos folder" });
            return;
        }

        const videoFiles = files.filter((file) => {
            const ext = path.extname(file).toLowerCase();
            return [".mp4", ".mkv", ".avi"].includes(ext);
        });

        res.json(videoFiles);
    });
});

// Middleware to convert video to HLS
app.post("/api/convert", async (req, res) => {
    const { videoFile } = req.body;
    const baseName = videoFile.split(".")[0];
    const videoPath = path.join(normalVideosPath, videoFile);
    const outputDir = path.join(convertedVideosPath, baseName);

    console.log("Converting video:", {
        videoFile,
        baseName,
        videoPath,
        outputDir,
    });

    if (!fs.existsSync(videoPath)) {
        console.error("Video file not found:", videoPath);
        return res.status(404).json({ message: "Video not found" });
    }

    try {
        if (!fs.existsSync(outputDir)) {
            console.log("Creating output directory:", outputDir);
            fs.mkdirSync(outputDir, { recursive: true });
            console.log("Starting HLS conversion...");
            await generateHLSPlaylist(videoPath, outputDir);
            console.log("HLS conversion completed");
        } else {
            console.log("Using existing HLS conversion");
        }

        const playlistPath = `/converted/${baseName}/index.m3u8`;
        console.log("Sending playlist path:", playlistPath);
        res.json({ playlist: playlistPath });
    } catch (error) {
        console.error("Conversion error:", error);
        res.status(500).json({
            message: "Video conversion failed",
            error: error.message,
        });
    }
});

// Serve HLS playlist and segments
app.use("/converted", express.static(convertedVideosPath));

// Start the server
app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});
