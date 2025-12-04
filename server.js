import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db from './config/database.js';
import productRoutes from './routes/productRoutes.js';
import shopifyRoutes from './routes/shopifyRoutes.js'; 
import webhookRoutes from './routes/webhookRoutes.js'; 

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ===== WEBHOOK RAW BODY MIDDLEWARE (MUST BE FIRST!) =====
app.use('/api/webhooks', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');  // Save raw body for HMAC
  }
}));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Shopify Inventory Management API',
    version: '1.0.0',
    endpoints: {
      dbTest: '/db-test',
      products: '/api/products',
      shopify: '/api/shopify',
      webhooks: '/api/webhooks'
    }
  });
});

// check route
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    timestamp: new Date() 
  });
});

// Test database connection
app.get('/db-test', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW()');
    res.json({ 
      success: true,
      message: 'Database connected successfully!', 
      timestamp: result.rows[0].now 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Database connection failed', 
      details: error.message 
    });
  }
});

// Product routes
app.use('/api/products', productRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/webhooks', webhookRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Shopify Inventory Backend Started!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`🗄️  DB Test: http://localhost:${PORT}/db-test`);
  console.log(`📦 Products: http://localhost:${PORT}/api/products`);
  console.log(`🛍️  Shopify: http://localhost:${PORT}/api/shopify`);
  console.log(`🔔 Webhooks: http://localhost:${PORT}/api/webhooks`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
