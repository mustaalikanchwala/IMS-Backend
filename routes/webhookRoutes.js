/**
 * ============================================================================
 * SHOPIFY WEBHOOK ROUTES
 * ============================================================================
 * 
 * Handles incoming webhooks from Shopify for real-time data synchronization.
 * All webhooks are secured with HMAC SHA256 signature verification.
 * 
 * Supported Events:
 * - Product lifecycle (create, update, delete)
 * - Inventory updates
 * - Order management (create, cancel)
 * - Refund processing
 * 
 * @module routes/webhookRoutes
 * @requires express
 * @requires crypto
 * @requires ../config/database
 * 
 * @author Your Name
 * @version 2.0.0
 * @since 2025-12-05
 * ============================================================================
 */

import express from 'express';
import crypto from 'crypto';
import db from '../config/database.js';

const router = express.Router();

// ============================================================================
// MIDDLEWARE: HMAC Signature Verification
// ============================================================================

/**
 * Verifies the authenticity of incoming Shopify webhooks using HMAC SHA256.
 * 
 * This middleware ensures that:
 * 1. The webhook request originated from Shopify
 * 2. The payload hasn't been tampered with in transit
 * 3. Your webhook secret is correctly configured
 * 
 * Security Flow:
 * 1. Extract HMAC signature from request headers
 * 2. Calculate expected signature using webhook secret and raw body
 * 3. Compare signatures using timing-safe comparison to prevent timing attacks
 * 4. Reject request if signatures don't match
 * 
 * @middleware
 * @param {Object} req - Express request object (must have req.rawBody)
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 * 
 * @throws {401} If HMAC signature is missing, invalid, or verification fails
 * @throws {500} If webhook secret is not configured in environment variables
 */
