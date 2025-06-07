const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const PORT = 3000;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());

// --- ROUTE FOR CHAT RESPONSES (Handles JSON) ---
app.post('/api/responses', bodyParser.json({ limit: '50mb' }), async (req, res) => {
    console.log("\n--- Proxy: Received /api/responses request ---");
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "API key not set on server." });

    try {
        const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify(req.body)
        });
        if (!openaiResponse.ok) {
            const errorDetails = await openaiResponse.json();
            console.error("OpenAI /responses API returned an error:", errorDetails);
            return res.status(openaiResponse.status).json(errorDetails);
        }
        res.setHeader('Content-Type', 'text/event-stream');
        openaiResponse.body.pipe(res);
    } catch (error) {
        console.error("FATAL ERROR in /api/responses proxy:", error);
        res.status(500).json({ error: "Proxy failed to fetch from OpenAI." });
    }
});

// --- ROUTE FOR FILE UPLOADS (Handles multipart/form-data) ---
app.post('/api/files', upload.single('file'), async (req, res) => {
    console.log("\n--- Proxy: Received /api/files request ---");
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "API key not set on server." });
    if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });

    try {
        const form = new FormData();
        form.append('file', req.file.buffer, { filename: req.file.originalname });
        form.append('purpose', req.body.purpose || 'user_data');

        console.log(`Forwarding file "${req.file.originalname}" to OpenAI Files API...`);
        const openaiResponse = await fetch("https://api.openai.com/v1/files", {
            method: "POST",
            headers: { ...form.getHeaders(), "Authorization": `Bearer ${OPENAI_API_KEY}` },
            body: form
        });
        const responseData = await openaiResponse.json();
        if (!openaiResponse.ok) {
            console.error("OpenAI Files API returned an error:", responseData);
            return res.status(openaiResponse.status).json(responseData);
        }
        console.log("File uploaded successfully to OpenAI:", responseData);
        res.status(200).json(responseData);
    } catch (error) {
        console.error("FATAL ERROR in /api/files proxy:", error);
        res.status(500).json({ error: "Proxy failed to upload file." });
    }
});

// --- ROUTE FOR CREATING A VECTOR STORE ---
app.post('/api/vector_stores', bodyParser.json(), async (req, res) => {
    console.log("\n--- Proxy: Creating a vector store ---");
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "API key not set on server." });
    try {
        const vsResponse = await fetch("https://api.openai.com/v1/vector_stores", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                // --- THIS IS THE FIX ---
                "OpenAI-Beta": "assistants=v2" 
            },
            body: JSON.stringify(req.body)
        });
        const vsData = await vsResponse.json();
        if (!vsResponse.ok) {
            console.error("OpenAI Vector Store API returned an error:", vsData);
            return res.status(vsResponse.status).json(vsData);
        }
        console.log("Vector Store created successfully:", vsData);
        res.status(200).json(vsData);
    } catch (error) {
        console.error("FATAL ERROR in /api/vector_stores proxy:", error);
        res.status(500).json({ error: "Proxy failed to create vector store." });
    }
});

// --- ROUTE FOR DELETING A VECTOR STORE ---
app.delete('/api/vector_stores/:vs_id', async (req, res) => {
    const vs_id = req.params.vs_id;
    console.log(`\n--- Proxy: Deleting vector store ${vs_id} ---`);
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "API key not set on server." });
    try {
        const delResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vs_id}`, {
            method: "DELETE",
            headers: { 
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                // --- THIS IS THE FIX ---
                "OpenAI-Beta": "assistants=v2"
            }
        });
        const delData = await delResponse.json();
        if (!delResponse.ok) {
            console.error(`Failed to delete vector store ${vs_id}:`, delData);
            return res.status(delResponse.status).json(delData);
        }
        console.log(`Vector store ${vs_id} deleted successfully.`);
        res.status(200).json(delData);
    } catch (error) {
        console.error(`FATAL ERROR deleting vector store ${vs_id}:`, error);
        res.status(500).json({ error: "Proxy failed to delete vector store." });
    }
});

app.listen(PORT, () => {
    console.log(`Definitive proxy server running on http://localhost:${PORT}`);
});