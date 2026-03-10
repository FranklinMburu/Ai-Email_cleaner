import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables FIRST
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.error('Error loading .env file:', result.error.message);
}

// Now import everything else
import express from 'express';
import cors from 'cors';
import 'express-async-errors';
import { initializeDatabase } from './database.js';
import routes from './routes.js';

const app = express();
const port = process.env.BACKEND_PORT || 3001;

// Initialize database
initializeDatabase();

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API routes
app.use('/', routes);

// Error handler
app.use((err, req, res, _next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