const verifyShopifyWebhook = (req, res, next) => {
  try {
    // Step 1: Extract HMAC signature from headers
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    
    if (!hmacHeader) {
      console.error('❌ [SECURITY] Missing HMAC signature in webhook request');
      return res.status(401).json({ 
        success: false,
        error: 'Missing HMAC signature',
        message: 'Webhook request must include x-shopify-hmac-sha256 header'
      });
    }
    
    // Step 2: Validate webhook secret is configured
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    
    if (!secret) {
      console.error('❌ [CONFIG] SHOPIFY_WEBHOOK_SECRET environment variable not set');
      return res.status(500).json({ 
        success: false,
        error: 'Webhook secret not configured',
        message: 'Server configuration error'
      });
    }
    
    // Step 3: Validate raw body is available
    if (!req.rawBody) {
      console.error('❌ [CONFIG] Raw body middleware not configured');
      return res.status(500).json({ 
        success: false,
        error: 'Raw body not available',
        message: 'Server configuration error'
      });
    }
    
    // Step 4: Calculate expected HMAC signature
    const calculatedHash = crypto
      .createHmac('sha256', secret)
      .update(req.rawBody, 'utf8')
      .digest('base64');
    
    // Step 5: Perform timing-safe comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(calculatedHash),
      Buffer.from(hmacHeader)
    );
    
    if (isValid) {
      console.log('✅ [SECURITY] Webhook signature verified successfully');
      next();
    } else {
      console.error('❌ [SECURITY] Invalid webhook signature - possible tampering detected');
      console.error(`   Expected: ${calculatedHash.substring(0, 20)}...`);
      console.error(`   Received: ${hmacHeader.substring(0, 20)}...`);
      
      res.status(401).json({ 
        success: false,
        error: 'Invalid signature',
        message: 'Webhook signature verification failed'
      });
    }
    
  } catch (error) {
    console.error('❌ [ERROR] Webhook verification exception:', error.message);
    console.error('   Stack:', error.stack);
    
    res.status(401).json({ 
      success: false,
      error: 'Webhook verification failed',
      message: error.message
    });
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Finds a variant in the database by Shopify variant ID.
 * 
 * @async
 * @param {string|number} shopifyVariantId - Shopify variant ID
 * @returns {Promise<Object|null>} Variant object or null if not found
 */
async function findVariantByShopifyId(shopifyVariantId) {
  const result = await db.query(
    'SELECT * FROM product_variants WHERE shopify_variant_id = $1',
    [shopifyVariantId]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Updates stock for a specific variant.
 * 
 * @async
 * @param {number} variantId - Internal variant ID
 * @param {number} newStock - New stock quantity
 * @returns {Promise<void>}
 */
async function updateVariantStock(variantId, newStock) {
  await db.query(
    `UPDATE product_variants 
     SET stock = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [Math.max(0, newStock), variantId]
  );
}

/**
 * Checks if stock is below threshold and logs warning.
 * 
 * @param {string} productName - Product name
 * @param {string} variantTitle - Variant title
 * @param {number} stock - Current stock level
 * @param {number} [threshold=10] - Low stock threshold
 */
function checkLowStock(productName, variantTitle, stock, threshold = 10) {
  if (stock < threshold) {
    console.warn(`⚠️  [LOW STOCK] ${productName} - ${variantTitle}: ${stock} units remaining`);
    // TODO: Implement email/SMS notification system
  }
}

// ============================================================================
// WEBHOOK ENDPOINTS
// ============================================================================

/**
 * ----------------------------------------------------------------------------
 * WEBHOOK: Product Created
 * ----------------------------------------------------------------------------
 * 
 * Triggered when a new product is created in Shopify Admin.
 * 
 * Business Logic:
 * 1. Check if product already exists (prevent duplicates)
 * 2. Insert product record into database
 * 3. Insert all variant records for the product
 * 4. Log success/failure
 * 
 * Database Impact:
 * - Inserts into: products, product_variants tables
 * 
 * @route POST /api/webhooks/products/create
 * @access Private (Shopify only - verified by HMAC)
 * @param {Object} req.body - Shopify product object with variants array
 * @returns {Object} 200 - Success response
 * @returns {Object} 500 - Error response
 */
router.post('/products/create', verifyShopifyWebhook, async (req, res) => {
  try {
    const product = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('➕ [WEBHOOK] Product Created');
    console.log(`   Product ID: ${product.id}`);
    console.log(`   Name: ${product.title}`);
    console.log(`   Variants: ${product.variants.length}`);
    console.log(`   Status: ${product.status}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Validate required data
    if (!product.id || !product.title) {
      throw new Error('Invalid product data: missing required fields');
    }
    
    // Check for duplicate product
    const existingProduct = await db.query(
      'SELECT id FROM products WHERE shopify_product_id = $1',
      [product.id]
    );
    
    if (existingProduct.rows.length > 0) {
      console.log('⚠️  [DUPLICATE] Product already exists in database - skipping insert');
      return res.status(200).json({ 
        success: true, 
        message: 'Product already exists',
        action: 'skipped'
      });
    }
    
    // Insert product record
    const productResult = await db.query(
      `INSERT INTO products 
       (shopify_product_id, name, description, product_type, vendor, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, shopify_product_id, name`,
      [
        product.id,
        product.title,
        product.body_html || null,
        product.product_type || 'General',
        product.vendor || 'Default Vendor',
        product.status || 'active'
      ]
    );
    
    const createdProduct = productResult.rows[0];
    console.log(`✅ [DB] Product inserted (ID: ${createdProduct.id})`);
    
    // Insert all variant records
    let variantsInserted = 0;
    for (const variant of product.variants) {
      await db.query(
        `INSERT INTO product_variants 
         (product_id, shopify_variant_id, shopify_inventory_item_id, 
          sku, title, option1, option2, option3, 
          price, compare_at_price, stock, weight, weight_unit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          createdProduct.id,
          variant.id,
          variant.inventory_item_id,
          variant.sku || `SKU-${variant.id}`,
          variant.title || 'Default',
          variant.option1 || null,
          variant.option2 || null,
          variant.option3 || null,
          parseFloat(variant.price) || 0,
          variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
          parseInt(variant.inventory_quantity) || 0,
          variant.weight ? parseFloat(variant.weight) : null,
          variant.weight_unit || 'kg'
        ]
      );
      variantsInserted++;
    }
    
    console.log(`✅ [DB] ${variantsInserted} variant(s) inserted`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Respond to Shopify within 5 seconds
    res.status(200).json({ 
      success: true, 
      message: 'Product created successfully',
      action: 'created',
      product_id: createdProduct.shopify_product_id,
      variants_created: variantsInserted
    });
    
  } catch (error) {
    console.error('❌ [ERROR] Product creation webhook failed');
    console.error(`   Message: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process product creation',
      message: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * WEBHOOK: Product Updated
 * ----------------------------------------------------------------------------
 * 
 * Triggered when a product is updated in Shopify Admin.
 * 
 * Business Logic:
 * 1. Find product in database by Shopify ID
 * 2. If not found, create new product (fallback)
 * 3. Update product details
 * 4. Sync all variants (update existing, insert new ones)
 * 
 * Database Impact:
 * - Updates: products, product_variants tables
 * - May insert if product doesn't exist
 * 
 * @route POST /api/webhooks/products/update
 * @access Private (Shopify only)
 */
router.post('/products/update', verifyShopifyWebhook, async (req, res) => {
  try {
    const product = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 [WEBHOOK] Product Updated');
    console.log(`   Product ID: ${product.id}`);
    console.log(`   Name: ${product.title}`);
    console.log(`   Variants: ${product.variants.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Find existing product
    const existingProduct = await db.query(
      'SELECT id, name FROM products WHERE shopify_product_id = $1',
      [product.id]
    );
    
    let dbProductId;
    
    if (existingProduct.rows.length === 0) {
      // Product doesn't exist - create it (fallback scenario)
      console.log('⚠️  [FALLBACK] Product not found - creating new entry');
      
      const insertResult = await db.query(
        `INSERT INTO products 
         (shopify_product_id, name, description, product_type, vendor, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          product.id,
          product.title,
          product.body_html || null,
          product.product_type || 'General',
          product.vendor || 'Default Vendor',
          product.status || 'active'
        ]
      );
      
      dbProductId = insertResult.rows[0].id;
      console.log(`✅ [DB] Product created (ID: ${dbProductId})`);
      
    } else {
      // Product exists - update it
      dbProductId = existingProduct.rows[0].id;
      
      await db.query(
        `UPDATE products 
         SET name = $1, 
             description = $2, 
             product_type = $3, 
             vendor = $4, 
             status = $5, 
             updated_at = CURRENT_TIMESTAMP
         WHERE shopify_product_id = $6`,
        [
          product.title,
          product.body_html || null,
          product.product_type || 'General',
          product.vendor || 'Default Vendor',
          product.status || 'active',
          product.id
        ]
      );
      
      console.log(`✅ [DB] Product updated (ID: ${dbProductId})`);
    }
    
    // Sync all variants
    let variantsUpdated = 0;
    let variantsCreated = 0;
    
    for (const variant of product.variants) {
      const existingVariant = await db.query(
        'SELECT id FROM product_variants WHERE shopify_variant_id = $1',
        [variant.id]
      );
      
      if (existingVariant.rows.length > 0) {
        // Update existing variant
        await db.query(
          `UPDATE product_variants 
           SET sku = $1, title = $2, option1 = $3, option2 = $4, option3 = $5,
               price = $6, compare_at_price = $7, stock = $8, 
               weight = $9, weight_unit = $10, updated_at = CURRENT_TIMESTAMP
           WHERE shopify_variant_id = $11`,
          [
            variant.sku || `SKU-${variant.id}`,
            variant.title || 'Default',
            variant.option1 || null,
            variant.option2 || null,
            variant.option3 || null,
            parseFloat(variant.price) || 0,
            variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
            parseInt(variant.inventory_quantity) || 0,
            variant.weight ? parseFloat(variant.weight) : null,
            variant.weight_unit || 'kg',
            variant.id
          ]
        );
        variantsUpdated++;
        
      } else {
        // Create new variant
        await db.query(
          `INSERT INTO product_variants 
           (product_id, shopify_variant_id, shopify_inventory_item_id, 
            sku, title, option1, option2, option3, 
            price, compare_at_price, stock, weight, weight_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            dbProductId,
            variant.id,
            variant.inventory_item_id,
            variant.sku || `SKU-${variant.id}`,
            variant.title || 'Default',
            variant.option1 || null,
            variant.option2 || null,
            variant.option3 || null,
            parseFloat(variant.price) || 0,
            variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
            parseInt(variant.inventory_quantity) || 0,
            variant.weight ? parseFloat(variant.weight) : null,
            variant.weight_unit || 'kg'
          ]
        );
        variantsCreated++;
      }
    }
    
    console.log(`✅ [DB] Variants synced (${variantsUpdated} updated, ${variantsCreated} created)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(200).json({ 
      success: true, 
      message: 'Product updated successfully',
      action: 'updated',
      variants_updated: variantsUpdated,
      variants_created: variantsCreated
    });
    
  } catch (error) {
    console.error('❌ [ERROR] Product update webhook failed');
    console.error(`   Message: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process product update',
      message: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * WEBHOOK: Product Deleted
 * ----------------------------------------------------------------------------
 * 
 * Triggered when a product is deleted from Shopify Admin.
 * 
 * Business Logic:
 * 1. Find product by Shopify ID
 * 2. Delete product record (CASCADE deletes variants automatically)
 * 3. Log result
 * 
 * Database Impact:
 * - Deletes from: products table (CASCADE deletes from product_variants)
 * 
 * @route POST /api/webhooks/products/delete
 * @access Private (Shopify only)
 */
router.post('/products/delete', verifyShopifyWebhook, async (req, res) => {
  try {
    const product = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🗑️  [WEBHOOK] Product Deleted');
    console.log(`   Product ID: ${product.id}`);
    console.log(`   Name: ${product.title || 'N/A'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Delete product (CASCADE will delete variants)
    const result = await db.query(
      'DELETE FROM products WHERE shopify_product_id = $1 RETURNING id, name',
      [product.id]
    );
    
    if (result.rows.length > 0) {
      const deletedProduct = result.rows[0];
      console.log(`✅ [DB] Product deleted (ID: ${deletedProduct.id}, Name: ${deletedProduct.name})`);
      console.log('   Note: All variants deleted via CASCADE');
    } else {
      console.log('⚠️  [NOT FOUND] Product not in database - no action taken');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(200).json({ 
      success: true, 
      message: 'Product deleted successfully',
      action: 'deleted'
    });
    
  } catch (error) {
    console.error('❌ [ERROR] Product deletion webhook failed');
    console.error(`   Message: ${error.message}`);
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process product deletion',
      message: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * WEBHOOK: Inventory Level Updated
 * ----------------------------------------------------------------------------
 * 
 * Triggered when inventory quantity changes in Shopify.
 * 
 * Business Logic:
 * 1. Find variant by inventory item ID
 * 2. Update stock quantity
 * 3. Check for low stock and alert if needed
 * 
 * Database Impact:
 * - Updates: product_variants.stock
 * 
 * @route POST /api/webhooks/inventory-levels/update
 * @access Private (Shopify only)
 */
router.post('/inventory-levels/update', verifyShopifyWebhook, async (req, res) => {
  try {
    const inventoryLevel = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 [WEBHOOK] Inventory Level Updated');
    console.log(`   Inventory Item ID: ${inventoryLevel.inventory_item_id}`);
    console.log(`   Available Stock: ${inventoryLevel.available}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Update variant stock
    const result = await db.query(
      `UPDATE product_variants 
       SET stock = $1, updated_at = CURRENT_TIMESTAMP
       WHERE shopify_inventory_item_id = $2
       RETURNING id, sku, title, stock`,
      [inventoryLevel.available, inventoryLevel.inventory_item_id]
    );
    
    if (result.rows.length > 0) {
      const variant = result.rows[0];
      console.log(`✅ [DB] Stock updated for variant ${variant.sku}: ${variant.stock} units`);
      
      // Check low stock
      checkLowStock(variant.sku, variant.title, variant.stock);
    } else {
      console.log('⚠️  [NOT FOUND] Variant not in database');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(200).json({ 
      success: true, 
      message: 'Inventory updated successfully'
    });
    
  } catch (error) {
    console.error('❌ [ERROR] Inventory update webhook failed');
    console.error(`   Message: ${error.message}`);
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process inventory update',
      message: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * WEBHOOK: Order Created
 * ----------------------------------------------------------------------------
 * 
 * Triggered when a new order is placed.
 * 
 * Business Logic:
 * 1. Extract line items from order
 * 2. For each item, reduce variant stock
 * 3. Check for low stock alerts
 * 4. Prevent negative stock (floor at 0)
 * 
 * Database Impact:
 * - Updates: product_variants.stock (decrease)
 * 
 * @route POST /api/webhooks/orders/create
 * @access Private (Shopify only)
 */
router.post('/orders/create', verifyShopifyWebhook, async (req, res) => {
  try {
    const order = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📦 [WEBHOOK] Order Created');
    console.log(`   Order ID: ${order.id}`);
    console.log(`   Order #: ${order.order_number}`);
    console.log(`   Customer: ${order.email || 'Guest'}`);
    console.log(`   Total: $${order.total_price}`);
    console.log(`   Items: ${order.line_items.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Process each line item
    for (const item of order.line_items) {
      if (!item.variant_id) {
        console.log(`⚠️  [SKIP] Line item "${item.name}" has no variant ID`);
        continue;
      }
      
      // Find variant
      const variant = await findVariantByShopifyId(item.variant_id);
      
      if (variant) {
        const oldStock = variant.stock;
        const newStock = Math.max(0, oldStock - item.quantity);
        
        await updateVariantStock(variant.id, newStock);
        
        console.log(`   ✅ ${item.name}: ${oldStock} → ${newStock} units (sold ${item.quantity})`);
        
        // Check low stock
        checkLowStock(item.name, variant.title, newStock);
      } else {
        console.log(`   ⚠️  [NOT FOUND] Variant ${item.variant_id} not in database`);
      }
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(200).json({ 
      success: true, 
      message: 'Order processed successfully',
      items_processed: order.line_items.length
    });
    
  } catch (error) {
    console.error('❌ [ERROR] Order creation webhook failed');
    console.error(`   Message: ${error.message}`);
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process order',
      message: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * WEBHOOK: Order Cancelled
 * ----------------------------------------------------------------------------
 * 
 * Triggered when an order is cancelled.
 * 
 * Business Logic:
 * 1. Extract line items from cancelled order
 * 2. For each item, restore variant stock
 * 
 * Database Impact:
 * - Updates: product_variants.stock (increase)
 * 
 * @route POST /api/webhooks/orders/cancelled
 * @access Private (Shopify only)
 */
router.post('/orders/cancelled', verifyShopifyWebhook, async (req, res) => {
  try {
    const order = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('❌ [WEBHOOK] Order Cancelled');
    console.log(`   Order ID: ${order.id}`);
    console.log(`   Order #: ${order.order_number}`);
    console.log(`   Cancel Reason: ${order.cancel_reason || 'N/A'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Restore stock for each item
    for (const item of order.line_items) {
      if (!item.variant_id) continue;
      
      const variant = await findVariantByShopifyId(item.variant_id);
      
      if (variant) {
        const oldStock = variant.stock;
        const newStock = oldStock + item.quantity;
        
        await updateVariantStock(variant.id, newStock);
        
        console.log(`   ✅ ${item.name}: ${oldStock} → ${newStock} units (restored ${item.quantity})`);
      }
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(200).json({ 
      success: true, 
      message: 'Order cancellation processed',
      stock_restored: true
    });
    
  } catch (error) {
    console.error('❌ [ERROR] Order cancellation webhook failed');
    console.error(`   Message: ${error.message}`);
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process cancellation',
      message: error.message
    });
  }
});

/**
 * ----------------------------------------------------------------------------
 * WEBHOOK: Refund Created
 * ----------------------------------------------------------------------------
 * 
 * Triggered when a refund is issued for an order.
 * 
 * Business Logic:
 * 1. Extract refunded line items
 * 2. For each refunded item, restore variant stock
 * 3. Handle partial refunds (only refunded quantity)
 * 
 * Database Impact:
 * - Updates: product_variants.stock (increase)
 * 
 * @route POST /api/webhooks/refunds/create
 * @access Private (Shopify only)
 */
router.post('/refunds/create', verifyShopifyWebhook, async (req, res) => {
  try {
    const refund = req.body;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💰 [WEBHOOK] Refund Created');
    console.log(`   Refund ID: ${refund.id}`);
    console.log(`   Order ID: ${refund.order_id}`);
    console.log(`   Refunded Items: ${refund.refund_line_items.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Restore stock for refunded items
    for (const refundItem of refund.refund_line_items) {
      const lineItem = refundItem.line_item;
      
      if (!lineItem?.variant_id) continue;
      
      const variant = await findVariantByShopifyId(lineItem.variant_id);
      
      if (variant) {
        const oldStock = variant.stock;
        const newStock = oldStock + refundItem.quantity;
        
        await updateVariantStock(variant.id, newStock);
        
        console.log(`   ✅ ${lineItem.name}: ${oldStock} → ${newStock} units (refund ${refundItem.quantity})`);
      }
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    res.status(200).json({ 
      success: true, 
      message: 'Refund processed successfully',
      stock_restored: true
    });
    
  } catch (error) {
    console.error('❌ [ERROR] Refund webhook failed');
    console.error(`   Message: ${error.message}`);
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to process refund',
      message: error.message
    });
  }
});

// ============================================================================
// DIAGNOSTIC ENDPOINTS
// ============================================================================

/**
 * Test endpoint for webhook debugging (no HMAC verification).
 * Use this to test webhook payload structure without signature.
 * 
 * ⚠️ WARNING: Remove this endpoint in production or add authentication.
 * 
 * @route POST /api/webhooks/test
 * @access Public (should be protected in production)
 */
router.post('/test', (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 [TEST] Webhook Received');
  console.log('   Headers:', JSON.stringify(req.headers, null, 2));
  console.log('   Body:', JSON.stringify(req.body, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  res.json({ 
    success: true, 
    message: 'Test webhook received',
    received_at: new Date().toISOString()
  });
});

// ============================================================================
// EXPORTS
// ============================================================================

export default router;
