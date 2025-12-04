import express from 'express';
import crypto from 'crypto';
import db from '../config/database.js';

const router = express.Router();

// ===== HMAC VERIFICATION MIDDLEWARE =====
const verifyShopifyWebhook = (req, res, next) => {
  try {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    
    if (!hmacHeader) {
      console.error('❌ Missing HMAC header');
      return res.status(401).json({ error: 'Missing HMAC signature' });
    }
    
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    
    if (!secret) {
      console.error('❌ SHOPIFY_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    
    // Calculate expected HMAC
    const hash = crypto
      .createHmac('sha256', secret)
      .update(req.rawBody, 'utf8')
      .digest('base64');
    
    // Timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(hmacHeader)
    );
    
    if (isValid) {
      console.log('✅ Webhook signature verified');
      next();
    } else {
      console.error('❌ Invalid webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
    }
    
  } catch (error) {
    console.error('❌ Webhook verification error:', error.message);
    res.status(401).json({ error: 'Webhook verification failed' });
  }
};

// ===== WEBHOOK: orders/create =====
router.post('/orders/create', verifyShopifyWebhook, async (req, res) => {
  try {
    const order = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 NEW ORDER WEBHOOK RECEIVED');
    console.log('Order ID:', order.id);
    console.log('Order Number:', order.order_number);
    console.log('Customer:', order.email);
    console.log('Total:', order.total_price);
    console.log('Items:', order.line_items.length);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Process each line item (product in the order)
    for (const item of order.line_items) {
      const productId = item.product_id;
      const variantId = item.variant_id;
      const quantity = item.quantity;
      
      console.log(`Processing: ${item.name} (Qty: ${quantity})`);
      
      // Find product in your database
      const productResult = await db.query(
        `SELECT * FROM products 
         WHERE shopify_product_id = $1 OR shopify_variant_id = $2`,
        [productId, variantId]
      );
      
      if (productResult.rows.length > 0) {
        const product = productResult.rows[0];
        const newStock = Math.max(0, product.stock - quantity);
        
        // Decrease stock
        await db.query(
          `UPDATE products 
           SET stock = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [newStock, product.id]
        );
        
        console.log(`✅ Stock updated: ${product.name} (${product.stock} → ${newStock})`);
        
        // Check for low stock
        if (newStock < 10) {
          console.log(`⚠️ LOW STOCK ALERT: ${product.name} (${newStock} remaining)`);
        }
      } else {
        console.log(`⚠️ Product not found in database (Product ID: ${productId})`);
      }
    }
    
    // Respond quickly to Shopify (must be within 5 seconds)
    res.status(200).json({ success: true, message: 'Order processed' });
    
  } catch (error) {
    console.error('❌ Error processing order webhook:', error.message);
    res.status(500).json({ error: 'Failed to process order' });
  }
});

// ===== WEBHOOK: orders/cancelled =====
router.post('/orders/cancelled', verifyShopifyWebhook, async (req, res) => {
  try {
    const order = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('❌ ORDER CANCELLED WEBHOOK');
    console.log('Order ID:', order.id);
    console.log('Order Number:', order.order_number);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Return stock for cancelled items
    for (const item of order.line_items) {
      const productId = item.product_id;
      const variantId = item.variant_id;
      const quantity = item.quantity;
      
      const productResult = await db.query(
        `SELECT * FROM products 
         WHERE shopify_product_id = $1 OR shopify_variant_id = $2`,
        [productId, variantId]
      );
      
      if (productResult.rows.length > 0) {
        const product = productResult.rows[0];
        const newStock = product.stock + quantity;
        
        // Increase stock back
        await db.query(
          `UPDATE products 
           SET stock = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [newStock, product.id]
        );
        
        console.log(`✅ Stock returned: ${product.name} (${product.stock} → ${newStock})`);
      }
    }
    
    res.status(200).json({ success: true, message: 'Cancellation processed' });
    
  } catch (error) {
    console.error('❌ Error processing cancellation:', error.message);
    res.status(500).json({ error: 'Failed to process cancellation' });
  }
});

// ===== WEBHOOK: refunds/create =====
router.post('/refunds/create', verifyShopifyWebhook, async (req, res) => {
  try {
    const refund = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 REFUND CREATED WEBHOOK');
    console.log('Refund ID:', refund.id);
    console.log('Order ID:', refund.order_id);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Return stock for refunded items
    for (const refundItem of refund.refund_line_items) {
      const lineItem = refundItem.line_item;
      const productId = lineItem.product_id;
      const variantId = lineItem.variant_id;
      const quantity = refundItem.quantity;
      
      const productResult = await db.query(
        `SELECT * FROM products 
         WHERE shopify_product_id = $1 OR shopify_variant_id = $2`,
        [productId, variantId]
      );
      
      if (productResult.rows.length > 0) {
        const product = productResult.rows[0];
        const newStock = product.stock + quantity;
        
        await db.query(
          `UPDATE products 
           SET stock = $1, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [newStock, product.id]
        );
        
        console.log(`✅ Stock returned (refund): ${product.name} (${product.stock} → ${newStock})`);
      }
    }
    
    res.status(200).json({ success: true, message: 'Refund processed' });
    
  } catch (error) {
    console.error('❌ Error processing refund:', error.message);
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// ===== WEBHOOK: products/create ===== (NEW!)
router.post('/products/create', verifyShopifyWebhook, async (req, res) => {
  try {
    const product = req.body;
    const variant = product.variants[0]; // Get first variant
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('➕ NEW PRODUCT CREATED WEBHOOK');
    console.log('Product ID:', product.id);
    console.log('Product Name:', product.title);
    console.log('SKU:', variant.sku);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Check if product already exists
    const existingProduct = await db.query(
      'SELECT * FROM products WHERE shopify_product_id = $1',
      [product.id]
    );
    
    if (existingProduct.rows.length > 0) {
      console.log('⚠️ Product already exists in database, skipping');
    } else {
      // Insert new product
      await db.query(
        `INSERT INTO products 
         (name, sku, price, stock, shopify_product_id, shopify_variant_id, shopify_inventory_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          product.title,
          variant.sku || `PROD-${product.id}`,
          variant.price,
          variant.inventory_quantity || 0,
          product.id,
          variant.id,
          variant.inventory_item_id
        ]
      );
      
      console.log(`✅ Product added to database: ${product.title}`);
    }
    
    res.status(200).json({ success: true, message: 'Product created' });
    
  } catch (error) {
    console.error('❌ Error processing product creation:', error.message);
    res.status(500).json({ error: 'Failed to process product creation' });
  }
});

// ===== WEBHOOK: products/update ===== (NEW!)
router.post('/products/update', verifyShopifyWebhook, async (req, res) => {
  try {
    const product = req.body;
    const variant = product.variants[0]; // Get first variant
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 PRODUCT UPDATED WEBHOOK');
    console.log('Product ID:', product.id);
    console.log('Product Name:', product.title);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Check if product exists in database
    const existingProduct = await db.query(
      'SELECT * FROM products WHERE shopify_product_id = $1',
      [product.id]
    );
    
    if (existingProduct.rows.length > 0) {
      // Update existing product
      await db.query(
        `UPDATE products 
         SET name = $1, sku = $2, price = $3, stock = $4, 
             shopify_variant_id = $5, shopify_inventory_item_id = $6,
             updated_at = CURRENT_TIMESTAMP
         WHERE shopify_product_id = $7`,
        [
          product.title,
          variant.sku || existingProduct.rows[0].sku,
          variant.price,
          variant.inventory_quantity || existingProduct.rows[0].stock,
          variant.id,
          variant.inventory_item_id,
          product.id
        ]
      );
      
      console.log(`✅ Product updated in database: ${product.title}`);
    } else {
      console.log('⚠️ Product not found in database, creating new entry');
      
      // Insert as new product
      await db.query(
        `INSERT INTO products 
         (name, sku, price, stock, shopify_product_id, shopify_variant_id, shopify_inventory_item_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          product.title,
          variant.sku || `PROD-${product.id}`,
          variant.price,
          variant.inventory_quantity || 0,
          product.id,
          variant.id,
          variant.inventory_item_id
        ]
      );
      
      console.log(`✅ Product created in database: ${product.title}`);
    }
    
    res.status(200).json({ success: true, message: 'Product updated' });
    
  } catch (error) {
    console.error('❌ Error processing product update:', error.message);
    res.status(500).json({ error: 'Failed to process product update' });
  }
});

// ===== WEBHOOK: products/delete ===== (NEW!)
router.post('/products/delete', verifyShopifyWebhook, async (req, res) => {
  try {
    const product = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🗑️  PRODUCT DELETED WEBHOOK');
    console.log('Product ID:', product.id);
    console.log('Product Name:', product.title);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Delete product from database
    const result = await db.query(
      'DELETE FROM products WHERE shopify_product_id = $1 RETURNING *',
      [product.id]
    );
    
    if (result.rows.length > 0) {
      console.log(`✅ Product deleted from database: ${product.title}`);
    } else {
      console.log('⚠️ Product not found in database');
    }
    
    res.status(200).json({ success: true, message: 'Product deleted' });
    
  } catch (error) {
    console.error('❌ Error processing product deletion:', error.message);
    res.status(500).json({ error: 'Failed to process product deletion' });
  }
});

// ===== TEST ENDPOINT (for debugging) =====
router.post('/test', (req, res) => {
  console.log('🧪 Test webhook received');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  res.json({ success: true, message: 'Test webhook received' });
});

export default router;
