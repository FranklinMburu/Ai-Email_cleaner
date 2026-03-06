import express from 'express';
import cors from 'cors';
import 'express-async-errors';
import dotenv from 'dotenv';
import { initializeDatabase } from './database.js';
import routes from './routes.js';

dotenv.config();

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
