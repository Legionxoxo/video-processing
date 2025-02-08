import express from "express";
import cors from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { exec } from "child_process"; // do not run this on server
import { segmentVideo } from "./function/ffmpeg/segment.js";

const port = 8080;

const app = express();

// Multer middleware
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "./upload");
    },
    filename: (req, file, cb) => {
        cb(
            null,
            file.fieldname + "-" + uuidv4() + path.extname(file.originalname)
        );
    },
});

//multer configuration
const upload = multer({ storage: storage });

app.use(
    cors({
        origin: ["http://localhost:5173", "http://localhost:8080"],
        credentials: true,
    })
);

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
        "Access-Control-Allow-Methods",
        "Origin, X-Requested-With, Content-Type, Accept"
    );
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/upload", express.static("upload"));

app.get("/", (req, res) => {
    res.send({ message: "Hello World" });
});

app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const videoId = uuidv4();
        const videoPath = req.file.path;
        const outputPath = `./upload/videos/${videoId}`;

        if (!fs.existsSync(outputPath)) {
            fs.mkdirSync(outputPath, { recursive: true });
        }

        await segmentVideo(videoPath, outputPath);

        // Delete original file to save space
        if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
        }

        const videoUrl = `http://localhost:${port}/upload/videos/${videoId}/index.m3u8`;
        res.json({
            message: "Video converted successfully",
            videoUrl: videoUrl,
            videoId: videoId,
        });
    } catch (error) {
        console.error("Error processing video:", error);
        res.status(500).json({ error: "Failed to convert video" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
